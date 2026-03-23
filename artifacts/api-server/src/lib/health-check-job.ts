import { db } from "@workspace/db";
import { mcpServers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { serverStatusEmitter, type McpServerStatus } from "./server-status-emitter";

const CHECK_INTERVAL_MS = 30_000;

interface HealthResult {
  status: McpServerStatus;
  latencyMs: number;
  errorMessage?: string;
}

async function checkServerHealth(server: {
  id: number;
  endpoint: string | null;
  name: string;
  transportType: string;
  authType: string | null;
}): Promise<HealthResult> {
  // stdio servers run as local processes — they are considered connected if enabled
  if (server.transportType === "stdio") {
    return { status: "connected", latencyMs: 0 };
  }

  if (!server.endpoint) {
    return { status: "error", latencyMs: 0, errorMessage: "No endpoint configured" };
  }

  const start = Date.now();

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);

    let res: Response | null = null;
    try {
      res = await fetch(server.endpoint, {
        method: "GET",
        signal: ctrl.signal,
        headers: { "Accept": "application/json, text/plain, */*" },
      });
    } catch (err) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort") || msg.includes("timeout")) {
        return { status: "disconnected", latencyMs, errorMessage: "Connection timed out" };
      }
      return { status: "disconnected", latencyMs, errorMessage: msg };
    }

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res.status === 401 || res.status === 403) {
      return {
        status: "auth_required",
        latencyMs,
        errorMessage: `HTTP ${res.status}: Authentication required`,
      };
    }

    if (res.status >= 500) {
      return {
        status: "degraded",
        latencyMs,
        errorMessage: `HTTP ${res.status}: Server error`,
      };
    }

    // Any other 4xx or 2xx means server is reachable (could be MCP-specific endpoint)
    if (res.status < 500) {
      return { status: "connected", latencyMs };
    }

    return { status: "error", latencyMs, errorMessage: `HTTP ${res.status}` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return {
      status: "error",
      latencyMs,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runHealthChecks() {
  try {
    const servers = await db
      .select({
        id: mcpServers.id,
        endpoint: mcpServers.endpoint,
        name: mcpServers.name,
        transportType: mcpServers.transportType,
        authType: mcpServers.authType,
      })
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true));

    for (const server of servers) {
      // Emit checking state first so UI can show spinner
      serverStatusEmitter.broadcast({
        serverId: server.id,
        name: server.name,
        status: "checking",
        lastCheckedAt: new Date().toISOString(),
      });

      const result = await checkServerHealth(server);
      const lastCheckedAt = new Date();

      // Map "connected" to the DB-known status values (connected/error)
      const dbStatus = result.status === "connected" ? "connected" : "error";

      await db.update(mcpServers)
        .set({ status: dbStatus, lastCheckedAt })
        .where(eq(mcpServers.id, server.id));

      logger.debug({ serverId: server.id, name: server.name, status: result.status, latencyMs: result.latencyMs }, "Health check complete");

      serverStatusEmitter.broadcast({
        serverId: server.id,
        name: server.name,
        status: result.status,
        lastCheckedAt: lastCheckedAt.toISOString(),
        latencyMs: result.latencyMs,
        errorMessage: result.errorMessage,
      });
    }
  } catch (err) {
    logger.error({ err }, "Health check job failed");
  }
}

let _interval: NodeJS.Timeout | null = null;

export function startHealthCheckJob() {
  if (_interval) return;
  logger.info("Starting MCP server health check job (30s interval)");
  _interval = setInterval(() => {
    runHealthChecks().catch((err) => logger.error({ err }, "Health check error"));
  }, CHECK_INTERVAL_MS);
  runHealthChecks().catch((err) => logger.error({ err }, "Initial health check error"));
}

export function stopHealthCheckJob() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
