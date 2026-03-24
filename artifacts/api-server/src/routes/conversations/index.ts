import { Router, type IRouter } from "express";
import { CreateConversationBody, UpdateConversationBody } from "@workspace/api-zod";
import { handleRouteError } from "../../lib/handle-error";
import * as conversationService from "../../services/conversation.service";
import { writeAuditEvent } from "../../services/audit.service";
import messagesRouter from "./messages";

const router: IRouter = Router();

router.use(messagesRouter);

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
