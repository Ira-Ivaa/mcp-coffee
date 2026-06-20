// MCP-сервер кофейни. Регистрирует инструменты и слушает HTTP на :3000/mcp.
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  readMenu,
  createOrder,
  getOrder,
  type OrderItem,
  type MenuItem,
} from "./excel.js";

// ────────────────────────────────────────────────────────────
//  Поиск по составу (retrieval): LLM присылает ключевое слово
//  («арбуз»), а мы находим напитки, у которых оно есть в составе
//  или названии — этих данных у модели в контексте нет.
// ────────────────────────────────────────────────────────────

// нормализация: нижний регистр + ё→е
function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

// разбиваем строку на слова (буквы/цифры)
function tokenize(s: string): string[] {
  return norm(s)
    .split(/[^a-zа-я0-9]+/i)
    .filter((t) => t.length > 0);
}

// токен запроса совпадает со словом, если одно — префикс другого
// (общая часть от 3 символов): "кокос" ~ "кокосовый", "арбуз" ~ "арбузный"
function tokenMatch(q: string, w: string): boolean {
  if (Math.min(q.length, w.length) < 3) return q === w;
  return w.startsWith(q) || q.startsWith(w);
}

// Ранжируем меню по запросу: сколько слов запроса нашли в
// «название + состав». Возвращаем только напитки со счётом > 0.
function searchMenu(menu: MenuItem[], query: string): MenuItem[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const scored = menu.map((item) => {
    const words = tokenize(`${item.drink} ${item.composition}`);
    const score = qTokens.filter((q) => words.some((w) => tokenMatch(q, w)))
      .length;
    return { item, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

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

  // ── search_menu: поиск напитков по составу/вкусу ──
  server.registerTool(
    "search_menu",
    {
      title: "Search menu by ingredient",
      description:
        "Searches drinks by ingredient or flavor and returns the matching ones with their composition. " +
        "Use it when the guest asks for a flavor rather than a name (e.g. 'something with coconut'). " +
        "Pass a single ingredient keyword in its base form, e.g. 'кокос', 'арбуз', 'миндаль', 'ваниль'.",
      inputSchema: {
        query: z
          .string()
          .min(2)
          .describe("ingredient or flavor keyword in base form, e.g. 'кокос'"),
      },
    },
    async ({ query }: { query: string }) => {
      try {
        const menu = await readMenu();
        const found = searchMenu(menu, query);
        if (found.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `По запросу «${query}» ничего не найдено.`,
              },
            ],
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(found) }] };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: `Ошибка поиска: ${String(e)}` }],
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
