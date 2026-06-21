import { test } from "node:test";
import assert from "node:assert/strict";
import { searchMenu, tokenMatch, tokenize, norm } from "../domain/search.js";
import type { MenuItem } from "../infra/excel.js";

const menu: MenuItem[] = [
  { drink: "Баунти", price: 240, minutes: 5, composition: "кофе, кокосовое молоко, кокосовый сироп" },
  { drink: "Розовая волна", price: 260, minutes: 4, composition: "арбузный сироп, газированная вода, лёд" },
  { drink: "латте", price: 200, minutes: 5, composition: "кофе, молоко" },
];

test("norm: нижний регистр и ё→е", () => {
  assert.equal(norm("КофЕ Ёлка"), "кофе елка");
});

test("tokenize разбивает строку на слова", () => {
  assert.deepEqual(tokenize("кофе, молоко"), ["кофе", "молоко"]);
});

test("tokenMatch по префиксу: кокос ~ кокосовый", () => {
  assert.equal(tokenMatch("кокос", "кокосовый"), true);
  assert.equal(tokenMatch("кокос", "молоко"), false);
});

test("searchMenu находит по составу, а не по названию", () => {
  const res = searchMenu(menu, "кокос"); // в названии «Баунти» кокоса нет
  assert.deepEqual(res.map((r) => r.drink), ["Баунти"]);
});

test("searchMenu: арбуз → Розовая волна", () => {
  assert.deepEqual(searchMenu(menu, "арбуз").map((r) => r.drink), ["Розовая волна"]);
});

test("searchMenu: пустой запрос → пусто", () => {
  assert.deepEqual(searchMenu(menu, ""), []);
});

test("searchMenu: нет совпадений → пусто", () => {
  assert.deepEqual(searchMenu(menu, "банан"), []);
});
