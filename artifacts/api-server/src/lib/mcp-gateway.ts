/**
 * MCP Gateway Client — proxies test/discover requests to the Python FastAPI
 * agent-backend service running on AGENT_BACKEND_PORT (default 9000).
 *
 * The Python service implements the real MCP SDK calls so we have full stdio
 * and streamable-http support without spawning Node subprocesses inline.
 */

const AGENT_BACKEND_URL = `http://localhost:${process.env.AGENT_BACKEND_PORT ?? "9000"}`;
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

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
}

export interface McpTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

async function callGateway<T>(
  path: "/gateway/test" | "/gateway/discover",
  config: McpServerConfig
): Promise<T> {
  const timeoutMs = ((config.timeout ?? 30) + 15) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${AGENT_BACKEND_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transport_type: config.transportType,
        endpoint: config.endpoint,
        command: config.command,
        args: config.args ?? [],
        auth_type: config.authType ?? "none",
        auth_secret: config.authSecret,
        timeout: config.timeout ?? 30,
        authorization: ADMIN_SECRET ? `Bearer ${ADMIN_SECRET}` : undefined,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gateway returned ${res.status}: ${body}`);
    }

    return (await res.json()) as T;
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string }).name === "AbortError") {
      throw new Error("Gateway request timed out");
    }
    throw err;
  }
}

export async function testMcpConnection(config: McpServerConfig): Promise<McpTestResult> {
  const result = await callGateway<{
    success: boolean;
    message: string;
    latency_ms: number;
  }>("/gateway/test", config);
  return {
    success: result.success,
    message: result.message,
    latencyMs: result.latency_ms,
  };
}

export async function discoverMcpCapabilities(
  config: McpServerConfig
): Promise<McpDiscoveryResult> {
  const result = await callGateway<{
    tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>;
    resources: Array<{ uri: string; name: string; description?: string; mime_type?: string }>;
    prompts: Array<{ name: string; description?: string }>;
  }>("/gateway/discover", config);

  return {
    tools: result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    })),
    resources: result.resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mime_type,
    })),
    prompts: result.prompts.map((p) => ({
      name: p.name,
      description: p.description,
    })),
  };
}
