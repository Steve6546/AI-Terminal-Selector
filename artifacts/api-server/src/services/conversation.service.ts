import { db } from "@workspace/db";
import { conversations, messages, executions, attachments } from "@workspace/db";
import { eq, desc, count, and, gte, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const DEFAULT_TITLES = new Set(["New Chat", "New Conversation"]);

export async function listConversations() {
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

  return sorted.map((r) => ({
    id: r.id,
    title: r.title,
    model: r.model,
    pinnedAt: r.pinnedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    messageCount: Number(r.messageCount),
  }));
}

export async function createConversation(title: string, model?: string) {
  const [conv] = await db
    .insert(conversations)
    .values({ title, model: model ?? "claude-sonnet-4-6" })
    .returning();

  return {
    id: conv.id,
    title: conv.title,
    model: conv.model,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    messageCount: 0,
  };
}

export async function getConversation(id: number) {
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) return null;

  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

  return {
    id: conv.id,
    title: conv.title,
    model: conv.model,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    messages: msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      model: m.model,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function deleteConversation(id: number): Promise<boolean> {
  const deleted = await db.delete(conversations).where(eq(conversations.id, id)).returning();
  return deleted.length > 0;
}

export async function updateConversation(
  id: number,
  data: { title?: string; model?: string },
) {
  const updateData: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date() };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.model !== undefined) updateData.model = data.model;

  const [updated] = await db.update(conversations).set(updateData).where(eq(conversations.id, id)).returning();
  if (!updated) return null;

  return {
    id: updated.id,
    title: updated.title,
    model: updated.model,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    messageCount: 0,
  };
}

export async function listMessages(conversationId: number) {
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);

  return msgs.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    model: m.model,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function truncateMessagesFrom(conversationId: number, messageId: number): Promise<boolean> {
  const [target] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));

  if (!target) return false;

  await db.delete(messages).where(and(eq(messages.conversationId, conversationId), gte(messages.createdAt, target.createdAt)));
  await db.delete(executions).where(and(eq(executions.conversationId, conversationId), gte(executions.startedAt, target.createdAt)));
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

  return true;
}

export async function autoNameConversation(id: number, force: boolean) {
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) return null;

  if (!force && !DEFAULT_TITLES.has(conv.title)) {
    return { title: conv.title };
  }

  const msgs = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt)
    .limit(2);

  if (msgs.length < 2) return { title: conv.title };

  const prompt = msgs.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");

  const naming = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 32,
    messages: [{ role: "user", content: `Generate a concise chat title (3-6 words, no quotes, no punctuation at end) for this conversation:\n\n${prompt}\n\nTitle:` }],
  });

  const raw = naming.content[0]?.type === "text" ? naming.content[0].text.trim() : "";
  const title = raw.replace(/^["']|["']$/g, "").replace(/\.$/, "").slice(0, 80) || conv.title;

  await db.update(conversations).set({ title, updatedAt: new Date() }).where(eq(conversations.id, id));
  return { title };
}

export async function pinConversation(id: number) {
  const [updated] = await db
    .update(conversations)
    .set({ pinnedAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  if (!updated) return null;
  return { id: updated.id, pinnedAt: updated.pinnedAt?.toISOString() ?? null };
}

export async function unpinConversation(id: number) {
  const [updated] = await db
    .update(conversations)
    .set({ pinnedAt: null, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  if (!updated) return null;
  return { id: updated.id, pinnedAt: null };
}

export async function duplicateConversation(id: number) {
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) return null;

  const [newConv] = await db
    .insert(conversations)
    .values({ title: `${conv.title} (copy)`, model: conv.model })
    .returning();

  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  if (msgs.length > 0) {
    await db
      .insert(messages)
      .values(msgs.map((m) => ({ conversationId: newConv.id, role: m.role, content: m.content, model: m.model })));
  }

  return {
    id: newConv.id,
    title: newConv.title,
    model: newConv.model,
    pinnedAt: null,
    createdAt: newConv.createdAt.toISOString(),
    updatedAt: newConv.updatedAt.toISOString(),
    messageCount: msgs.length,
  };
}

export async function exportConversation(id: number, format: "json" | "markdown") {
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv) return null;

  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

  if (format === "markdown") {
    const lines: string[] = [
      `# ${conv.title}`,
      ``,
      `*Model: ${conv.model} | Created: ${conv.createdAt.toISOString()}*`,
      ``,
    ];
    for (const m of msgs) {
      lines.push(`## ${m.role === "user" ? "You" : "Assistant"}`);
      lines.push(m.content);
      lines.push("");
    }
    return { format: "markdown" as const, content: lines.join("\n"), conv };
  }

  return {
    format: "json" as const,
    content: {
      id: conv.id,
      title: conv.title,
      model: conv.model,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        createdAt: m.createdAt.toISOString(),
      })),
    },
    conv,
  };
}

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMediaType = (typeof IMAGE_MIMES)[number];
const isImageMime = (m: string): m is ImageMediaType =>
  (IMAGE_MIMES as readonly string[]).includes(m);

