import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpServerConfig {
  transportType: string;
  endpoint?: string | null;
  command?: string | null;
  args?: string[];
  authType?: string;
  authSecret?: string | null;
  timeout?: number;
}

export interface McpDiscoveryResult {
  tools: McpDiscoveredTool[];
  resources: McpDiscoveredResource[];
  prompts: McpDiscoveredPrompt[];
}

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpDiscoveredResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpDiscoveredPrompt {
  name: string;
  description?: string;
  arguments?: unknown[];
}

export interface McpTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

function buildHeaders(config: McpServerConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.authType === "bearer" && config.authSecret) {
    headers["Authorization"] = `Bearer ${config.authSecret}`;
  } else if (config.authType === "api-key" && config.authSecret) {
    headers["X-API-Key"] = config.authSecret;
  }
  return headers;
}

async function createClient(config: McpServerConfig): Promise<Client> {
  const client = new Client(
    { name: "agent-tool-chat", version: "1.0.0" },
    { capabilities: {} }
  );

  if (config.transportType === "streamable-http") {
    if (!config.endpoint) throw new Error("endpoint is required for streamable-http transport");
    const headers = buildHeaders(config);
    const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
      requestInit: { headers },
    });
    await client.connect(transport);
  } else if (config.transportType === "stdio") {
    if (!config.command) throw new Error("command is required for stdio transport");
    const parts = config.command.split(" ");
    const cmd = parts[0];
    const cmdArgs = [...(parts.slice(1)), ...(config.args ?? [])];
    const transport = new StdioClientTransport({ command: cmd, args: cmdArgs });
    await client.connect(transport);
  } else {
    throw new Error(`Unsupported transport type: ${config.transportType}`);
  }

  return client;
}

export async function testMcpConnection(config: McpServerConfig): Promise<McpTestResult> {
  const start = Date.now();
  const timeoutMs = (config.timeout ?? 30) * 1000;

  let client: Client | null = null;
  const timer = setTimeout(() => {
    client?.close().catch(() => {});
  }, timeoutMs);

  try {
    client = await createClient(config);
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    await client.close();
    return { success: true, message: "Connection successful", latencyMs };
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : "Unknown connection error";
    return { success: false, message, latencyMs };
  }
}

export async function discoverMcpCapabilities(
  config: McpServerConfig
): Promise<McpDiscoveryResult> {
  const timeoutMs = (config.timeout ?? 30) * 1000;
  let client: Client | null = null;

  const abortTimer = setTimeout(() => {
    client?.close().catch(() => {});
  }, timeoutMs);

  try {
    client = await createClient(config);

    const tools: McpDiscoveredTool[] = [];
    const resources: McpDiscoveredResource[] = [];
    const prompts: McpDiscoveredPrompt[] = [];

    try {
      const toolsResp = await client.listTools();
      for (const t of toolsResp.tools) {
        tools.push({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        });
      }
    } catch {
      // Server may not support tools listing
    }

    try {
      const resourcesResp = await client.listResources();
      for (const r of resourcesResp.resources) {
        resources.push({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        });
      }
    } catch {
      // Server may not support resources listing
    }

    try {
      const promptsResp = await client.listPrompts();
      for (const p of promptsResp.prompts) {
        prompts.push({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        });
      }
    } catch {
      // Server may not support prompts listing
    }

    clearTimeout(abortTimer);
    await client.close();
    return { tools, resources, prompts };
  } catch (err) {
    clearTimeout(abortTimer);
    try { await client?.close(); } catch { /* ignore */ }
    throw err;
  }
}
