// Управление окном контекста: обрезка истории по границам «ходов».
// Чистая логика (мутирует переданный массив) — легко тестируется.
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Обрезаем историю до maxTurns последних ходов, сохраняя инварианты tool-use:
//   1) системное сообщение (индекс 0) остаётся всегда;
//   2) окно всегда начинается с сообщения user — поэтому ни одно
//      tool-сообщение не «осиротеет» (не останется без своего
//      assistant с tool_calls), и OpenAI не вернёт ошибку 400.
// Ход = сообщение user + ответы модели и инструментов до следующего user.
export function trimHistory(
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
  console.log(
    `[context] обрезано ${removed} старых сообщений, осталось ${history.length}`
  );
}
