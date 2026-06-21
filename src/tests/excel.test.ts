import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsToText, textToItems } from "../infra/excel.js";

test("itemsToText форматирует позиции", () => {
  assert.equal(
    itemsToText([{ drink: "капучино", qty: 2 }, { drink: "латте", qty: 1 }]),
    "капучино x2; латте x1"
  );
});

test("textToItems парсит строку обратно", () => {
  assert.deepEqual(textToItems("капучино x2; латте x1"), [
    { drink: "капучино", qty: 2 },
    { drink: "латте", qty: 1 },
  ]);
});

test("round-trip: items → text → items", () => {
  const items = [{ drink: "Розовый закат", qty: 3 }];
  assert.deepEqual(textToItems(itemsToText(items)), items);
});

test("textToItems: без количества → qty = 1", () => {
  assert.deepEqual(textToItems("капучино"), [{ drink: "капучино", qty: 1 }]);
});