type MsgParam = {
  role: string;
  content: string | Array<{ type: string; [k: string]: unknown }>;
};

export async function prepareSendMessage(
  convId: number,
  content: string,
  model: string,
  attachmentIds: number[],
) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, convId));
  if (!conv) return null;

  const effectiveModel = model ?? conv.model ?? "claude-sonnet-4-6";

  await db.insert(messages).values({ conversationId: convId, role: "user", content, model: effectiveModel });

  const attachmentRows =
    attachmentIds.length > 0
      ? await db.select().from(attachments).where(inArray(attachments.id, attachmentIds))
      : [];

  const allMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(messages.createdAt);

  const chatMessages: MsgParam[] = allMessages.map((m, idx) => {
    const isLastUser = idx === allMessages.length - 1 && m.role === "user";
    if (isLastUser && attachmentRows.length > 0) {
      const contentBlocks: Array<{ type: string; [k: string]: unknown }> = [
        { type: "text", text: m.content },
      ];
      for (const att of attachmentRows) {
        if (!att.content) continue;
        if (isImageMime(att.fileType)) {
          contentBlocks.push({
            type: "image",
            source: { type: "base64", media_type: att.fileType, data: att.content },
          });
        } else {
          const decoded = Buffer.from(att.content, "base64").toString("utf-8");
          contentBlocks.push({
            type: "text",
            text: `\n\n<file name="${att.fileName}" type="${att.fileType}">\n${decoded}\n</file>`,
          });
        }
      }
      return { role: m.role, content: contentBlocks };
    }
    return { role: m.role, content: m.content };
  });

  return { conv, model: effectiveModel, chatMessages };
}

export async function saveAssistantResponse(convId: number, content: string, model: string) {
  await db.insert(messages).values({ conversationId: convId, role: "assistant", content, model });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));
}

export interface AgentStreamResult {
  fullResponse: string;
}

export async function streamAgentChat(
  agentUrl: string,
  payload: Record<string, unknown>,
  traceId: string,
  res: import("express").Response,
  signal: AbortSignal,
  log: { error: (obj: Record<string, unknown>, msg: string) => void },
): Promise<AgentStreamResult> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let fullResponse = "";

  try {
    const agentResp = await fetch(`${agentUrl}/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trace-Id": traceId },
      body: JSON.stringify(payload),
      signal,
    });

    if (!agentResp.ok || !agentResp.body) {
      const errText = await agentResp.text().catch(() => "Agent backend error");
      res.write(`data: ${JSON.stringify({ type: "run.failed", run_id: "unknown", error: errText })}\n\n`);
      return { fullResponse };
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
          } catch { /* pass through */ }
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const dataStr = trimmed.slice(6);
        res.write(`data: ${dataStr}\n\n`);
        try {
          const evt = JSON.parse(dataStr);
          if (evt.type === "text.delta" && evt.content) {
            fullResponse += evt.content;
          }
        } catch { /* ignore */ }
      }
    }
  } catch (err: unknown) {
    if ((err as Error).name !== "AbortError") {
      log.error({ err: err as Error, traceId }, "Agent proxy stream error");
      try {
        res.write(`data: ${JSON.stringify({ type: "run.failed", run_id: "unknown", error: "Stream error occurred" })}\n\n`);
      } catch { /* ignore */ }
    }
  }

  return { fullResponse };
}
