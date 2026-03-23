import { db } from "@workspace/db";
import { mcpServers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { serverStatusEmitter } from "./server-status-emitter";

const CHECK_INTERVAL_MS = 60_000;

async function checkServerHealth(server: { id: number; endpoint: string | null; name: string }): Promise<"connected" | "error"> {
  if (!server.endpoint) return "error";
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(server.endpoint, { method: "GET", signal: ctrl.signal }).catch(() => null);
    clearTimeout(timeout);
    // A 2xx or 4xx response means the server is reachable (4xx can be auth)
    return res && res.status < 500 ? "connected" : "error";
  } catch {
    return "error";
  }
}

async function runHealthChecks() {
  try {
    const servers = await db
      .select({ id: mcpServers.id, endpoint: mcpServers.endpoint, name: mcpServers.name, transportType: mcpServers.transportType })
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true));

    for (const server of servers) {
      // Only check HTTP-based transports (not stdio/local)
      if (server.transportType !== "streamable-http" && server.transportType !== "sse") continue;
      const status = await checkServerHealth(server);
      const lastCheckedAt = new Date();
      await db.update(mcpServers).set({ status, lastCheckedAt }).where(eq(mcpServers.id, server.id));
      logger.debug({ serverId: server.id, name: server.name, status }, "Health check complete");
      // Broadcast to SSE subscribers so UI can update without waiting for next poll
      serverStatusEmitter.broadcast({
        serverId: server.id,
        name: server.name,
        status,
        lastCheckedAt: lastCheckedAt.toISOString(),
      });
    }
  } catch (err) {
    logger.error({ err }, "Health check job failed");
  }
}

let _interval: NodeJS.Timeout | null = null;

export function startHealthCheckJob() {
  if (_interval) return;
  logger.info("Starting MCP server health check job (60s interval)");
  _interval = setInterval(() => {
    runHealthChecks().catch((err) => logger.error({ err }, "Health check error"));
  }, CHECK_INTERVAL_MS);
  // Run immediately on startup too
  runHealthChecks().catch((err) => logger.error({ err }, "Initial health check error"));
}

export function stopHealthCheckJob() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
