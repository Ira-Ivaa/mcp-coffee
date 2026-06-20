# CLAUDE.md

Learning project for MCP on TypeScript. We write both sides ourselves: the MCP
server (tools) in [src/index.ts](src/index.ts) and an MCP client/bot with a
manual tool-use loop on OpenAI. Goal — understand how MCP works, without
ready-made wrappers.

## Environment
- Node.js 24, **npm** (not pnpm/yarn). Windows, PowerShell.
- PowerShell needs ExecutionPolicy `RemoteSigned` for CurrentUser, otherwise
  `npm` is blocked (`npm.ps1`).

## Commands
- `npm run dev` — development (tsx watch).
- `npm run build` — build to `dist/` (tsc); must pass before committing.
- `npm start` — run the build.

## Architecture
- Tools are assembled in `buildServer()` in [src/index.ts](src/index.ts).
- Transport: Streamable HTTP, Express, port **3000**, path **`/mcp`**
  (POST/GET/DELETE), sessions keyed by the `mcp-session-id` header.
- The bot connects to the server at `http://localhost:3000/mcp` (both local).

## Conventions
- Register tools via `server.registerTool(name, config, handler)`;
  `server.tool(...)` is deprecated, do not use it.
- `config` = `{ title, description, inputSchema }`. Schemas — zod with
  `.describe()`.
- The tool description is critical: the model picks a tool by its description.
- Return tool errors as `{ isError: true, content: [...] }`, do not throw.
- Secrets — only via `.env` / environment variables, never hardcode.
