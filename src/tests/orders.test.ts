import { test } from "node:test";
import assert from "node:assert/strict";
import { priceOrder, orderTotalQty } from "../domain/orders.js";
import type { MenuItem } from "../infra/excel.js";

const menu: MenuItem[] = [
  { drink: "капучино", price: 180, minutes: 4, composition: "" },
  { drink: "латте", price: 200, minutes: 5, composition: "" },
];

test("priceOrder: сумма время × количество", () => {
  const r = priceOrder([{ drink: "капучино", qty: 2 }, { drink: "латте", qty: 1 }], menu);
  assert.deepEqual(r, { ok: true, totalMinutes: 13 }); // 2*4 + 1*5
});

test("priceOrder: регистр названия не важен", () => {
  assert.deepEqual(priceOrder([{ drink: "КаПуЧино", qty: 1 }], menu), {
    ok: true,
    totalMinutes: 4,
  });
});

test("priceOrder: напитка нет в меню → ok:false с названием", () => {
  assert.deepEqual(priceOrder([{ drink: "мохито", qty: 1 }], menu), {
    ok: false,
    missingDrink: "мохито",
  });
});

test("orderTotalQty суммирует количество всех позиций", () => {
  assert.equal(orderTotalQty([{ drink: "a", qty: 3 }, { drink: "b", qty: 2 }]), 5);
});
