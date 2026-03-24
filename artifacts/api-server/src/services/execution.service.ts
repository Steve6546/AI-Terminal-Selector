import { db } from "@workspace/db";
import { executions, mcpServers, mcpTools } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeMcpTool } from "../lib/mcp-gateway";
import { unmaskSecret } from "../lib/secret-utils";
import { checkEndpointAllowed } from "../lib/domain-allowlist";
import { recordToolExecution } from "./metrics.service";
import { logOperation } from "../lib/structured-log";

export async function listExecutions(conversationId?: number, limit = 20) {
  const selectShape = {
    id: executions.id,
    conversationId: executions.conversationId,
    serverId: executions.serverId,
    toolName: executions.toolName,
    status: executions.status,
    arguments: executions.arguments,
    startedAt: executions.startedAt,
    completedAt: executions.completedAt,
    durationMs: executions.durationMs,
    resultSummary: executions.resultSummary,
    rawResult: executions.rawResult,
    serverName: mcpServers.name,
  } as const;

  const results = conversationId
    ? await db
        .select(selectShape)
        .from(executions)
        .leftJoin(mcpServers, eq(executions.serverId, mcpServers.id))
        .where(eq(executions.conversationId, conversationId))
        .limit(limit)
    : await db
        .select(selectShape)
        .from(executions)
        .leftJoin(mcpServers, eq(executions.serverId, mcpServers.id))
        .limit(limit);

  return results.map((e) => ({
    id: e.id,
    conversationId: e.conversationId,
    serverId: e.serverId,
    serverName: e.serverName,
    toolName: e.toolName,
    status: e.status,
    arguments: e.arguments,
    startedAt: e.startedAt.toISOString(),
    completedAt: e.completedAt?.toISOString(),
    durationMs: e.durationMs,
    resultSummary: e.resultSummary,
    rawResult: e.rawResult,
  }));
}

export async function executeToolDirect(
  toolId: number,
  toolArgs: Record<string, unknown>,
  conversationId?: number,
  approved?: boolean,
) {
  const [tool] = await db.select().from(mcpTools).where(eq(mcpTools.id, toolId));
  if (!tool) return { notFound: "Tool not found" };

  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, tool.serverId));
  if (!server) return { notFound: "Server not found for this tool" };

  if (!tool.enabled) return { error: "Tool is disabled" };

  const allowCheck = await checkEndpointAllowed(server.endpoint, server.transportType);
  if (!allowCheck.allowed) {
    return { forbidden: allowCheck.reason ?? "Endpoint not allowed by domain allowlist" };
  }

  if (tool.requiresApproval && !approved) {
    return {
      requiresApproval: true,
      toolId: tool.id,
      toolName: tool.toolName,
    };
  }

  const [execution] = await db
    .insert(executions)
    .values({
      conversationId: conversationId ?? null,
      serverId: server.id,
      toolName: tool.toolName,
      status: "running",
      arguments: toolArgs,
    })
    .returning();

  const startedAt = Date.now();

  const result = await executeMcpTool(
    {
      transportType: server.transportType,
      endpoint: server.endpoint,
      command: server.command,
      args: (server.args as string[]) ?? [],
      authType: server.authType,
      authSecret: unmaskSecret(server.encryptedSecret),
      timeout: server.timeout,
      retryCount: server.retryCount,
    },
    tool.toolName,
    toolArgs,
  );

  const durationMs = Date.now() - startedAt;

  recordToolExecution(tool.toolName, result.success, durationMs);

  logOperation({
    operation: "tool.execute",
    toolName: tool.toolName,
    serverId: server.id,
    executionId: execution.id,
    conversationId: conversationId ?? undefined,
    status: result.success ? "success" : "error",
    durationMs,
  });

  const summary = result.success
    ? typeof result.content === "string"
      ? result.content.slice(0, 500)
      : JSON.stringify(result.content ?? "").slice(0, 500)
    : result.error ?? "Unknown error";

  const [updated] = await db
    .update(executions)
    .set({
      status: result.success ? "success" : "error",
      completedAt: new Date(),
      durationMs,
      resultSummary: summary,
      rawResult: result.content as Record<string, unknown> | null,
      errorMessage: result.error ?? null,
    })
    .where(eq(executions.id, execution.id))
    .returning();

  return {
    execution: {
      id: updated.id,
      conversationId: updated.conversationId,
      serverId: updated.serverId,
      serverName: server.name,
      toolName: updated.toolName,
      status: updated.status,
      startedAt: updated.startedAt.toISOString(),
      completedAt: updated.completedAt?.toISOString(),
      durationMs: updated.durationMs,
      resultSummary: updated.resultSummary,
      rawResult: updated.rawResult,
      errorMessage: updated.errorMessage,
    },
  };
}
