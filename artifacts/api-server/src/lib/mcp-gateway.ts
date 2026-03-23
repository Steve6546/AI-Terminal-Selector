/**
 * MCP Gateway Client — proxies test/discover requests to the Python FastAPI
 * agent-backend service running on AGENT_BACKEND_PORT (default 9000).
 *
 * Auth: uses ADMIN_SECRET, falling back to SECRET_ENCRYPTION_KEY (matches
 * what the Python gateway expects). Both env vars are Replit secrets.
 *
 * Retry: callGateway accepts a retryCount and retries with exponential backoff
 * on transient failures (network errors, 5xx responses).
 */

const AGENT_BACKEND_URL = `http://localhost:${process.env.AGENT_BACKEND_PORT ?? "9000"}`;
const ADMIN_SECRET =
  process.env.ADMIN_SECRET ?? process.env.SECRET_ENCRYPTION_KEY ?? "";

export interface McpServerConfig {
  transportType: string;
  endpoint?: string | null;
  command?: string | null;
  args?: string[];
  authType?: string;
  authSecret?: string | null;
  timeout?: number;
  retryCount?: number;
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

/**
 * Single attempt to call the Python gateway.
 * Throws on network error or non-OK HTTP status.
 */
async function callGatewayOnce<T>(
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
        retry_count: 0, // retries handled in Node layer
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

/**
 * Call the gateway with bounded retry and exponential backoff.
 * retryCount = 0 means one attempt total (no retries).
 */
async function callGateway<T>(
  path: "/gateway/test" | "/gateway/discover",
  config: McpServerConfig
): Promise<T> {
  const maxAttempts = Math.max(1, (config.retryCount ?? 0) + 1);
  let lastError: Error = new Error("No attempts");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await callGatewayOnce<T>(path, config);
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError;
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
