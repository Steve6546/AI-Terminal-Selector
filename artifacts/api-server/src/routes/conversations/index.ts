import { Router, type IRouter } from "express";
import {
  CreateConversationBody,
  UpdateConversationBody,
  SendMessageBody,
} from "@workspace/api-zod";
import { handleRouteError } from "../../lib/handle-error";
import * as conversationService from "../../services/conversation.service";
import * as providerService from "../../services/provider.service";
import { writeAuditEvent } from "../../services/audit.service";

const router: IRouter = Router();

router.get("/conversations", async (req, res) => {
  try { res.json(await conversationService.listConversations()); }
  catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to list conversations"); handleRouteError(res, err, "Internal server error"); }
});

router.post("/conversations", async (req, res) => {
  try {
    const body = CreateConversationBody.parse(req.body);
    const conv = await conversationService.createConversation(body.title, body.model);
    await writeAuditEvent({ eventType: "conversation.created", entityType: "conversation", entityId: conv.id, traceId: req.traceId });
    res.status(201).json(conv);
  } catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to create conversation"); handleRouteError(res, err, "Internal server error"); }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const conv = await conversationService.getConversation(parseInt(req.params.id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.json(conv);
  } catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to get conversation"); handleRouteError(res, err, "Internal server error"); }
});

router.delete("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await conversationService.deleteConversation(id);
    if (!deleted) { res.status(404).json({ error: "Conversation not found" }); return; }
    await writeAuditEvent({ eventType: "conversation.deleted", entityType: "conversation", entityId: id, traceId: req.traceId });
    res.status(204).send();
  } catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to delete conversation"); handleRouteError(res, err, "Internal server error"); }
});

router.patch("/conversations/:id", async (req, res) => {
  try {
    const body = UpdateConversationBody.parse(req.body);
    const updated = await conversationService.updateConversation(parseInt(req.params.id), body);
    if (!updated) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.json(updated);
  } catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to update conversation"); handleRouteError(res, err, "Internal server error"); }
});

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

    const { fullResponse } = await conversationService.streamAgentChat(
      providerService.getAgentBackendUrl(),
      { conversation_id: convId, messages: prepared.chatMessages, model: prepared.model, mode, tools: mcpToolDefs.map((t: { name: string; description: string; input_schema: Record<string, unknown>; requires_approval: boolean }) => ({ name: t.name, description: t.description, input_schema: t.input_schema, requires_approval: t.requires_approval })), servers: mcpServerInfos, selected_server_id: typeof rawBody.selectedServerId === "number" ? rawBody.selectedServerId : null, selected_tool_name: typeof rawBody.selectedToolName === "string" ? rawBody.selectedToolName : null, tool_args: rawBody.toolArgs && typeof rawBody.toolArgs === "object" ? rawBody.toolArgs : null },
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

router.post("/conversations/:id/auto-name", async (req, res) => {
  try {
    const result = await conversationService.autoNameConversation(parseInt(req.params.id), req.query.force === "true");
    if (!result) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.json(result);
  } catch (err) { req.log.error({ err, traceId: req.traceId }, "Failed to auto-name"); handleRouteError(res, err, "Internal server error"); }
});

router.post("/conversations/:id/pin", async (req, res) => {
  try {
    const result = await conversationService.pinConversation(parseInt(req.params.id));
    if (!result) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.json(result);
  } catch (err) { req.log.error({ err }); handleRouteError(res, err, "Internal server error"); }
});

router.post("/conversations/:id/unpin", async (req, res) => {
  try {
    const result = await conversationService.unpinConversation(parseInt(req.params.id));
    if (!result) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.json(result);
  } catch (err) { req.log.error({ err }); handleRouteError(res, err, "Internal server error"); }
});

router.post("/conversations/:id/duplicate", async (req, res) => {
  try {
    const result = await conversationService.duplicateConversation(parseInt(req.params.id));
    if (!result) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.status(201).json(result);
  } catch (err) { req.log.error({ err }); handleRouteError(res, err, "Internal server error"); }
});

router.get("/conversations/:id/export", async (req, res) => {
  try {
    const format = (req.query.format as string) === "markdown" ? "markdown" : "json";
    const result = await conversationService.exportConversation(parseInt(req.params.id), format);
    if (!result) { res.status(404).json({ error: "Conversation not found" }); return; }
    if (result.format === "markdown") {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="chat-${result.conv.id}.md"`);
      res.send(result.content);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="chat-${result.conv.id}.json"`);
      res.json(result.content);
    }
  } catch (err) { req.log.error({ err }); handleRouteError(res, err, "Internal server error"); }
});

export default router;
