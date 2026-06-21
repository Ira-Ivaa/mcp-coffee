// Доменная логика заказа: проверка напитков по меню и расчёт времени.
// Чистые функции без побочных эффектов — легко тестируются.
import type { MenuItem, OrderItem } from "../infra/excel.js";

// Результат проверки/расчёта заказа: либо общее время, либо первый
// напиток, которого нет в меню (чтобы вызывающий собрал сообщение).
export type OrderPricing =
  | { ok: true; totalMinutes: number }
  | { ok: false; missingDrink: string };

// Сумма времени по заказу = время × количество, по всем позициям.
// Если напитка нет в меню — возвращаем ok:false с его названием.
export function priceOrder(
  items: OrderItem[],
  menu: MenuItem[]
): OrderPricing {
  let totalMinutes = 0;
  for (const it of items) {
    const m = menu.find(
      (x) => x.drink.toLowerCase() === it.drink.toLowerCase()
    );
    if (!m) return { ok: false, missingDrink: it.drink };
    totalMinutes += m.minutes * it.qty;
  }
  return { ok: true, totalMinutes };
}

// Суммарное количество напитков в заказе (для лимита).
export function orderTotalQty(items: OrderItem[]): number {
  return items.reduce((sum, it) => sum + it.qty, 0);
}
