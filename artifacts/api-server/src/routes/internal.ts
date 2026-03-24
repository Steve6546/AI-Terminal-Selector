import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, toolCalls } from "@workspace/db";
import { handleRouteError } from "../lib/handle-error";
import * as runService from "../services/run.service";
import * as approvalService from "../services/approval.service";
import { recordToolExecution } from "../services/metrics.service";
import { writeAuditEvent } from "../services/audit.service";

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
    const result = await runService.createRun(req.body);
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create run");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/internal/runs/:runId", async (req, res) => {
  try {
    await runService.updateRun(req.params.runId, req.body);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update run");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/internal/tool-calls", async (req, res) => {
  try {
    const result = await runService.createToolCall(req.body);
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create tool call");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/internal/tool-calls/:id", async (req, res) => {
  try {
    const tcId = parseInt(req.params.id);
    const data = req.body as { toolName?: string; status?: string; durationMs?: number; runId?: number };
    await runService.updateToolCall(tcId, req.body);
    if (data.status === "success" || data.status === "error") {
      let toolName = data.toolName;
      if (!toolName) {
        const [row] = await db.select({ toolName: toolCalls.toolName }).from(toolCalls).where(eq(toolCalls.id, tcId));
        toolName = row?.toolName;
      }
      if (toolName) {
        recordToolExecution(toolName, data.status === "success", data.durationMs ?? 0);
      }
      writeAuditEvent({
        eventType: `tool_call.${data.status}`,
        entityType: "tool_call",
        entityId: tcId,
        traceId: req.traceId,
        details: { toolName, durationMs: data.durationMs, runId: data.runId },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update tool call");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/internal/approvals", async (req, res) => {
  try {
    const result = await approvalService.createApproval(req.body);
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create approval");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/internal/executions", async (req, res) => {
  try {
    const result = await runService.createExecution(req.body);
    writeAuditEvent({
      eventType: "execution.created",
      entityType: "execution",
      entityId: result.id,
      traceId: req.traceId,
      details: { toolName: req.body.toolName, conversationId: req.body.conversationId },
    });
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create execution");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/internal/run-events", async (req, res) => {
  try {
    const result = await runService.createRunEvent(req.body);
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to create run event");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/internal/executions/:id", async (req, res) => {
  try {
    await runService.updateExecution(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update execution");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
