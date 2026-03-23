import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { mcpServers, mcpTools, executions } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { handleRouteError } from "../../lib/handle-error";

const router: IRouter = Router();

router.get("/status", async (req, res) => {
  try {
    const serverStats = await db
      .select({
        status: mcpServers.status,
        count: count(),
      })
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

    const toolCountResult = await db
      .select({ count: count() })
      .from(mcpTools)
      .where(eq(mcpTools.enabled, true));

    const activeExecutionsResult = await db
      .select({ count: count() })
      .from(executions)
      .where(eq(executions.status, "running"));

    const totalTools = Number(toolCountResult[0]?.count ?? 0);
    const activeExecutions = Number(activeExecutionsResult[0]?.count ?? 0);

    res.json({
      connectedServers,
      disconnectedServers,
      totalTools,
      agentState: activeExecutions > 0 ? "busy" : "idle",
      activeExecutions,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get system status");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/executions", async (req, res) => {
  try {
    const conversationId = req.query.conversationId
      ? parseInt(req.query.conversationId as string)
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

    const results = conversationId
      ? await db
          .select({
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
          })
          .from(executions)
          .leftJoin(mcpServers, eq(executions.serverId, mcpServers.id))
          .where(eq(executions.conversationId, conversationId))
          .limit(limit)
      : await db
          .select({
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
          })
          .from(executions)
          .leftJoin(mcpServers, eq(executions.serverId, mcpServers.id))
          .limit(limit);

    res.json(
      results.map((e) => ({
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
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list executions");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
