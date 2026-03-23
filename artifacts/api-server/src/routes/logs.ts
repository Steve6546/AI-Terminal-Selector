import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { executionLogs, executions, mcpServers } from "@workspace/db";
import { eq, desc, and, gte, lte, inArray } from "drizzle-orm";
import { handleRouteError } from "../lib/handle-error";

const router: IRouter = Router();

router.get("/executions/:executionId/logs", async (req, res) => {
  try {
    const executionId = parseInt(req.params.executionId);

    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.id, executionId));

    if (!execution) {
      res.status(404).json({ error: "Execution not found" });
      return;
    }

    const logs = await db
      .select()
      .from(executionLogs)
      .where(eq(executionLogs.executionId, executionId))
      .orderBy(executionLogs.createdAt);

    res.json(
      logs.map((l) => ({
        id: l.id,
        executionId: l.executionId,
        level: l.level,
        eventType: l.eventType,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list execution logs");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/execution-logs", async (req, res) => {
  try {
    const {
      level,
      eventType,
      serverId: serverIdStr,
      after,
      before,
      limit: limitStr,
    } = req.query as Record<string, string | undefined>;

    const limit = Math.min(parseInt(limitStr ?? "200", 10) || 200, 500);

    const conditions = [];

    if (level) {
      const levels = level.split(",").filter(Boolean);
      if (levels.length > 0) {
        conditions.push(inArray(executionLogs.level, levels));
      }
    }

    if (eventType) {
      const types = eventType.split(",").filter(Boolean);
      if (types.length > 0) {
        conditions.push(inArray(executionLogs.eventType, types));
      }
    }

    if (after) {
      const afterDate = new Date(after);
      if (!isNaN(afterDate.getTime())) {
        conditions.push(gte(executionLogs.createdAt, afterDate));
      }
    }

    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        conditions.push(lte(executionLogs.createdAt, beforeDate));
      }
    }

    if (serverIdStr) {
      const serverId = parseInt(serverIdStr, 10);
      if (!isNaN(serverId)) {
        const serverExecutionIds = await db
          .select({ id: executions.id })
          .from(executions)
          .where(eq(executions.serverId, serverId));
        const ids = serverExecutionIds.map((e) => e.id);
        if (ids.length > 0) {
          conditions.push(inArray(executionLogs.executionId, ids));
        } else {
          res.json([]);
          return;
        }
      }
    }

    const logs = await db
      .select({
        id: executionLogs.id,
        executionId: executionLogs.executionId,
        level: executionLogs.level,
        eventType: executionLogs.eventType,
        message: executionLogs.message,
        createdAt: executionLogs.createdAt,
        toolName: executions.toolName,
        executionStatus: executions.status,
        serverId: executions.serverId,
      })
      .from(executionLogs)
      .leftJoin(executions, eq(executionLogs.executionId, executions.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(executionLogs.createdAt))
      .limit(limit);

    const serverIds = [...new Set(logs.map((l) => l.serverId).filter((id): id is number => id != null))];
    const serverNames: Record<number, string> = {};
    if (serverIds.length > 0) {
      const servers = await db
        .select({ id: mcpServers.id, name: mcpServers.name })
        .from(mcpServers)
        .where(inArray(mcpServers.id, serverIds));
      for (const s of servers) {
        serverNames[s.id] = s.name;
      }
    }

    res.json(
      logs.map((l) => ({
        id: l.id,
        executionId: l.executionId,
        level: l.level,
        eventType: l.eventType,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
        toolName: l.toolName,
        executionStatus: l.executionStatus,
        serverName: l.serverId ? serverNames[l.serverId] : null,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list execution logs");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
