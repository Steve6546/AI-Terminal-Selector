import { Router, type IRouter } from "express";
import { SendMessageBody } from "@workspace/api-zod";
import { handleRouteError } from "../../lib/handle-error";
import * as conversationService from "../../services/conversation.service";
import * as providerService from "../../services/provider.service";
import { writeAuditEvent } from "../../services/audit.service";

const router: IRouter = Router();

router.get("/conversations/:id/messages", async (req, res) => {
  try { res.json(await conversationService.listMessages(parseInt(req.params.id))); }
  catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to list messages"); handleRouteError(res, err, "Internal server error"); }
});

router.post("/conversations/:id/runs/:runId/approve", async (req, res) => {
  try {
    const { tool_id, approved } = req.body as { tool_id: string; approved: boolean };
    const result = await providerService.forwardApproval(req.params.runId, tool_id, approved, req.traceId);
    if (result.error) { res.status(result.status ?? 500).json({ error: result.error }); }
    else {
      await writeAuditEvent({ eventType: "approval.decided", entityType: "run", details: { runId: req.params.runId, toolId: tool_id, approved }, traceId: req.traceId });
      res.json(result);
    }
  } catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to forward approval"); handleRouteError(res, err, "Internal server error"); }
});

router.post("/conversations/:id/messages", async (req, res) => {
  try {
    const convId = parseInt(req.params.id);
    const body = SendMessageBody.parse(req.body);
    const rawBody = req.body as { mode?: string; attachmentIds?: unknown; selectedServerId?: unknown; selectedToolName?: unknown; toolArgs?: unknown };
    const mode = rawBody.mode ?? "agent";
    const attachmentIds: number[] = Array.isArray(rawBody.attachmentIds) ? (rawBody.attachmentIds as unknown[]).filter((id): id is number => typeof id === "number") : [];

    const prepared = await conversationService.prepareSendMessage(convId, body.content, body.model || undefined, attachmentIds);
    if (!prepared) { res.status(404).json({ error: "Conversation not found" }); return; }

    const mcpToolDefs = await providerService.buildToolDefinitions();
    const mcpServerInfos = await providerService.buildServerInfos();

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    const toolPayload = mcpToolDefs.map((t: { name: string; description: string; input_schema: Record<string, unknown>; requires_approval: boolean }) => ({
      name: t.name, description: t.description, input_schema: t.input_schema, requires_approval: t.requires_approval,
    }));

    const { fullResponse } = await conversationService.streamAgentChat(
      providerService.getAgentBackendUrl(),
      { conversation_id: convId, messages: prepared.chatMessages, model: prepared.model, mode, tools: toolPayload, servers: mcpServerInfos, selected_server_id: typeof rawBody.selectedServerId === "number" ? rawBody.selectedServerId : null, selected_tool_name: typeof rawBody.selectedToolName === "string" ? rawBody.selectedToolName : null, tool_args: rawBody.toolArgs && typeof rawBody.toolArgs === "object" ? rawBody.toolArgs : null },
      req.traceId, res, controller.signal, req.log,
    );

    if (fullResponse) await conversationService.saveAssistantResponse(convId, fullResponse, prepared.model);
    res.end();
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to send message");
    if (!res.headersSent) handleRouteError(res, err, "Internal server error");
    else { try { res.write(`data: ${JSON.stringify({ type: "run.failed", run_id: "unknown", error: "Stream error" })}\n\n`); res.end(); } catch { /* ignore */ } }
  }
});

router.delete("/conversations/:id/messages-from/:messageId", async (req, res) => {
  try {
    const found = await conversationService.truncateMessagesFrom(parseInt(req.params.id), parseInt(req.params.messageId));
    if (!found) { res.status(404).json({ error: "Message not found" }); return; }
    res.status(204).send();
  } catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to truncate messages"); handleRouteError(res, err, "Internal server error"); }
});

export default router;
