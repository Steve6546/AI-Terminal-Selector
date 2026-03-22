import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { executionLogs, executions } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
