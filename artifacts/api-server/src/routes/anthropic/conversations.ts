import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { conversations, messages, executions, mcpTools, mcpServers, attachments } from "@workspace/db";
import { eq, desc, count, and, inArray, gte } from "drizzle-orm";
import {
  CreateAnthropicConversationBody,
  UpdateAnthropicConversationBody,
  SendAnthropicMessageBody,
} from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { executeMcpTool } from "../../lib/mcp-gateway";
import { handleRouteError } from "../../lib/handle-error";
import { unmaskSecret } from "../../lib/secret-utils";
import { checkEndpointAllowed } from "../../lib/domain-allowlist";

const router: IRouter = Router();

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

    // Sort: pinned first (desc pinnedAt), then by updatedAt desc
    const sorted = [...rows].sort((a, b) => {
      const aPin = a.pinnedAt ? a.pinnedAt.getTime() : 0;
      const bPin = b.pinnedAt ? b.pinnedAt.getTime() : 0;
      if (aPin !== bPin) return bPin - aPin; // pinned first
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
    const body = CreateAnthropicConversationBody.parse(req.body);
    const [conv] = await db
      .insert(conversations)
      .values({
        title: body.title,
        model: body.model ?? "claude-sonnet-4-6",
      })
      .returning();

    res.status(201).json({
      id: conv.id,
      title: conv.title,
      model: conv.model,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      messageCount: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);

    res.json({
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
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.delete("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await db
      .delete(conversations)
      .where(eq(conversations.id, id))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = UpdateAnthropicConversationBody.parse(req.body);

    const updateData: Partial<typeof conversations.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.model !== undefined) updateData.model = body.model;

    const [updated] = await db
      .update(conversations)
      .set(updateData)
      .where(eq(conversations.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.json({
      id: updated.id,
      title: updated.title,
      model: updated.model,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      messageCount: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);

    res.json(
      msgs.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        model: m.model,
        createdAt: m.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list messages");
    handleRouteError(res, err, "Internal server error");
  }
});

/**
 * Build Anthropic tool definitions from enabled MCP tools for a given
 * list of server IDs (or all enabled servers if none provided).
 */
async function buildAnthropicTools(
  serverIds?: number[]
): Promise<
  Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    _toolId: number;
    _serverId: number;
  }>
> {
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
    .where(
      serverIds?.length
        ? and(baseConditions, inArray(mcpTools.serverId, serverIds))
        : baseConditions
    );

  return toolRows.map((t) => ({
    name: `${t.serverId}__${t.toolName}`,
    description: t.description ?? t.toolName,
    input_schema: (t.inputSchema as Record<string, unknown>) ?? {
      type: "object",
      properties: {},
    },
    _toolId: t.id,
    _serverId: t.serverId,
  }));
}

router.post("/conversations/:id/messages", async (req, res) => {
  try {
    const convId = parseInt(req.params.id);
    const body = SendAnthropicMessageBody.parse(req.body);

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId));

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const model = body.model ?? conv.model ?? "claude-sonnet-4-6";
    const rawBody = req.body as {
      mode?: string;
      attachmentIds?: unknown;
      selectedServerId?: unknown;
      selectedToolName?: unknown;
      toolArgs?: unknown;
    };
    const mode = rawBody.mode ?? "agent";
    const rawAttachmentIds = rawBody.attachmentIds;
    const attachmentIds: number[] = Array.isArray(rawAttachmentIds)
      ? rawAttachmentIds.filter((id): id is number => typeof id === "number")
      : [];

    await db.insert(messages).values({
      conversationId: convId,
      role: "user",
      content: body.content,
      model,
    });

    // Fetch attachment records if provided
    const attachmentRows = attachmentIds.length > 0
      ? await db.select().from(attachments).where(inArray(attachments.id, attachmentIds))
      : [];

    const allMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(messages.createdAt);

    // Build chat messages, enriching the last user message with file attachments
    const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
    type ImageMediaType = typeof IMAGE_MIMES[number];
    function isImageMime(m: string): m is ImageMediaType {
      return (IMAGE_MIMES as readonly string[]).includes(m);
    }

    type MsgParam = { role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> };

    const chatMessages: MsgParam[] = allMessages.map((m, idx) => {
      const isLastUser = idx === allMessages.length - 1 && m.role === "user";
      if (isLastUser && attachmentRows.length > 0) {
        const contentBlocks: Array<{ type: string; [k: string]: unknown }> = [{ type: "text", text: m.content }];
        for (const att of attachmentRows) {
          if (!att.content) continue;
          if (isImageMime(att.fileType)) {
            contentBlocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: att.fileType as ImageMediaType,
                data: att.content,
              },
            });
          } else {
            // Text/code/PDF: include as a text block with filename context
            const decoded = Buffer.from(att.content, "base64").toString("utf-8");
            contentBlocks.push({
              type: "text",
              text: `\n\n<file name="${att.fileName}" type="${att.fileType}">\n${decoded}\n</file>`,
            });
          }
        }
        return {
          role: m.role as "user" | "assistant",
          content: contentBlocks,
        };
      }
      return {
        role: m.role as "user" | "assistant",
        content: m.content,
      };
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // ── In-session context summarization ─────────────────────────────────────
    // If the conversation history is long (> 20 messages), summarize older turns
    // into a compact context block to avoid hitting token limits while keeping
    // the recent exchange intact for coherent responses.
    const SUMMARY_THRESHOLD = 20;
    const RECENT_MESSAGES_TO_KEEP = 8;

    if (chatMessages.length > SUMMARY_THRESHOLD) {
      const olderMessages = chatMessages.slice(0, chatMessages.length - RECENT_MESSAGES_TO_KEEP);

      // Build a plain-text transcript of older messages for summarization
      const transcript = olderMessages
        .map((m) => {
          const roleLabel = m.role === "user" ? "User" : "Assistant";
          const text = typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? (m.content as Array<{ type: string; text?: string }>)
                  .filter((b) => b.type === "text" && b.text)
                  .map((b) => b.text)
                  .join(" ")
              : "";
          return `${roleLabel}: ${text.slice(0, 500)}`;
        })
        .join("\n\n");

      try {
        const summaryResult = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 512,
          messages: [
            {
              role: "user",
              content: `Summarize the following conversation history into a concise paragraph (max 300 words) that captures the key topics, decisions, and context needed to continue the conversation:\n\n${transcript}\n\nSummary:`,
            },
          ],
        });

        const summaryText = summaryResult.content[0]?.type === "text"
          ? summaryResult.content[0].text.trim()
          : "";

        if (summaryText) {
          // Replace the older messages with a single summarized context message
          const summaryBlock: { role: "user" | "assistant"; content: string } = {
            role: "user",
            content: `[Earlier conversation summary: ${summaryText}]`,
          };
          // Need a placeholder assistant ack to keep alternating role structure
          const ackBlock: { role: "user" | "assistant"; content: string } = {
            role: "assistant",
            content: "Understood, I'll keep that context in mind.",
          };
          chatMessages.splice(0, olderMessages.length, summaryBlock, ackBlock);
        }
      } catch {
        // Summarization failed — continue with full history (silent fallback)
      }
    }

    let fullResponse = "";

    if (mode === "agent") {
      // Agent mode: enable MCP tools and handle tool_use blocks
      const mcpToolDefs = await buildAnthropicTools();

      // Convert tool defs to Anthropic format (without internal _toolId/_serverId)
      const anthropicTools = mcpToolDefs.map(({ name, description, input_schema }) => ({
        name,
        description,
        input_schema,
      }));

      // Properly typed Anthropic content blocks for tool use / tool result turns.
      // ContentPart is kept intentionally broad to cover both initial DB messages
      // (which may carry arbitrary typed blocks) and the structured blocks we push below.
      // The push() calls use explicit return-type annotations to catch shape errors at the callsite.
      type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
      type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
      type ContentPart = string | { type: string; [k: string]: unknown };
      type LoopMsg = { role: "user" | "assistant"; content: ContentPart | ContentPart[] };

      // Agentic loop: keep calling Claude until no more tool_use blocks
      let loopMessages: LoopMsg[] = [...chatMessages];
      let loopCount = 0;
      const MAX_LOOPS = 10;

      // Emit planning phase before first Claude call
      sendEvent({ tool_execution: { phase: "planning", message: "Agent is planning next steps..." } });

      while (loopCount < MAX_LOOPS) {
        loopCount++;

        const requestParams: Parameters<typeof anthropic.messages.stream>[0] = {
          model,
          max_tokens: 8192,
          messages: loopMessages as Parameters<typeof anthropic.messages.stream>[0]["messages"],
        };

        if (anthropicTools.length > 0) {
          (requestParams as Record<string, unknown>).tools = anthropicTools;
        }

        const stream = anthropic.messages.stream(requestParams);

        let currentTextBlock = "";
        const toolUseBlocks: Array<{
          id: string;
          name: string;
          input: Record<string, unknown>;
        }> = [];

        let stopReason: string | null = null;

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            currentTextBlock += event.delta.text;
            fullResponse += event.delta.text;
            sendEvent({ content: event.delta.text });
          } else if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use") {
              toolUseBlocks.push({
                id: event.content_block.id,
                name: event.content_block.name,
                input: {},
              });
            }
          } else if (
            event.type === "content_block_delta" &&
            event.delta.type === "input_json_delta"
          ) {
            const last = toolUseBlocks[toolUseBlocks.length - 1];
            if (last) {
              try {
                const partialJson = (last as { _rawInput?: string })._rawInput ?? "";
                (last as { _rawInput?: string })._rawInput =
                  partialJson + event.delta.partial_json;
              } catch {
                // ignore
              }
            }
          } else if (event.type === "message_delta") {
            stopReason = event.delta.stop_reason ?? null;
          }
        }

        // Parse accumulated JSON inputs for tool_use blocks
        for (const block of toolUseBlocks) {
          const raw = (block as { _rawInput?: string })._rawInput;
          if (raw) {
            try {
              block.input = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              block.input = {};
            }
          }
        }

        if (currentTextBlock) {
          loopMessages.push({ role: "assistant", content: currentTextBlock });
        }

        // No tool calls → done
        if (toolUseBlocks.length === 0 || stopReason === "end_turn") {
          break;
        }

        // Execute each tool and collect results
        const toolResults: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: string;
        }> = [];

        for (const block of toolUseBlocks) {
          // Parse serverId from tool name format: "{serverId}__{toolName}"
          const underscoreIdx = block.name.indexOf("__");
          const serverId = underscoreIdx > 0
            ? parseInt(block.name.slice(0, underscoreIdx))
            : null;
          const rawToolName = underscoreIdx > 0
            ? block.name.slice(underscoreIdx + 2)
            : block.name;

          // Notify client that execution is starting
          sendEvent({
            tool_execution: {
              phase: "starting",
              toolName: rawToolName,
              serverId,
            },
          });

          let servConfig: typeof mcpServers.$inferSelect | null = null;
          if (serverId) {
            const [srv] = await db
              .select()
              .from(mcpServers)
              .where(eq(mcpServers.id, serverId));
            servConfig = srv ?? null;
          }

          // Emit selecting-server phase
          sendEvent({
            tool_execution: {
              phase: "selecting-server",
              toolName: rawToolName,
              serverId,
              serverName: servConfig?.name ?? "unknown",
              message: `Selecting server: ${servConfig?.name ?? "unknown"} for tool ${rawToolName}`,
            },
          });

          // Enforce requiresApproval policy: if the tool requires approval, skip execution
          let toolRecord: typeof mcpTools.$inferSelect | null = null;
          if (serverId) {
            const [t] = await db
              .select()
              .from(mcpTools)
              .where(and(eq(mcpTools.serverId, serverId), eq(mcpTools.toolName, rawToolName)));
            toolRecord = t ?? null;
          }

          if (toolRecord?.requiresApproval) {
            // Tool is policy-gated — record it as blocked and inform Claude
            const [blockedExec] = await db
              .insert(executions)
              .values({
                conversationId: convId,
                serverId: serverId ?? null,
                toolName: rawToolName,
                status: "error",
                arguments: block.input,
                errorMessage: "Execution blocked: tool requires manual approval",
                completedAt: new Date(),
                durationMs: 0,
              })
              .returning();

            sendEvent({
              tool_execution: {
                phase: "done",
                executionId: blockedExec.id,
                toolName: rawToolName,
                serverId,
                serverName: servConfig?.name,
                success: false,
              },
            });

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Tool "${rawToolName}" requires manual approval before it can be executed. Ask the user to run it directly from the MCP Servers page or disable approval requirement in the server settings.`,
            });
            continue;
          }

          // Create execution record
          const [execRow] = await db
            .insert(executions)
            .values({
              conversationId: convId,
              serverId: serverId ?? null,
              toolName: rawToolName,
              status: "running",
              arguments: block.input,
            })
            .returning();

          sendEvent({
            tool_execution: {
              phase: "running",
              executionId: execRow.id,
              toolName: rawToolName,
              serverId,
              serverName: servConfig?.name,
            },
          });

          const execStart = Date.now();
          let execResult: { success: boolean; content?: unknown; error?: string };

          if (servConfig) {
            const runtimeAllowCheck = await checkEndpointAllowed(servConfig.endpoint, servConfig.transportType);
            if (!runtimeAllowCheck.allowed) {
              execResult = {
                success: false,
                error: runtimeAllowCheck.reason ?? "Endpoint not allowed by domain allowlist",
              };
            } else {
              execResult = await executeMcpTool(
                {
                  transportType: servConfig.transportType,
                  endpoint: servConfig.endpoint,
                  command: servConfig.command,
                  args: (servConfig.args as string[]) ?? [],
                  authType: servConfig.authType,
                  authSecret: unmaskSecret(servConfig.encryptedSecret),
                  timeout: servConfig.timeout,
                  retryCount: servConfig.retryCount,
                },
                rawToolName,
                block.input
              );
            }
          } else {
            execResult = { success: false, error: "Server not found" };
          }

          const durationMs = Date.now() - execStart;
          const resultText = execResult.success
            ? JSON.stringify(execResult.content ?? "")
            : `Error: ${execResult.error ?? "Unknown error"}`;

          // Update execution record
          await db
            .update(executions)
            .set({
              status: execResult.success ? "success" : "error",
              completedAt: new Date(),
              durationMs,
              resultSummary: resultText.slice(0, 500),
              rawResult: execResult.content as Record<string, unknown> | null,
              errorMessage: execResult.error ?? null,
            })
            .where(eq(executions.id, execRow.id));

          sendEvent({
            tool_execution: {
              phase: "done",
              executionId: execRow.id,
              toolName: rawToolName,
              serverId,
              serverName: servConfig?.name,
              success: execResult.success,
              durationMs,
            },
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultText,
          });
        }

        // Add properly typed assistant tool_use blocks and tool results to the message history
        if (toolUseBlocks.length > 0) {
          loopMessages.push({
            role: "assistant",
            content: toolUseBlocks.map((b): ToolUseBlock => ({
              type: "tool_use",
              id: b.id,
              name: b.name,
              input: b.input,
            })),
          });
          loopMessages.push({
            role: "user",
            content: toolResults.map((r): ToolResultBlock => ({
              type: "tool_result",
              tool_use_id: r.tool_use_id,
              content: r.content,
            })),
          });
        }
      }
    } else if (mode === "tool") {
      // Tool mode: user has explicitly selected a server + tool + args; execute directly (no LLM planning)
      const selectedServerId = typeof rawBody.selectedServerId === "number" ? rawBody.selectedServerId : null;
      const selectedToolName = typeof rawBody.selectedToolName === "string" ? rawBody.selectedToolName : null;
      const toolArgs = (rawBody.toolArgs && typeof rawBody.toolArgs === "object" && !Array.isArray(rawBody.toolArgs))
        ? (rawBody.toolArgs as Record<string, unknown>)
        : {};

      if (!selectedServerId || !selectedToolName) {
        sendEvent({ error: "Tool mode requires selectedServerId and selectedToolName" });
        sendEvent({ done: true });
        res.end();
        return;
      }

      // Look up server and tool
      const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, selectedServerId));
      if (!server) {
        sendEvent({ error: `MCP server #${selectedServerId} not found` });
        sendEvent({ done: true });
        res.end();
        return;
      }

      const [toolRecord] = await db
        .select()
        .from(mcpTools)
        .where(and(eq(mcpTools.serverId, selectedServerId), eq(mcpTools.toolName, selectedToolName)));

      if (!toolRecord) {
        sendEvent({ error: `Tool "${selectedToolName}" not found on server "${server.name}"` });
        sendEvent({ done: true });
        res.end();
        return;
      }

      if (!toolRecord.enabled) {
        sendEvent({ error: `Tool "${selectedToolName}" is disabled` });
        sendEvent({ done: true });
        res.end();
        return;
      }

      const { approved: toolApproved } = rawBody as { approved?: boolean };
      if (toolRecord.requiresApproval && !toolApproved) {
        sendEvent({
          error: `Tool "${selectedToolName}" requires explicit approval before execution`,
          requiresApproval: true,
          toolId: toolRecord.id,
          toolName: selectedToolName,
        });
        sendEvent({ done: true });
        res.end();
        return;
      }

      // Emit selecting-server phase
      sendEvent({
        tool_execution: {
          phase: "selecting-server",
          serverName: server.name,
          message: `Connecting to "${server.name}"...`,
        },
      });

      // Create execution record
      const [execution] = await db
        .insert(executions)
        .values({
          conversationId: convId,
          serverId: server.id,
          toolName: selectedToolName,
          status: "running",
          startedAt: new Date(),
        })
        .returning();

      // Emit running phase
      sendEvent({
        tool_execution: {
          phase: "running",
          executionId: execution.id,
          toolName: selectedToolName,
          serverId: server.id,
          serverName: server.name,
        },
      });

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
              transportType: server.transportType,
              endpoint: server.endpoint,
              command: server.command,
              args: (server.args as string[]) ?? [],
              authType: server.authType,
              authSecret: unmaskSecret(server.encryptedSecret),
              timeout: server.timeout,
              retryCount: server.retryCount,
            },
            selectedToolName,
            toolArgs
          );
          execSuccess = execResult.success;
        } catch (err) {
          execError = err instanceof Error ? err.message : String(err);
        }
      }

      const durationMs = Date.now() - execStart;
      const resultText = execResult
        ? (typeof execResult.content === "string"
            ? execResult.content
            : JSON.stringify(execResult.content ?? "")).slice(0, 500)
        : execError;

      await db
        .update(executions)
        .set({
          status: execSuccess ? "success" : "error",
          completedAt: new Date(),
          durationMs,
          resultSummary: resultText.slice(0, 500),
          rawResult: execResult?.content as Record<string, unknown> | null,
          errorMessage: execSuccess ? null : execError || resultText,
        })
        .where(eq(executions.id, execution.id));

      // Emit done phase
      sendEvent({
        tool_execution: {
          phase: "done",
          executionId: execution.id,
          toolName: selectedToolName,
          serverId: server.id,
          serverName: server.name,
          success: execSuccess,
          durationMs,
        },
      });

      // Save assistant message summarizing the direct tool execution
      fullResponse = execSuccess
        ? `Executed **${selectedToolName}** on **${server.name}** in ${durationMs}ms.\n\n**Result:**\n\`\`\`json\n${resultText}\n\`\`\``
        : `Tool **${selectedToolName}** on **${server.name}** failed: ${execError || resultText}`;

      sendEvent({ content: fullResponse });
    } else {
      // Fallback: plain streaming without MCP tools
      const stream = anthropic.messages.stream({
        model,
        max_tokens: 8192,
        messages: chatMessages as Parameters<typeof anthropic.messages.stream>[0]["messages"],
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullResponse += event.delta.text;
          sendEvent({ content: event.delta.text });
        }
      }
    }

    await db.insert(messages).values({
      conversationId: convId,
      role: "assistant",
      content: fullResponse,
      model,
    });

    // Only update updatedAt here; AI-based auto-naming is handled by /auto-name endpoint
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, convId));

    sendEvent({ done: true });
    res.end();
  } catch (err) {
    req.log.error({ err }, "Failed to send message");
    if (!res.headersSent) {
      handleRouteError(res, err, "Internal server error");
    } else {
      res.write(
        `data: ${JSON.stringify({ error: "Stream error occurred" })}\n\n`
      );
      res.end();
    }
  }
});

