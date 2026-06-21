import { test } from "node:test";
import assert from "node:assert/strict";
import { trimHistory } from "../domain/history.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Строит историю из N ходов; нечётные ходы — с вызовом инструмента
// (assistant с tool_calls → tool → assistant), чётные — просто текст.
function build(turns: number): ChatCompletionMessageParam[] {
  const h: ChatCompletionMessageParam[] = [{ role: "system", content: "sys" }];
  for (let t = 1; t <= turns; t++) {
    h.push({ role: "user", content: `u${t}` });
    if (t % 2 === 1) {
      h.push({
        role: "assistant",
        content: null,
        tool_calls: [
          { id: `c${t}`, type: "function", function: { name: "x", arguments: "{}" } },
        ],
      });
      h.push({ role: "tool", tool_call_id: `c${t}`, content: "res" });
      h.push({ role: "assistant", content: `a${t}` });
    } else {
      h.push({ role: "assistant", content: `a${t}` });
    }
  }
  return h;
}

test("trimHistory: не режет, если ходов <= лимита", () => {
  const h = build(3);
  const before = h.length;
  trimHistory(h, 5);
  assert.equal(h.length, before);
});

test("trimHistory: оставляет system + последние N ходов", () => {
  const h = build(5);
  trimHistory(h, 2);
  assert.equal(h[0].role, "system");
  assert.equal(h[1].role, "user");
  assert.equal(h.filter((m) => m.role === "user").length, 2);
});

test("trimHistory: ни одного осиротевшего tool", () => {
  const h = build(5);
  trimHistory(h, 2);
  for (let i = 0; i < h.length; i++) {
    if (h[i].role !== "tool") continue;
    let hasParent = false;
    for (let j = i - 1; j >= 1; j--) {
      const m = h[j] as { role: string; tool_calls?: unknown };
      if (m.role === "assistant" && m.tool_calls) { hasParent = true; break; }
      if (m.role === "user") break;
    }
    assert.ok(hasParent, `осиротевший tool на позиции ${i}`);
  }
});
