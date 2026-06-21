// Поиск по составу (retrieval). Чистая логика без побочных эффектов —
// поэтому легко тестируется и переиспользуется в index.ts.
import type { MenuItem } from "../infra/excel.js";
import { config } from "../config.js";

// нормализация: нижний регистр + ё→е
export function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

// разбиваем строку на слова (буквы/цифры)
export function tokenize(s: string): string[] {
  return norm(s)
    .split(/[^a-zа-я0-9]+/i)
    .filter((t) => t.length > 0);
}

// токен запроса совпадает со словом, если одно — префикс другого
// (общая часть от config.minMatchLen): "кокос" ~ "кокосовый"
export function tokenMatch(q: string, w: string): boolean {
  if (Math.min(q.length, w.length) < config.minMatchLen) return q === w;
  return w.startsWith(q) || q.startsWith(w);
}

// Ранжируем меню по запросу: сколько слов запроса нашли в
// «название + состав». Возвращаем только напитки со счётом > 0.
export function searchMenu(menu: MenuItem[], query: string): MenuItem[] {
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
