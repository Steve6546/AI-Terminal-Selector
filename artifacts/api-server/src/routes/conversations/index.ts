import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { conversations, messages, executions, mcpTools, mcpServers, attachments } from "@workspace/db";
import { eq, desc, count, and, inArray, gte } from "drizzle-orm";
import {
  CreateConversationBody,
  UpdateConversationBody,
  SendMessageBody,
} from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { handleRouteError } from "../../lib/handle-error";
import { unmaskSecret } from "../../lib/secret-utils";
import { checkEndpointAllowed } from "../../lib/domain-allowlist";

const router: IRouter = Router();

const AGENT_BACKEND_URL = `http://localhost:${process.env.AGENT_BACKEND_PORT ?? "9000"}`;

router.get("/conversations", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        model: conversations.model,
        pinnedAt: conversations.pinnedAt,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        messageCount: count(messages.id),
      })
      .from(conversations)
      .leftJoin(messages, eq(messages.conversationId, conversations.id))
      .groupBy(conversations.id)
      .orderBy(desc(conversations.updatedAt));

    const sorted = [...rows].sort((a, b) => {
      const aPin = a.pinnedAt ? a.pinnedAt.getTime() : 0;
      const bPin = b.pinnedAt ? b.pinnedAt.getTime() : 0;
      if (aPin !== bPin) return bPin - aPin;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    res.json(
      sorted.map((r) => ({
        id: r.id,
        title: r.title,
        model: r.model,
        pinnedAt: r.pinnedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        messageCount: Number(r.messageCount),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list conversations");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/conversations", async (req, res) => {
  try {
    const body = CreateConversationBody.parse(req.body);
    const [conv] = await db
      .insert(conversations)
      .values({ title: body.title, model: body.model ?? "claude-sonnet-4-6" })
      .returning();
    res.status(201).json({
      id: conv.id, title: conv.title, model: conv.model,
      createdAt: conv.createdAt.toISOString(), updatedAt: conv.updatedAt.toISOString(), messageCount: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

    res.json({
      id: conv.id, title: conv.title, model: conv.model,
      createdAt: conv.createdAt.toISOString(), updatedAt: conv.updatedAt.toISOString(),
      messages: msgs.map((m) => ({
        id: m.id, conversationId: m.conversationId, role: m.role, content: m.content,
        model: m.model, createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.delete("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await db.delete(conversations).where(eq(conversations.id, id)).returning();
    if (deleted.length === 0) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = UpdateConversationBody.parse(req.body);
    const updateData: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.model !== undefined) updateData.model = body.model;

    const [updated] = await db.update(conversations).set(updateData).where(eq(conversations.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Conversation not found" }); return; }

    res.json({
      id: updated.id, title: updated.title, model: updated.model,
      createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(), messageCount: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
    res.json(msgs.map((m) => ({
      id: m.id, conversationId: m.conversationId, role: m.role, content: m.content,
      model: m.model, createdAt: m.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list messages");
    handleRouteError(res, err, "Internal server error");
  }
});

async function buildToolDefinitions(serverIds?: number[]) {
  const baseConditions = and(
    eq(mcpTools.enabled, true),
    eq(mcpServers.enabled, true),
    eq(mcpServers.status, "connected")
  );
  const toolRows = await db
    .select({
      id: mcpTools.id,
      serverId: mcpTools.serverId,
      toolName: mcpTools.toolName,
      description: mcpTools.description,
      inputSchema: mcpTools.inputSchema,
      requiresApproval: mcpTools.requiresApproval,
    })
    .from(mcpTools)
    .innerJoin(mcpServers, eq(mcpTools.serverId, mcpServers.id))
    .where(serverIds?.length ? and(baseConditions, inArray(mcpTools.serverId, serverIds)) : baseConditions);

  return toolRows.map((t) => ({
    name: `${t.serverId}__${t.toolName}`,
    description: t.description ?? t.toolName,
    input_schema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    _toolId: t.id,
    _serverId: t.serverId,
    requires_approval: t.requiresApproval ?? false,
  }));
}

async function buildServerInfos() {
  const servers = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true));

  const result = [];
  for (const s of servers) {
    const allowCheck = await checkEndpointAllowed(s.endpoint, s.transportType);
    if (!allowCheck.allowed) continue;
    result.push({
      id: s.id,
      name: s.name,
      transport_type: s.transportType,
      endpoint: s.endpoint,
      command: s.command,
      args: (s.args as string[]) ?? [],
      auth_type: s.authType,
      auth_secret: unmaskSecret(s.encryptedSecret),
      timeout: s.timeout,
      retry_count: s.retryCount,
    });
  }
  return result;
}

router.post("/conversations/:id/runs/:runId/approve", async (req, res) => {
  const { runId } = req.params;
  const { tool_id, approved } = req.body as { tool_id: string; approved: boolean };

  try {
    const agentResp = await fetch(`${AGENT_BACKEND_URL}/agent/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, tool_id, approved: !!approved }),
    });

    if (agentResp.ok) {
      res.json({ ok: true });
    } else {
      const body = await agentResp.text().catch(() => "");
      res.status(agentResp.status).json({ error: body || "Approval failed" });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to forward approval to agent");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/conversations/:id/messages", async (req, res) => {
  try {
    const convId = parseInt(req.params.id);
    const body = SendMessageBody.parse(req.body);

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    const model = body.model ?? conv.model ?? "claude-sonnet-4-6";
    const rawBody = req.body as {
      mode?: string; attachmentIds?: unknown;
      selectedServerId?: unknown; selectedToolName?: unknown; toolArgs?: unknown;
    };
    const mode = rawBody.mode ?? "agent";
    const attachmentIds: number[] = Array.isArray(rawBody.attachmentIds)
      ? (rawBody.attachmentIds as unknown[]).filter((id): id is number => typeof id === "number")
      : [];

    await db.insert(messages).values({ conversationId: convId, role: "user", content: body.content, model });

    const attachmentRows = attachmentIds.length > 0
      ? await db.select().from(attachments).where(inArray(attachments.id, attachmentIds))
      : [];

    const allMessages = await db.select().from(messages).where(eq(messages.conversationId, convId)).orderBy(messages.createdAt);

    const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
    type ImageMediaType = typeof IMAGE_MIMES[number];
    const isImageMime = (m: string): m is ImageMediaType => (IMAGE_MIMES as readonly string[]).includes(m);

    type MsgParam = { role: string; content: string | Array<{ type: string; [k: string]: unknown }> };
    const chatMessages: MsgParam[] = allMessages.map((m, idx) => {
      const isLastUser = idx === allMessages.length - 1 && m.role === "user";
      if (isLastUser && attachmentRows.length > 0) {
        const contentBlocks: Array<{ type: string; [k: string]: unknown }> = [{ type: "text", text: m.content }];
        for (const att of attachmentRows) {
          if (!att.content) continue;
          if (isImageMime(att.fileType)) {
            contentBlocks.push({ type: "image", source: { type: "base64", media_type: att.fileType, data: att.content } });
          } else {
            const decoded = Buffer.from(att.content, "base64").toString("utf-8");
            contentBlocks.push({ type: "text", text: `\n\n<file name="${att.fileName}" type="${att.fileType}">\n${decoded}\n</file>` });
          }
        }
        return { role: m.role, content: contentBlocks };
      }
      return { role: m.role, content: m.content };
    });

    const mcpToolDefs = await buildToolDefinitions();
    const mcpServerInfos = await buildServerInfos();

    const agentPayload = {
      conversation_id: convId,
      messages: chatMessages,
      model,
      mode,
      tools: mcpToolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        requires_approval: t.requires_approval,
      })),
      servers: mcpServerInfos,
      selected_server_id: typeof rawBody.selectedServerId === "number" ? rawBody.selectedServerId : null,
      selected_tool_name: typeof rawBody.selectedToolName === "string" ? rawBody.selectedToolName : null,
      tool_args: rawBody.toolArgs && typeof rawBody.toolArgs === "object" ? rawBody.toolArgs : null,
    };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    let fullResponse = "";

    try {
      const agentResp = await fetch(`${AGENT_BACKEND_URL}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentPayload),
        signal: controller.signal,
      });

      if (!agentResp.ok || !agentResp.body) {
        const errText = await agentResp.text().catch(() => "Agent backend error");
        res.write(`data: ${JSON.stringify({ type: "run.failed", run_id: "unknown", error: errText })}\n\n`);
        res.end();
        return;
      }

      const reader = agentResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6);
            res.write(`data: ${dataStr}\n\n`);

            try {
              const evt = JSON.parse(dataStr);
              if (evt.type === "text.delta" && evt.content) {
                fullResponse += evt.content;
              }
            } catch { /* not JSON, pass through */ }
          }
        }
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          res.write(`data: ${trimmed.slice(6)}\n\n`);
          try {
            const evt = JSON.parse(trimmed.slice(6));
            if (evt.type === "text.delta" && evt.content) {
              fullResponse += evt.content;
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        req.log.error({ err }, "Agent proxy stream error");
        try {
          res.write(`data: ${JSON.stringify({ type: "run.failed", run_id: "unknown", error: "Stream error occurred" })}\n\n`);
        } catch { /* ignore */ }
      }
    }

    if (fullResponse) {
      await db.insert(messages).values({ conversationId: convId, role: "assistant", content: fullResponse, model });
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));
    }

    res.end();
  } catch (err) {
    req.log.error({ err }, "Failed to send message");
    if (!res.headersSent) {
      handleRouteError(res, err, "Internal server error");
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: "run.failed", run_id: "unknown", error: "Stream error occurred" })}\n\n`);
        res.end();
      } catch { /* ignore */ }
    }
  }
});

router.delete("/conversations/:id/messages-from/:messageId", async (req, res) => {
  try {
    const convId = parseInt(req.params.id);
    const messageId = parseInt(req.params.messageId);

    const [target] = await db.select({ createdAt: messages.createdAt }).from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, convId)));

    if (!target) { res.status(404).json({ error: "Message not found" }); return; }

    await db.delete(messages).where(and(eq(messages.conversationId, convId), gte(messages.createdAt, target.createdAt)));
    await db.delete(executions).where(and(eq(executions.conversationId, convId), gte(executions.startedAt, target.createdAt)));
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to truncate messages");
    handleRouteError(res, err, "Internal server error");
  }
});

const DEFAULT_TITLES = new Set(["New Chat", "New Conversation"]);

router.post("/conversations/:id/auto-name", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const force = req.query.force === "true";

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    if (!force && !DEFAULT_TITLES.has(conv.title)) {
      res.json({ title: conv.title });
      return;
    }

    const msgs = await db.select({ role: messages.role, content: messages.content }).from(messages)
      .where(eq(messages.conversationId, id)).orderBy(messages.createdAt).limit(2);

    if (msgs.length < 2) { res.json({ title: conv.title }); return; }

    const prompt = msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");

    const naming = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 32,
      messages: [{ role: "user", content: `Generate a concise chat title (3-6 words, no quotes, no punctuation at end) for this conversation:\n\n${prompt}\n\nTitle:` }],
    });

    const raw = naming.content[0]?.type === "text" ? naming.content[0].text.trim() : "";
    const title = raw.replace(/^["']|["']$/g, "").replace(/\.$/, "").slice(0, 80) || conv.title;

    await db.update(conversations).set({ title, updatedAt: new Date() }).where(eq(conversations.id, id));
    res.json({ title });
  } catch (err) {
    req.log.error({ err }, "Failed to auto-name conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/conversations/:id/pin", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [updated] = await db.update(conversations).set({ pinnedAt: new Date(), updatedAt: new Date() }).where(eq(conversations.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.json({ id: updated.id, pinnedAt: updated.pinnedAt?.toISOString() ?? null });
  } catch (err) { req.log.error({ err }); handleRouteError(res, err, "Internal server error"); }
});

router.post("/conversations/:id/unpin", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [updated] = await db.update(conversations).set({ pinnedAt: null, updatedAt: new Date() }).where(eq(conversations.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Conversation not found" }); return; }
    res.json({ id: updated.id, pinnedAt: null });
  } catch (err) { req.log.error({ err }); handleRouteError(res, err, "Internal server error"); }
});

router.post("/conversations/:id/duplicate", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    const [newConv] = await db.insert(conversations).values({ title: `${conv.title} (copy)`, model: conv.model }).returning();

    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
    if (msgs.length > 0) {
      await db.insert(messages).values(msgs.map((m) => ({ conversationId: newConv.id, role: m.role, content: m.content, model: m.model })));
    }

    res.status(201).json({
      id: newConv.id, title: newConv.title, model: newConv.model,
      pinnedAt: null, createdAt: newConv.createdAt.toISOString(), updatedAt: newConv.updatedAt.toISOString(),
      messageCount: msgs.length,
    });
  } catch (err) { req.log.error({ err }); handleRouteError(res, err, "Internal server error"); }
});

router.get("/conversations/:id/export", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const format = (req.query.format as string) === "markdown" ? "markdown" : "json";

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

    if (format === "markdown") {
      const lines: string[] = [`# ${conv.title}`, ``, `*Model: ${conv.model} | Created: ${conv.createdAt.toISOString()}*`, ``];
      for (const m of msgs) { lines.push(`## ${m.role === "user" ? "You" : "Assistant"}`); lines.push(m.content); lines.push(""); }
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="chat-${id}.md"`);
      res.send(lines.join("\n"));
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="chat-${id}.json"`);
      res.json({ id: conv.id, title: conv.title, model: conv.model, createdAt: conv.createdAt.toISOString(), updatedAt: conv.updatedAt.toISOString(), messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, model: m.model, createdAt: m.createdAt.toISOString() })) });
    }
  } catch (err) { req.log.error({ err }); handleRouteError(res, err, "Internal server error"); }
});

export default router;
