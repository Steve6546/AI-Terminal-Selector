import { db } from "@workspace/db";
import { mcpServers, mcpTools, executions } from "@workspace/db";
import { eq, count } from "drizzle-orm";

export async function getSystemStatus() {
  const serverStats = await db
    .select({ status: mcpServers.status, count: count() })
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true))
    .groupBy(mcpServers.status);

  let connectedServers = 0;
  let disconnectedServers = 0;
  for (const stat of serverStats) {
    if (stat.status === "connected") {
      connectedServers = Number(stat.count);
    } else {
      disconnectedServers += Number(stat.count);
    }
  }

  const toolCountResult = await db.select({ count: count() }).from(mcpTools).where(eq(mcpTools.enabled, true));
  const activeExecutionsResult = await db.select({ count: count() }).from(executions).where(eq(executions.status, "running"));

  return {
    connectedServers,
    disconnectedServers,
    totalTools: Number(toolCountResult[0]?.count ?? 0),
    agentState: Number(activeExecutionsResult[0]?.count ?? 0) > 0 ? "busy" : "idle",
    activeExecutions: Number(activeExecutionsResult[0]?.count ?? 0),
  };
}

export async function getSystemExecutions(conversationId?: number, limit = 20) {
  const selectShape = {
    id: executions.id,
    conversationId: executions.conversationId,
    serverId: executions.serverId,
    toolName: executions.toolName,
    status: executions.status,
    startedAt: executions.startedAt,
    completedAt: executions.completedAt,
    durationMs: executions.durationMs,
    resultSummary: executions.resultSummary,
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
    startedAt: e.startedAt.toISOString(),
    completedAt: e.completedAt?.toISOString(),
    durationMs: e.durationMs,
    resultSummary: e.resultSummary,
  }));
}
