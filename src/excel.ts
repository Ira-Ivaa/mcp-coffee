// Весь доступ к Excel живёт здесь. Остальной код зовёт эти функции
// и ничего не знает про exceljs, номера колонок и т.п.
import ExcelJS from "exceljs";
import path from "node:path";
import { existsSync } from "node:fs";

// Файлы лежат в папке data/ в корне проекта.
// npm-скрипты запускаются из корня, поэтому process.cwd() = корень.
const DATA_DIR = path.resolve(process.cwd(), "data");
const MENU_PATH = path.join(DATA_DIR, "menu.xlsx");
const ORDERS_PATH = path.join(DATA_DIR, "orders.xlsx");

// ---- Типы, которыми оперирует остальной код ----

export type MenuItem = {
  drink: string; // название напитка, как в меню
  price: number; // цена
  minutes: number; // время приготовления одной порции, мин
};

export type OrderItem = {
  drink: string; // название напитка
  qty: number; // количество
};

export type Order = {
  id: number;
  items: OrderItem[]; // что заказали
  totalMinutes: number; // суммарное время готовности
  createdAt: string; // ISO-время создания
  status: string; // "принят" | "готовится" | "готов"
};

// ---- Чтение меню ----

export async function readMenu(): Promise<MenuItem[]> {
  if (!existsSync(MENU_PATH)) {
    throw new Error(`Файл меню не найден: ${MENU_PATH}`);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(MENU_PATH);
  const ws = wb.worksheets[0];

  const menu: MenuItem[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // пропускаем строку-заголовок
    const drink = String(row.getCell(1).value ?? "").trim();
    if (!drink) return; // пропускаем пустые строки
    const price = Number(row.getCell(2).value ?? 0);
    const minutes = Number(row.getCell(3).value ?? 0);
    menu.push({ drink, price, minutes });
  });
  return menu;
}

// ---- Заказы ----

// Открывает orders.xlsx, создаёт с заголовком, если файла ещё нет.
async function loadOrdersWorkbook(): Promise<{
  wb: ExcelJS.Workbook;
  ws: ExcelJS.Worksheet;
}> {
  const wb = new ExcelJS.Workbook();
  let ws: ExcelJS.Worksheet;
  if (existsSync(ORDERS_PATH)) {
    await wb.xlsx.readFile(ORDERS_PATH);
    ws = wb.worksheets[0];
  } else {
    ws = wb.addWorksheet("Заказы");
    ws.addRow([
      "id",
      "напитки",
      "количество",
      "время_приготовления_мин",
      "создан",
      "статус",
    ]);
  }
  return { wb, ws };
}

// Превращает [{drink:"капучино",qty:2}] в строку "капучино x2; латте x1"
function itemsToText(items: OrderItem[]): string {
  return items.map((i) => `${i.drink} x${i.qty}`).join("; ");
}

// Обратно: строку "капучино x2; латте x1" в массив объектов
function textToItems(text: string): OrderItem[] {
  return text
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.+?)\s*x(\d+)$/i);
      if (m) return { drink: m[1].trim(), qty: Number(m[2]) };
      return { drink: part, qty: 1 };
    });
}

export async function createOrder(
  items: OrderItem[],
  totalMinutes: number
): Promise<Order> {
  const { wb, ws } = await loadOrdersWorkbook();

  // id = номер следующей строки. rowCount уже учитывает заголовок,
  // поэтому первый заказ получит id = 2 (он же номер своей строки).
  const nextId = ws.rowCount + 1;
  const createdAt = new Date().toISOString();
  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
  const status = "принят";

  ws.addRow([
    nextId,
    itemsToText(items),
    totalQty,
    totalMinutes,
    createdAt,
    status,
  ]);
  await wb.xlsx.writeFile(ORDERS_PATH);

  return { id: nextId, items, totalMinutes, createdAt, status };
}

export async function getOrder(id: number): Promise<Order | undefined> {
  if (!existsSync(ORDERS_PATH)) return undefined;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ORDERS_PATH);
  const ws = wb.worksheets[0];

  let found: Order | undefined;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const rowId = Number(row.getCell(1).value ?? 0);
    if (rowId !== id) return;
    found = {
      id: rowId,
      items: textToItems(String(row.getCell(2).value ?? "")),
      totalMinutes: Number(row.getCell(4).value ?? 0),
      createdAt: String(row.getCell(5).value ?? ""),
      status: String(row.getCell(6).value ?? ""),
    };
  });
  return found;
}
