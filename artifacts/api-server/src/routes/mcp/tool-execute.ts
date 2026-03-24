import { Router, type IRouter } from "express";
import { handleRouteError } from "../../lib/handle-error";
import * as executionService from "../../services/execution.service";
import { writeAuditEvent } from "../../services/audit.service";

const router: IRouter = Router();

router.post("/mcp-tools/:toolId/execute", async (req, res) => {
  try {
    const toolId = parseInt(req.params.toolId);
    const { arguments: toolArgs = {}, conversationId, approved } = req.body as {
      arguments?: Record<string, unknown>;
      conversationId?: number;
      approved?: boolean;
    };

    const result = await executionService.executeToolDirect(toolId, toolArgs, conversationId, approved);

    if ("notFound" in result) { res.status(404).json({ error: result.notFound }); return; }
    if ("error" in result) { res.status(400).json({ error: result.error }); return; }
    if ("forbidden" in result) { res.status(403).json({ error: result.forbidden }); return; }
    if ("requiresApproval" in result) {
      res.status(403).json({
        error: "Tool requires explicit approval before execution",
        requiresApproval: true,
        toolId: result.toolId,
        toolName: result.toolName,
      });
      return;
    }

    const exec = result.execution!;

    await writeAuditEvent({
      eventType: "tool.executed",
      entityType: "execution",
      entityId: exec.id,
      details: { toolName: exec.toolName, status: exec.status },
      traceId: req.traceId,
    });

    res.json(exec);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to execute tool");
    handleRouteError(res, err, "Tool execution failed");
  }
});

export default router;