// ─── DELETE /conversations/:id/messages-from/:messageId ───────────────────────
// Delete all messages from the given message ID onward (inclusive by createdAt),
// as well as any executions that started at or after that point.
// Used by Edit & Retry features in the frontend.
router.delete("/conversations/:id/messages-from/:messageId", async (req, res) => {
  try {
    const convId = parseInt(req.params.id);
    const messageId = parseInt(req.params.messageId);

    // Find the target message to get its createdAt
    const [target] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, convId)));

    if (!target) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    // Delete all messages with createdAt >= target.createdAt in this conversation
    await db
      .delete(messages)
      .where(and(eq(messages.conversationId, convId), gte(messages.createdAt, target.createdAt)));

    // Delete any executions that started at or after the truncation point
    await db
      .delete(executions)
      .where(and(eq(executions.conversationId, convId), gte(executions.startedAt, target.createdAt)));

    // Update conversation updatedAt
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, convId));

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to truncate messages");
    handleRouteError(res, err, "Internal server error");
  }
});

// ─── POST /conversations/:id/auto-name ────────────────────────────────────────
// Use Claude to generate a concise title from the first two messages.
// When called automatically (query param force=false or absent), this is a no-op
// if the title has already been manually set (i.e., not a default placeholder).
// Pass ?force=true to override any existing title (e.g., from sidebar "Auto-name with AI").
const DEFAULT_TITLES = new Set(["New Chat", "New Conversation"]);

