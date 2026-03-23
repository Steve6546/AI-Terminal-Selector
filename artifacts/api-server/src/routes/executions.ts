import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { executions, mcpServers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { handleRouteError } from "../lib/handle-error";

const router: IRouter = Router();

router.get("/executions", async (req, res) => {
  try {
    const conversationId = req.query.conversationId
      ? parseInt(req.query.conversationId as string)
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

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
        rawResult: e.rawResult,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list executions");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
