import { db } from "@workspace/db";
import { mcpServers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { serverStatusEmitter, type McpServerStatus } from "./server-status-emitter";
import { deepHealthCheck, type McpServerConfig } from "./mcp-gateway";
import { unmaskSecret } from "./secret-utils";

let CHECK_INTERVAL_MS = 60_000;

export function setHealthCheckInterval(ms: number) {
  CHECK_INTERVAL_MS = ms;
  if (_interval) {
    clearInterval(_interval);
    _interval = setInterval(() => {
      runHealthChecks().catch((err) => logger.error({ err }, "Health check error"));
    }, CHECK_INTERVAL_MS);
  }
}

async function performDeepCheck(server: {
  id: number;
  name: string;
  transportType: string;
  endpoint: string | null;
  command: string | null;
  args: unknown;
  authType: string;
  encryptedSecret: string | null;
  timeout: number;
  retryCount: number;
}): Promise<{ status: McpServerStatus; latencyMs: number; errorMessage?: string }> {
  const config: McpServerConfig = {
    transportType: server.transportType,
    endpoint: server.endpoint,
    command: server.command,
    args: (server.args as string[] | null) ?? [],
    authType: server.authType,
    authSecret: unmaskSecret(server.encryptedSecret),
    timeout: server.timeout ?? 30,
    retryCount: 0,
  };

  try {
    const result = await deepHealthCheck(config);
    return {
      status: result.status as McpServerStatus,
      latencyMs: result.latencyMs,
      errorMessage: result.error,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Gateway request timed out") || msg.includes("ECONNREFUSED")) {
      return { status: "disconnected", latencyMs: 0, errorMessage: msg };
    }
    return { status: "error", latencyMs: 0, errorMessage: msg };
  }
}

async function runHealthChecks() {
  try {
    const servers = await db
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        transportType: mcpServers.transportType,
        endpoint: mcpServers.endpoint,
        command: mcpServers.command,
        args: mcpServers.args,
        authType: mcpServers.authType,
        encryptedSecret: mcpServers.encryptedSecret,
        timeout: mcpServers.timeout,
        retryCount: mcpServers.retryCount,
      })
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true));

    for (const server of servers) {
      serverStatusEmitter.broadcast({
        serverId: server.id,
        name: server.name,
        status: "checking",
        lastCheckedAt: new Date().toISOString(),
      });

      const result = await performDeepCheck(server);
      const now = new Date();

      const updateData: Record<string, unknown> = {
        status: result.status,
        lastCheckedAt: now,
        latencyMs: result.latencyMs,
      };

      if (result.status === "connected") {
        updateData.lastSuccessAt = now;
        updateData.lastErrorMessage = null;
      } else {
        updateData.lastFailureAt = now;
        if (result.errorMessage) {
          updateData.lastErrorMessage = result.errorMessage;
        }
      }

      await db.update(mcpServers).set(updateData).where(eq(mcpServers.id, server.id));

      logger.debug({
        serverId: server.id,
        name: server.name,
        status: result.status,
        latencyMs: result.latencyMs,
      }, "Deep health check complete");

      serverStatusEmitter.broadcast({
        serverId: server.id,
        name: server.name,
        status: result.status,
        lastCheckedAt: now.toISOString(),
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
  logger.info({ intervalMs: CHECK_INTERVAL_MS }, "Starting MCP deep health check job");
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
