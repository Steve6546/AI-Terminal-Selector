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
import { executeMcpTool } from "../../lib/mcp-gateway";
import { handleRouteError } from "../../lib/handle-error";
import { unmaskSecret } from "../../lib/secret-utils";
import { checkEndpointAllowed } from "../../lib/domain-allowlist";

const router: IRouter = Router();

const pendingApprovals = new Map<string, (approved: boolean) => void>();

type RunEvent =
  | { type: "run.created"; run_id: string; conversation_id: number; model: string; mode: string }
  | { type: "model.started"; run_id: string }
  | { type: "thinking.started"; run_id: string; message: string }
  | { type: "thinking.delta"; run_id: string; content: string }
  | { type: "thinking.completed"; run_id: string }
  | { type: "text.delta"; run_id: string; content: string }
  | { type: "tool.started"; run_id: string; tool_id: string; tool_name: string; server_id: number | null; server_name: string | null; inputs: Record<string, unknown> }
  | { type: "tool.stdout"; run_id: string; tool_id: string; content: string }
  | { type: "tool.completed"; run_id: string; tool_id: string; execution_id: number | null; success: boolean; duration_ms: number; error?: string }
  | { type: "tool.approval_required"; run_id: string; tool_id: string; tool_name: string; server_name: string | null; inputs: Record<string, unknown> }
  | { type: "artifact.created"; run_id: string; tool_id: string; tool_name: string; artifact_type: "json" | "text" | "code"; size_bytes: number; preview: string }
  | { type: "run.completed"; run_id: string }
  | { type: "run.failed"; run_id: string; error: string };

const AGENT_SYSTEM_PROMPT = `You are an expert AI agent with access to MCP (Model Context Protocol) tools and servers.

## Your capabilities
- Discover and execute tools across all connected MCP servers
- Chain multiple tools together to complete complex, multi-step workflows
- Analyze data, manage servers, automate tasks, and interact with external APIs

## How you work
1. **Understand** the user's intent completely. If ambiguous, ask one focused clarifying question.
2. **Plan** which servers and tools you will use, and in what order.
3. **Execute** tools systematically. Check each result before proceeding to the next step.
4. **Handle errors** gracefully — if a tool fails, explain why and try an alternative approach.
5. **Report** progress at each step with clear, concise summaries.

## Tool selection
- Tools are namespaced as \`{serverId}__{toolName}\`. Always use the full namespaced form.
- Prefer tools that match the user's intent most precisely.
- For destructive or irreversible operations, always confirm with the user before executing.

## Quality standards
- Never fabricate tool results. If a tool returns nothing useful, say so.
- Always provide a clear final summary of what was accomplished and any follow-up suggestions.
- Keep your reasoning transparent — briefly explain why you are choosing each tool.`;

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
  }));
}

