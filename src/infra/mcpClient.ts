// MCP-клиент: подключается к нашему серверу по Streamable HTTP.
// Прячет детали SDK, наружу даёт listTools() и callTool().
// Умеет переподключаться: если сессия протухла (например, сервер
// перезапустили), один раз пере-connect-ится и повторяет запрос.
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
  private url: string;

  private constructor(client: Client, url: string) {
    this.client = client;
    this.url = url;
  }

  // Создаёт новый низкоуровневый клиент SDK и подключается (рукопожатие).
  private static async newClient(url: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: "coffee-bot", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  // Фабрика: создаёт обёртку и подключается к серверу.
  static async connect(url: string): Promise<McpClient> {
    const client = await McpClient.newClient(url);
    return new McpClient(client, url);
  }

  // Поднимает новое соединение взамен умершего (новая сессия на сервере).
  private async reconnect(): Promise<void> {
    this.client = await McpClient.newClient(this.url);
  }

  // Выполняет операцию; если упала (обрыв/протухшая сессия) — один раз
  // переподключается и повторяет. Вторая ошибка пробрасывается наружу.
  private async withReconnect<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      console.warn(`[mcp] запрос не прошёл (${String(e)}); переподключаюсь…`);
      await this.reconnect();
      return await op(); // вторая попытка уже на свежем соединении
    }
  }

  // Список инструментов сервера.
  async listTools(): Promise<McpTool[]> {
    const res = await this.withReconnect(() => this.client.listTools());
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
    const res = await this.withReconnect(() =>
      this.client.callTool({ name, arguments: args })
    );
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
