# CLAUDE.md

## Project Overview

Learning project for MCP (Model Context Protocol) on TypeScript: we hand-write
**both sides** — the MCP server (tools) and an MCP client + Telegram coffee-shop
bot with a **manual tool-use loop** on OpenAI, no agent frameworks — to
understand MCP and agents from the inside. The server (`src/index.ts`) and the
bot (`src/bot.ts`) run as separate processes talking over HTTP; only the server
touches Excel.

## Project Structure

```
src/
├── index.ts        entry point: MCP server (tools + Streamable HTTP transport)
├── bot.ts          entry point: Telegram + OpenAI + manual tool-use loop
├── config.ts       all tunables in one place (model, port, limits) — no secrets
├── domain/         PURE logic, no I/O — unit-tested without starting the server
│   ├── search.ts     search drinks by ingredient/composition (retrieval)
│   ├── orders.ts     order pricing: validate against menu, sum time
│   └── history.ts    context-window trimming (trimHistory)
├── infra/          adapters to the outside world
│   ├── excel.ts      storage layer (ExcelJS): read menu, read/write orders
│   └── mcpClient.ts  MCP client with auto-reconnect
└── tests/          unit tests (node:test) for the pure logic in domain/ + parsing
data/
└── menu.xlsx       menu (напиток | цена | время_приготовления_мин | состав)
                    orders.xlsx is created on the first order (gitignored)
.github/workflows/ci.yml   CI: npm ci → build → test on push/PR
```

Architecture principle: entry points on top, **pure core (`domain/`) separated
from outside-world adapters (`infra/`)** — hexagonal-style. The server never
knows about OpenAI; OpenAI never knows about Excel; the bot is the translator.

## Commands

- `npm run dev` — MCP server (tsx watch).
- `npm run dev:bot` — Telegram bot (tsx watch).
- `npm run build` — compile to `dist/` via `tsc -p tsconfig.build.json`; must
  pass before committing.
- `npm start` / `npm run start:bot` — run the built server / bot.
- `npm test` — unit tests (`node --import tsx --test "src/**/*.test.ts"`).

## Conventions

- **Tools:** register via `server.registerTool(name, config, handler)`;
  `server.tool(...)` is deprecated — do not use it. `config` =
  `{ title, description, inputSchema }`; schemas are zod with `.describe()`.
- **Tool descriptions are the contract:** the model picks a tool and fills
  arguments from them. Write them in **English**. Keep "when/how to use a tool"
  (including argument form) **in the tool description**, not duplicated in the
  system prompt — single source of truth. The system prompt holds role, language,
  tone and business rules.
- **Tool errors:** return `{ isError: true, content: [...] }`, do not throw.
  Error text may be Russian (the model relays it to the user).
- **Layering:** business logic lives in tools/`domain/` (pure, testable);
  `infra/excel.ts` is a dumb storage layer — keep calculations out of it.
- **Config:** all tunables in `config.ts` (no magic numbers scattered around).
  No secrets there.
- **Secrets:** only via `.env` / env vars, never hardcoded, never in
  `.env.example`. The bot reads & validates `OPENAI_API_KEY` /
  `TELEGRAM_BOT_TOKEN`; the server must NOT require them.
- **Tests:** `node:test` (no extra framework), files `src/**/*.test.ts`, target
  the pure logic in `domain/`.
- **Commits:** messages in English, short, **no `Co-Authored-By` trailer**.

## Boundaries

**MUST:**

- Use npm + Node 24 on Windows/PowerShell (ExecutionPolicy `RemoteSigned`); ESM — local imports end in `.js`.
- Keep `domain/` free of I/O (so it stays unit-testable).
- Preserve the tool-use invariant when editing history: `assistant` `tool_calls` ↔ `tool` with the same `tool_call_id`; the window starts at a `user` message (else OpenAI 400).
- Keep secrets in `.env` only; the bot validates them, the server runs without them.
- Make `npm run build` and `npm test` pass before committing.
- Free port 3000 on `EADDRINUSE`; stop `dev` with Ctrl+C.

**MUST NOT:**

- Replace the manual tool-use loop with an agent framework.
- Use deprecated `server.tool(...)` — use `registerTool`.
- Throw from tool handlers — return `{ isError: true, content }`.
- Hardcode secrets or put them in `.env.example`.
- Add I/O to `domain/`, run two servers on one port, or assume MCP sessions survive a server restart.
- Duplicate tool-usage details in the system prompt — they live in the tool description.
