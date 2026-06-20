// MCP-клиент: подключается к нашему серверу по Streamable HTTP.
// Прячет детали SDK, наружу даёт listTools() и callTool().
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type McpTool = {
  name: string;
  description: string;
  // JSON Schema аргументов (SDK сам конвертирует zod -> JSON Schema).
  inputSchema: Record<string, unknown>;
};

export class McpClient {
  private client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  // Фабрика: создаёт клиент и подключается к серверу.
  static async connect(url: string): Promise<McpClient> {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: "coffee-bot", version: "1.0.0" });
    await client.connect(transport);
    return new McpClient(client);
  }

  // Список инструментов сервера.
  async listTools(): Promise<McpTool[]> {
    const res = await this.client.listTools();
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));
  }

  // Вызов инструмента. Возвращаем текст результата (всё, что сервер
  // положил в content[type=text]) — именно его мы вернём модели.
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const res = await this.client.callTool({ name, arguments: args });
    const content = (res.content ?? []) as Array<{
      type: string;
      text?: string;
    }>;
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
  }
}
