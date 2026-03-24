import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  runs,
  runEvents,
  toolCalls,
  approvalDecisions,
  executions,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { handleRouteError } from "../lib/handle-error";

const router: IRouter = Router();

function requireLocalhost(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost";
  if (!isLocal) {
    res.status(403).json({ error: "Internal routes are only accessible from localhost" });
    return;
  }
  next();
}

router.use("/internal", requireLocalhost);

router.post("/internal/runs", async (req, res) => {
  try {
    const { runId, conversationId, model, mode, status } = req.body;
    const [row] = await db
      .insert(runs)
      .values({
        runId,
        conversationId,
        model,
        mode: mode || "agent",
        status: status || "running",
      })
      .returning();
    res.status(201).json({ id: row.id, runId: row.runId });
  } catch (err) {
    req.log.error({ err }, "Failed to create run");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/internal/runs/:runId", async (req, res) => {
  try {
    const { runId } = req.params;
    const updates: Record<string, unknown> = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.tokensIn !== undefined) updates.tokensIn = req.body.tokensIn;
    if (req.body.tokensOut !== undefined) updates.tokensOut = req.body.tokensOut;
    if (req.body.errorMessage !== undefined)
      updates.errorMessage = req.body.errorMessage;
    if (
      req.body.status === "completed" ||
      req.body.status === "failed"
    ) {
      updates.completedAt = new Date();
    }

    await db.update(runs).set(updates).where(eq(runs.runId, runId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update run");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/internal/tool-calls", async (req, res) => {
  try {
    const { runId, serverId, toolName, arguments: args, status, requiresApproval } = req.body;
    const [row] = await db
      .insert(toolCalls)
      .values({
        runId: runId || null,
        serverId: serverId || null,
        toolName,
        arguments: args || {},
        status: status || "pending",
        requiresApproval: requiresApproval || false,
      })
      .returning();
    res.status(201).json({ id: row.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create tool call");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/internal/tool-calls/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updates: Record<string, unknown> = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.result !== undefined) updates.result = req.body.result;
    if (req.body.resultSummary !== undefined)
      updates.resultSummary = req.body.resultSummary;
    if (req.body.errorMessage !== undefined)
      updates.errorMessage = req.body.errorMessage;
    if (req.body.approvalDecision !== undefined)
      updates.approvalDecision = req.body.approvalDecision;
    if (req.body.durationMs !== undefined) updates.durationMs = req.body.durationMs;
    if (
      req.body.status === "success" ||
      req.body.status === "error"
    ) {
      updates.completedAt = new Date();
    }

    await db.update(toolCalls).set(updates).where(eq(toolCalls.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update tool call");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/internal/approvals", async (req, res) => {
  try {
    const {
      runId,
      toolCallId,
      toolName,
      serverName,
      inputs,
      decision,
      reason,
    } = req.body;
    const [row] = await db
      .insert(approvalDecisions)
      .values({
        runId: runId || null,
        toolCallId: toolCallId || null,
        toolName,
        serverName: serverName || null,
        inputs: inputs || {},
        decision,
        actor: "user",
        reason: reason || null,
      })
      .returning();
    res.status(201).json({ id: row.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create approval");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/internal/executions", async (req, res) => {
  try {
    const {
      conversationId,
      serverId,
      toolName,
      status,
      arguments: args,
      resultSummary,
      rawResult,
      errorMessage,
      durationMs,
    } = req.body;
    const [row] = await db
      .insert(executions)
      .values({
        conversationId,
        serverId: serverId || null,
        toolName,
        status,
        arguments: args || {},
        resultSummary: resultSummary || null,
        rawResult: rawResult || null,
        errorMessage: errorMessage || null,
        durationMs: durationMs || 0,
        completedAt:
          status === "success" || status === "error" ? new Date() : null,
      })
      .returning();
    res.status(201).json({ id: row.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create execution");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/internal/run-events", async (req, res) => {
  try {
    const { runId, eventType, data } = req.body;
    const [row] = await db
      .insert(runEvents)
      .values({
        runId,
        eventType,
        data: data || null,
      })
      .returning();
    res.status(201).json({ id: row.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create run event");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/internal/executions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updates: Record<string, unknown> = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.resultSummary !== undefined)
      updates.resultSummary = req.body.resultSummary;
    if (req.body.rawResult !== undefined) updates.rawResult = req.body.rawResult;
    if (req.body.errorMessage !== undefined)
      updates.errorMessage = req.body.errorMessage;
    if (req.body.durationMs !== undefined) updates.durationMs = req.body.durationMs;
    if (
      req.body.status === "success" ||
      req.body.status === "error"
    ) {
      updates.completedAt = new Date();
    }

    await db.update(executions).set(updates).where(eq(executions.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update execution");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