router.post("/conversations/:id/auto-name", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const force = req.query.force === "true";

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // When not forced, only auto-name if the title is still a default placeholder.
    // This prevents overwriting manually-set titles when called after every message.
    if (!force && !DEFAULT_TITLES.has(conv.title)) {
      res.json({ title: conv.title });
      return;
    }

    const msgs = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt)
      .limit(2);

    if (msgs.length < 2) {
      // Need at least one user + one assistant message for a meaningful title
      res.json({ title: conv.title });
      return;
    }

    const prompt = msgs
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const naming = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content: `Generate a concise chat title (3-6 words, no quotes, no punctuation at end) for this conversation:\n\n${prompt}\n\nTitle:`,
        },
      ],
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

// ─── POST /conversations/:id/pin ──────────────────────────────────────────────
router.post("/conversations/:id/pin", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [updated] = await db
      .update(conversations)
      .set({ pinnedAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ id: updated.id, pinnedAt: updated.pinnedAt?.toISOString() ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to pin conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

// ─── POST /conversations/:id/unpin ────────────────────────────────────────────
router.post("/conversations/:id/unpin", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [updated] = await db
      .update(conversations)
      .set({ pinnedAt: null, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ id: updated.id, pinnedAt: null });
  } catch (err) {
    req.log.error({ err }, "Failed to unpin conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

// ─── POST /conversations/:id/duplicate ────────────────────────────────────────
router.post("/conversations/:id/duplicate", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const [newConv] = await db
      .insert(conversations)
      .values({ title: `${conv.title} (copy)`, model: conv.model })
      .returning();

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);

    if (msgs.length > 0) {
      await db.insert(messages).values(
        msgs.map((m) => ({
          conversationId: newConv.id,
          role: m.role,
          content: m.content,
          model: m.model,
        }))
      );
    }

    res.status(201).json({
      id: newConv.id,
      title: newConv.title,
      model: newConv.model,
      pinnedAt: null,
      createdAt: newConv.createdAt.toISOString(),
      updatedAt: newConv.updatedAt.toISOString(),
      messageCount: msgs.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to duplicate conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

// ─── GET /conversations/:id/export ────────────────────────────────────────────
router.get("/conversations/:id/export", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const format = (req.query.format as string) === "markdown" ? "markdown" : "json";

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);

    if (format === "markdown") {
      const lines: string[] = [`# ${conv.title}`, ``, `*Model: ${conv.model} | Created: ${conv.createdAt.toISOString()}*`, ``];
      for (const m of msgs) {
        lines.push(`## ${m.role === "user" ? "You" : "Assistant"}`);
        lines.push(m.content);
        lines.push("");
      }
      const md = lines.join("\n");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="chat-${id}.md"`);
      res.send(md);
    } else {
      const payload = {
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
      };
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="chat-${id}.json"`);
      res.json(payload);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to export conversation");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
