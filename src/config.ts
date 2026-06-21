import "dotenv/config";

export const config = {
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",

  mcpUrl: process.env.MCP_URL ?? "http://localhost:3000/mcp",
  port: Number(process.env.PORT ?? 3000),

  maxTurns: 8,
  maxSteps: 6,

  minMatchLen: 3,

  maxDrinksPerOrder: 100,
} as const;