router.post("/conversations/:id/runs/:runId/approve", (req, res) => {
  const { runId } = req.params;
  const { tool_id, approved } = req.body as { tool_id: string; approved: boolean };
  const key = `${runId}:${tool_id}`;
  const resolve = pendingApprovals.get(key);
  if (resolve) {
    resolve(!!approved);
    pendingApprovals.delete(key);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "No pending approval for this tool" });
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

    type MsgParam = { role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> };
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
        return { role: m.role as "user" | "assistant", content: contentBlocks };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const runId = crypto.randomUUID();

    const sendEvent = (event: RunEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    sendEvent({ type: "run.created", run_id: runId, conversation_id: convId, model, mode });

    const SUMMARY_THRESHOLD = 20;
    const RECENT_MESSAGES_TO_KEEP = 8;

    if (chatMessages.length > SUMMARY_THRESHOLD) {
      const olderMessages = chatMessages.slice(0, chatMessages.length - RECENT_MESSAGES_TO_KEEP);
      const transcript = olderMessages.map((m) => {
        const roleLabel = m.role === "user" ? "User" : "Assistant";
        const text = typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? (m.content as Array<{ type: string; text?: string }>)
                .filter((b) => b.type === "text" && b.text).map((b) => b.text).join(" ")
            : "";
        return `${roleLabel}: ${text.slice(0, 500)}`;
      }).join("\n\n");

      try {
        const summaryResult = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 512,
          messages: [{
            role: "user",
            content: `Summarize the following conversation history into a concise paragraph (max 300 words) that captures the key topics, decisions, and context needed to continue the conversation:\n\n${transcript}\n\nSummary:`,
          }],
        });
        const summaryText = summaryResult.content[0]?.type === "text" ? summaryResult.content[0].text.trim() : "";
        if (summaryText) {
          chatMessages.splice(0, olderMessages.length,
            { role: "user", content: `[Earlier conversation summary: ${summaryText}]` },
            { role: "assistant", content: "Understood, I'll keep that context in mind." }
          );
        }
      } catch {
        // ignore summarization failure
      }
    }

    let fullResponse = "";

    if (mode === "agent") {
      sendEvent({ type: "model.started", run_id: runId });

      const mcpToolDefs = await buildToolDefinitions();
      const providerTools = mcpToolDefs.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

      type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
      type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
      type ContentPart = string | { type: string; [k: string]: unknown };
      type LoopMsg = { role: "user" | "assistant"; content: ContentPart | ContentPart[] };

      let loopMessages: LoopMsg[] = [...chatMessages];
      let loopCount = 0;
      const MAX_LOOPS = 10;

      const connectedServers = await db
        .select({ id: mcpServers.id, name: mcpServers.name })
        .from(mcpServers)
        .where(eq(mcpServers.enabled, true));

      sendEvent({ type: "thinking.started", run_id: runId, message: "Planning..." });
      if (connectedServers.length > 0) {
        sendEvent({ type: "thinking.delta", run_id: runId, content: `Connected servers: ${connectedServers.map(s => s.name).join(", ")}` });
      } else {
        sendEvent({ type: "thinking.delta", run_id: runId, content: "No MCP servers connected — will respond from knowledge only" });
      }
      if (providerTools.length > 0) {
        const toolNames = providerTools.slice(0, 8).map(t => t.name.split("__")[1] ?? t.name);
        const extra = providerTools.length > 8 ? ` +${providerTools.length - 8} more` : "";
        sendEvent({ type: "thinking.delta", run_id: runId, content: `Available tools: ${toolNames.join(", ")}${extra}` });
      }

      while (loopCount < MAX_LOOPS) {
        loopCount++;

        if (loopCount > 1) {
          sendEvent({ type: "thinking.delta", run_id: runId, content: `Iteration ${loopCount}: reviewing tool results and deciding next step...` });
        }

        const requestParams: Parameters<typeof anthropic.messages.stream>[0] = {
          model,
          max_tokens: 8192,
          system: AGENT_SYSTEM_PROMPT,
          messages: loopMessages as Parameters<typeof anthropic.messages.stream>[0]["messages"],
        };
        if (providerTools.length > 0) {
          (requestParams as Record<string, unknown>).tools = providerTools;
        }

        const stream = anthropic.messages.stream(requestParams);

        let currentTextBlock = "";
        const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown>; _rawInput?: string }> = [];
        let stopReason: string | null = null;
        let thinkingEmitted = false;

        for await (const event of stream) {
          if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use") {
              toolUseBlocks.push({ id: event.content_block.id, name: event.content_block.name, input: {} });
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              if (!thinkingEmitted) {
                sendEvent({ type: "thinking.completed", run_id: runId });
                thinkingEmitted = true;
              }
              currentTextBlock += event.delta.text;
              fullResponse += event.delta.text;
              sendEvent({ type: "text.delta", run_id: runId, content: event.delta.text });
            } else if (event.delta.type === "input_json_delta") {
              const last = toolUseBlocks[toolUseBlocks.length - 1];
              if (last) {
                last._rawInput = (last._rawInput ?? "") + event.delta.partial_json;
              }
            }
          } else if (event.type === "message_delta") {
            stopReason = event.delta.stop_reason ?? null;
          }
        }

        if (!thinkingEmitted) {
          sendEvent({ type: "thinking.completed", run_id: runId });
        }

        for (const block of toolUseBlocks) {
          if (block._rawInput) {
            try { block.input = JSON.parse(block._rawInput) as Record<string, unknown>; } catch { block.input = {}; }
          }
        }

        if (currentTextBlock) {
          loopMessages.push({ role: "assistant", content: currentTextBlock });
        }

        if (toolUseBlocks.length === 0 || stopReason === "end_turn") break;

        const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

        for (const block of toolUseBlocks) {
          const underscoreIdx = block.name.indexOf("__");
          const serverId = underscoreIdx > 0 ? parseInt(block.name.slice(0, underscoreIdx)) : null;
          const rawToolName = underscoreIdx > 0 ? block.name.slice(underscoreIdx + 2) : block.name;

          let servConfig: typeof mcpServers.$inferSelect | null = null;
          if (serverId) {
            const [srv] = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId));
            servConfig = srv ?? null;
          }

          sendEvent({ type: "thinking.delta", run_id: runId, content: `Selecting tool: ${rawToolName} on ${servConfig?.name ?? "unknown server"}` });

          let toolRecord: typeof mcpTools.$inferSelect | null = null;
          if (serverId) {
            const [t] = await db.select().from(mcpTools).where(and(eq(mcpTools.serverId, serverId), eq(mcpTools.toolName, rawToolName)));
            toolRecord = t ?? null;
          }

          if (toolRecord?.requiresApproval) {
            sendEvent({ type: "tool.approval_required", run_id: runId, tool_id: block.id, tool_name: rawToolName, server_name: servConfig?.name ?? null, inputs: block.input });

            const approvalKey = `${runId}:${block.id}`;
            const approved = await new Promise<boolean>((resolve) => {
              pendingApprovals.set(approvalKey, resolve);
              setTimeout(() => {
                if (pendingApprovals.has(approvalKey)) {
                  pendingApprovals.delete(approvalKey);
                  resolve(false);
                }
              }, 300_000);
            });

            if (!approved) {
              const [blockedExec] = await db.insert(executions).values({
                conversationId: convId, serverId: serverId ?? null, toolName: rawToolName,
                status: "error", arguments: block.input,
                errorMessage: "Rejected by user", completedAt: new Date(), durationMs: 0,
              }).returning();

              sendEvent({ type: "tool.completed", run_id: runId, tool_id: block.id, execution_id: blockedExec.id, success: false, duration_ms: 0, error: "Rejected by user" });
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Tool "${rawToolName}" was rejected by the user.` });
              continue;
            }
          }

          sendEvent({ type: "tool.started", run_id: runId, tool_id: block.id, tool_name: rawToolName, server_id: serverId, server_name: servConfig?.name ?? null, inputs: block.input });

          const [execRow] = await db.insert(executions).values({
            conversationId: convId, serverId: serverId ?? null, toolName: rawToolName, status: "running", arguments: block.input,
          }).returning();

          const execStart = Date.now();
          let execResult: { success: boolean; content?: unknown; error?: string };

          if (servConfig) {
            const runtimeAllowCheck = await checkEndpointAllowed(servConfig.endpoint, servConfig.transportType);
            if (!runtimeAllowCheck.allowed) {
              execResult = { success: false, error: runtimeAllowCheck.reason ?? "Endpoint not allowed" };
            } else {
              execResult = await executeMcpTool(
                {
                  transportType: servConfig.transportType, endpoint: servConfig.endpoint,
                  command: servConfig.command, args: (servConfig.args as string[]) ?? [],
                  authType: servConfig.authType, authSecret: unmaskSecret(servConfig.encryptedSecret),
                  timeout: servConfig.timeout, retryCount: servConfig.retryCount,
                },
                rawToolName, block.input
              );
            }
          } else {
            execResult = { success: false, error: "Server not found" };
          }

          const durationMs = Date.now() - execStart;
          const resultText = execResult.success
            ? JSON.stringify(execResult.content ?? "")
            : `Error: ${execResult.error ?? "Unknown error"}`;

          if (execResult.success && execResult.content) {
            const contentStr = typeof execResult.content === "string" ? execResult.content : JSON.stringify(execResult.content, null, 2);
            sendEvent({ type: "tool.stdout", run_id: runId, tool_id: block.id, content: contentStr.slice(0, 8192) });

            const sizeBytes = Buffer.byteLength(contentStr, "utf-8");
            if (sizeBytes > 512) {
              const isJson = typeof execResult.content !== "string";
              const isCode = typeof execResult.content === "string" && (
                execResult.content.includes("function ") || execResult.content.includes("def ") ||
                execResult.content.includes("class ") || execResult.content.includes("import ")
              );
              const artifactType = isJson ? "json" : isCode ? "code" : "text";
              sendEvent({
                type: "artifact.created",
                run_id: runId,
                tool_id: block.id,
                tool_name: rawToolName,
                artifact_type: artifactType,
                size_bytes: sizeBytes,
                preview: contentStr.slice(0, 200),
              });
            }
          }

          await db.update(executions).set({
            status: execResult.success ? "success" : "error",
            completedAt: new Date(), durationMs,
            resultSummary: resultText.slice(0, 500),
            rawResult: execResult.content as Record<string, unknown> | null,
            errorMessage: execResult.error ?? null,
          }).where(eq(executions.id, execRow.id));

          sendEvent({ type: "tool.completed", run_id: runId, tool_id: block.id, execution_id: execRow.id, success: execResult.success, duration_ms: durationMs, ...(execResult.error ? { error: execResult.error } : {}) });

          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
        }

        if (toolUseBlocks.length > 0) {
          loopMessages.push({
            role: "assistant",
            content: toolUseBlocks.map((b): ToolUseBlock => ({ type: "tool_use", id: b.id, name: b.name, input: b.input })),
          });
          loopMessages.push({
            role: "user",
            content: toolResults.map((r): ToolResultBlock => ({ type: "tool_result", tool_use_id: r.tool_use_id, content: r.content })),
          });
        }
      }

    } else if (mode === "tool") {
      sendEvent({ type: "model.started", run_id: runId });

      const selectedServerId = typeof rawBody.selectedServerId === "number" ? rawBody.selectedServerId : null;
      const selectedToolName = typeof rawBody.selectedToolName === "string" ? rawBody.selectedToolName : null;
      const toolArgs = (rawBody.toolArgs && typeof rawBody.toolArgs === "object" && !Array.isArray(rawBody.toolArgs))
        ? (rawBody.toolArgs as Record<string, unknown>) : {};

      if (!selectedServerId || !selectedToolName) {
        sendEvent({ type: "run.failed", run_id: runId, error: "Tool mode requires selectedServerId and selectedToolName" });
        res.end();
        return;
      }

      const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, selectedServerId));
      if (!server) {
        sendEvent({ type: "run.failed", run_id: runId, error: `MCP server #${selectedServerId} not found` });
        res.end();
        return;
      }

      const [toolRecord] = await db.select().from(mcpTools).where(and(eq(mcpTools.serverId, selectedServerId), eq(mcpTools.toolName, selectedToolName)));

      if (!toolRecord) {
        sendEvent({ type: "run.failed", run_id: runId, error: `Tool "${selectedToolName}" not found on server "${server.name}"` });
        res.end();
        return;
      }

      if (!toolRecord.enabled) {
        sendEvent({ type: "run.failed", run_id: runId, error: `Tool "${selectedToolName}" is disabled` });
        res.end();
        return;
      }

      const toolId = `tool_${crypto.randomUUID().slice(0, 8)}`;

      if (toolRecord.requiresApproval) {
        sendEvent({ type: "tool.approval_required", run_id: runId, tool_id: toolId, tool_name: selectedToolName, server_name: server.name, inputs: toolArgs });

        const approvalKey = `${runId}:${toolId}`;
        const approved = await new Promise<boolean>((resolve) => {
          pendingApprovals.set(approvalKey, resolve);
          setTimeout(() => {
            if (pendingApprovals.has(approvalKey)) {
              pendingApprovals.delete(approvalKey);
              resolve(false);
            }
          }, 300_000);
        });

        if (!approved) {
          sendEvent({ type: "run.failed", run_id: runId, error: `Tool "${selectedToolName}" was rejected by the user.` });
          res.end();
          return;
        }
      }

      sendEvent({ type: "tool.started", run_id: runId, tool_id: toolId, tool_name: selectedToolName, server_id: server.id, server_name: server.name, inputs: toolArgs });

      const [execution] = await db.insert(executions).values({
        conversationId: convId, serverId: server.id, toolName: selectedToolName, status: "running", startedAt: new Date(),
      }).returning();

      const execStart = Date.now();
      let execResult: import("../../lib/mcp-gateway").McpExecuteResult | null = null;
      let execSuccess = false;
      let execError = "";

      const runtimeAllowCheck = await checkEndpointAllowed(server.endpoint, server.transportType);
      if (!runtimeAllowCheck.allowed) {
        execError = runtimeAllowCheck.reason ?? "Endpoint not allowed by domain allowlist";
      } else {
        try {
          execResult = await executeMcpTool(
            {
              transportType: server.transportType, endpoint: server.endpoint, command: server.command,
              args: (server.args as string[]) ?? [], authType: server.authType,
              authSecret: unmaskSecret(server.encryptedSecret), timeout: server.timeout, retryCount: server.retryCount,
            },
            selectedToolName, toolArgs
          );
          execSuccess = execResult.success;
        } catch (err) {
          execError = err instanceof Error ? err.message : String(err);
        }
      }

      const durationMs = Date.now() - execStart;
      const resultText = execResult
        ? (typeof execResult.content === "string" ? execResult.content : JSON.stringify(execResult.content ?? "")).slice(0, 500)
        : execError;

      if (execSuccess && execResult?.content) {
        const contentStr = typeof execResult.content === "string" ? execResult.content : JSON.stringify(execResult.content, null, 2);
        sendEvent({ type: "tool.stdout", run_id: runId, tool_id: toolId, content: contentStr.slice(0, 8192) });
      }

      await db.update(executions).set({
        status: execSuccess ? "success" : "error", completedAt: new Date(), durationMs,
        resultSummary: resultText.slice(0, 500),
        rawResult: execResult?.content as Record<string, unknown> | null,
        errorMessage: execSuccess ? null : execError || resultText,
      }).where(eq(executions.id, execution.id));

      sendEvent({ type: "tool.completed", run_id: runId, tool_id: toolId, execution_id: execution.id, success: execSuccess, duration_ms: durationMs, ...(execError ? { error: execError } : {}) });

      fullResponse = execSuccess
        ? `Executed **${selectedToolName}** on **${server.name}** in ${durationMs}ms.\n\n**Result:**\n\`\`\`json\n${resultText}\n\`\`\``
        : `Tool **${selectedToolName}** on **${server.name}** failed: ${execError || resultText}`;

      sendEvent({ type: "text.delta", run_id: runId, content: fullResponse });

    } else {
      sendEvent({ type: "model.started", run_id: runId });

      const stream = anthropic.messages.stream({
        model, max_tokens: 8192,
        messages: chatMessages as Parameters<typeof anthropic.messages.stream>[0]["messages"],
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          fullResponse += event.delta.text;
          sendEvent({ type: "text.delta", run_id: runId, content: event.delta.text });
        }
      }
    }

    await db.insert(messages).values({ conversationId: convId, role: "assistant", content: fullResponse, model });
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));

    sendEvent({ type: "run.completed", run_id: runId });
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
