// MCP-сервер кофейни. Регистрирует инструменты и слушает HTTP на :3000/mcp.
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { readMenu, createOrder, getOrder, type OrderItem } from "./excel.js";

// ────────────────────────────────────────────────────────────
//  Часть 1: сборка сервера и инструментов
//  Описания (title/description/.describe) — на английском: это контракт,
//  по которому LLM выбирает инструмент и заполняет аргументы.
// ────────────────────────────────────────────────────────────

function buildServer(): McpServer {
  const server = new McpServer({
    name: "coffee-shop",
    version: "1.0.0",
  });

  // ── get_menu: меню и время приготовления ──
  server.registerTool(
    "get_menu",
    {
      title: "Get menu",
      description:
        "Returns the list of drinks with price and preparation time (minutes per single serving). " +
        "Call this to learn what is available and avoid inventing drinks that are not on the menu.",
      inputSchema: {}, // аргументов нет
    },
    async () => {
      try {
        const menu = await readMenu();
        return { content: [{ type: "text", text: JSON.stringify(menu) }] };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: `Ошибка чтения меню: ${String(e)}` }],
        };
      }
    }
  );

  // ── create_order: записать заказ ──
  server.registerTool(
    "create_order",
    {
      title: "Create order",
      description:
        "Saves an order and returns its number (id) and the total preparation time in minutes. " +
        "items is an array of positions; drink names must come from the menu (see get_menu).",
      inputSchema: {
        items: z
          .array(
            z.object({
              drink: z.string().describe("drink name, exactly as in the menu"),
              qty: z
                .number()
                .int()
                .positive()
                .describe("number of servings"),
            })
          )
          .min(1)
          .describe("order positions"),
      },
    },
    async ({ items }: { items: OrderItem[] }) => {
      try {
        const menu = await readMenu();

        // Бизнес-логика: проверяем напитки и считаем общее время (сумма).
        let totalMinutes = 0;
        for (const it of items) {
          const m = menu.find(
            (x) => x.drink.toLowerCase() === it.drink.toLowerCase()
          );
          if (!m) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Напитка «${it.drink}» нет в меню. Доступно: ${menu
                    .map((x) => x.drink)
                    .join(", ")}.`,
                },
              ],
            };
          }
          totalMinutes += m.minutes * it.qty;
        }

        const order = await createOrder(items, totalMinutes);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id: order.id,
                totalMinutes: order.totalMinutes,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Ошибка создания заказа: ${String(e)}` },
          ],
        };
      }
    }
  );

  // ── get_order_status: статус и остаток минут ──
  server.registerTool(
    "get_order_status",
    {
      title: "Get order status",
      description:
        "Given an order number (orderId), returns its status and how many minutes are left until it is ready.",
      inputSchema: {
        orderId: z.number().int().positive().describe("order number (id)"),
      },
    },
    async ({ orderId }: { orderId: number }) => {
      try {
        const order = await getOrder(orderId);
        if (!order) {
          return {
            isError: true,
            content: [{ type: "text", text: `Заказ №${orderId} не найден.` }],
          };
        }

        // Считаем остаток: время готовности = создан + totalMinutes.
        const readyAt =
          new Date(order.createdAt).getTime() + order.totalMinutes * 60_000;
        const msLeft = readyAt - Date.now();
        const minutesLeft = Math.max(0, Math.ceil(msLeft / 60_000));
        const status = minutesLeft === 0 ? "готов" : "готовится";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id: order.id,
                status,
                minutesLeft,
                items: order.items,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Ошибка получения статуса: ${String(e)}` },
          ],
        };
      }
    }
  );

  return server;
}

// ────────────────────────────────────────────────────────────
//  Часть 2: Express + Streamable HTTP транспорт
// ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Храним транспорт по id сессии: одна сессия = один разговор клиента с сервером.
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST /mcp — основной канал: вызовы инструментов и инициализация.
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport;
  if (sessionId && transports[sessionId]) {
    // Уже знакомая сессия — берём её транспорт.
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // Новый клиент прислал initialize — заводим сессию и сервер.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    const server = buildServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Нет валидной сессии" },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// GET и DELETE /mcp — поток событий и закрытие сессии.
async function handleSessionRequest(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Нет валидной сессии");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`MCP-сервер кофейни слушает http://localhost:${PORT}/mcp`);
});
