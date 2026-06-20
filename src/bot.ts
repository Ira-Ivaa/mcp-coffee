// Бот кофейни: Telegram + OpenAI + ручная петля tool-use поверх MCP.
import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { McpClient } from "./mcpClient.js";

// ── Конфигурация из .env ──
const {
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  OPENAI_MODEL = "gpt-4o-mini",
  MCP_URL = "http://localhost:3000/mcp",
} = process.env;

if (!OPENAI_API_KEY) throw new Error("Нет OPENAI_API_KEY в .env");
if (!TELEGRAM_BOT_TOKEN) throw new Error("Нет TELEGRAM_BOT_TOKEN в .env");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Системная инструкция: задаёт роль и правила. Сам ответ пользователю
// модель пишет по-русски, а инструменты выбирает по их английским описаниям.
const SYSTEM_PROMPT = `Ты — бот кофейни. Общайся с гостем ТОЛЬКО на русском языке, дружелюбно и кратко.
Пиши исключительно русскими словами; не вставляй слова на других языках.
- Принимаешь заказы в свободной форме («два капучино, латте») и оформляешь их инструментом create_order.
- Если не уверен в ассортименте — сверься через get_menu. Не выдумывай напитки.
- После оформления назови НОМЕР заказа и время готовности.
- На вопрос о готовности используй get_order_status и скажи, сколько минут осталось.
- Если гость просит напиток не из меню — вежливо предложи альтернативу из меню.`;

// ── Конвертация инструментов MCP -> формат function-calling OpenAI ──
// inputSchema из MCP уже является JSON Schema, поэтому кладём её напрямую.
function toOpenAITools(
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// История диалога на каждый чат (в памяти; перезапуск её обнуляет).
const histories = new Map<number, ChatCompletionMessageParam[]>();
function getHistory(chatId: number): ChatCompletionMessageParam[] {
  let h = histories.get(chatId);
  if (!h) {
    h = [{ role: "system", content: SYSTEM_PROMPT }];
    histories.set(chatId, h);
  }
  return h;
}

// Сколько последних «ходов» гостя держим в истории.
// Ход = сообщение user + ответы модели и инструментов до следующего user.
const MAX_TURNS = 8;

// ── Управление окном контекста ──
// Обрезаем историю по границам ходов, сохраняя инварианты tool-use:
//   1) системное сообщение (индекс 0) остаётся всегда;
//   2) окно всегда начинается с сообщения user — поэтому ни одно
//      tool-сообщение не «осиротеет» (не останется без своего
//      assistant с tool_calls), и OpenAI не вернёт ошибку 400.
// Мутирует массив на месте (это тот же объект, что лежит в Map).
function trimHistory(
  history: ChatCompletionMessageParam[],
  maxTurns: number
): void {
  // индексы начала ходов (сообщения user), не считая системное
  const userIdx: number[] = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i].role === "user") userIdx.push(i);
  }
  if (userIdx.length <= maxTurns) return; // обрезать нечего

  // начало окна = первый user-ход, который оставляем
  const cut = userIdx[userIdx.length - maxTurns];
  const removed = history.splice(1, cut - 1).length; // храним system (0)
  console.log(`[context] обрезано ${removed} старых сообщений, осталось ${history.length}`);
}

// ──────────────────────────────────────────────────────────────
//  РУЧНАЯ ПЕТЛЯ tool-use — ядро всего проекта.
//  1) спрашиваем модель;
//  2) если она хочет вызвать инструмент(ы) — зовём MCP и возвращаем
//     результат обратно в диалог;
//  3) повторяем, пока модель не ответит обычным текстом.
// ──────────────────────────────────────────────────────────────
async function runAgent(
  mcp: McpClient,
  tools: ChatCompletionTool[],
  history: ChatCompletionMessageParam[],
  userText: string
): Promise<string> {
  history.push({ role: "user", content: userText });

  // Обрезаем контекст на границе хода: сейчас новый user — последний,
  // а активная пара assistant/tool этого хода ещё не добавлена.
  trimHistory(history, MAX_TURNS);

  const MAX_STEPS = 6; // защита от бесконечного цикла
  for (let step = 0; step < MAX_STEPS; step++) {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: history,
      tools,
    });

    const msg = completion.choices[0].message;
    history.push(msg); // ответ модели всегда кладём в историю

    // Нет вызовов инструментов — значит это финальный текстовый ответ.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content ?? "…";
    }

    // Есть вызовы — выполняем каждый через MCP и возвращаем результат.
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      let resultText: string;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        resultText = await mcp.callTool(call.function.name, args);
      } catch (e) {
        resultText = `Ошибка вызова инструмента: ${String(e)}`;
      }
      // Роль "tool" + tool_call_id связывают результат с конкретным вызовом.
      history.push({
        role: "tool",
        tool_call_id: call.id,
        content: resultText,
      });
    }
    // продолжаем цикл: модель увидит результаты и решит, что дальше
  }

  return "Извините, не удалось обработать запрос. Попробуйте переформулировать.";
}

// ── Запуск ──
async function main() {
  const mcp = await McpClient.connect(MCP_URL);
  const tools = toOpenAITools(await mcp.listTools());
  console.log(
    `Подключился к MCP (${MCP_URL}), инструментов: ${tools.length}`
  );

  const bot = new Telegraf(TELEGRAM_BOT_TOKEN!);

  bot.start((ctx) =>
    ctx.reply(
      "Привет! Я бот кофейни ☕ Напишите заказ, например «два капучино и латте», " +
        "или спросите статус: «когда готов заказ 2?»"
    )
  );

  bot.on(message("text"), async (ctx) => {
    const chatId = ctx.chat.id;
    try {
      await ctx.sendChatAction("typing");
      const answer = await runAgent(
        mcp,
        tools,
        getHistory(chatId),
        ctx.message.text
      );
      await ctx.reply(answer);
    } catch (e) {
      console.error(e);
      await ctx.reply("Что-то пошло не так. Попробуйте ещё раз.");
    }
  });

  // launch() в Telegraf 4 резолвится только при остановке бота — не ждём его.
  bot.launch();
  console.log("Telegram-бот запущен. Останов: Ctrl+C");

  // Корректное завершение.
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
