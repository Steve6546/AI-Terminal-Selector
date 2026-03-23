import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { conversations, messages, executions, mcpTools, mcpServers, attachments } from "@workspace/db";
import { eq, desc, count, and, inArray } from "drizzle-orm";
import {
  CreateAnthropicConversationBody,
  UpdateAnthropicConversationBody,
  SendAnthropicMessageBody,
} from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { executeMcpTool } from "../../lib/mcp-gateway";
import { handleRouteError } from "../../lib/handle-error";
import { unmaskSecret } from "../../lib/secret-utils";

const router: IRouter = Router();

router.get("/conversations", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        model: conversations.model,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        messageCount: count(messages.id),
      })
      .from(conversations)
      .leftJoin(messages, eq(messages.conversationId, conversations.id))
      .groupBy(conversations.id)
      .orderBy(desc(conversations.updatedAt));

    res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        model: r.model,
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
  const toolRows = serverIds?.length
    ? await db
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
          and(
            eq(mcpTools.enabled, true),
            eq(mcpServers.enabled, true),
            eq(mcpServers.status, "connected")
          )
        )
    : await db
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
          and(
            eq(mcpTools.enabled, true),
            eq(mcpServers.enabled, true),
            eq(mcpServers.status, "connected")
          )
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
    const mode = (req.body as { mode?: string }).mode ?? "agent";
    const rawAttachmentIds = (req.body as { attachmentIds?: unknown }).attachmentIds;
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

      // Agentic loop: keep calling Claude until no more tool_use blocks
      type LoopMsg = { role: "user" | "assistant"; content: unknown };
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

        // Add assistant tool_use block and tool results to the message history
        if (toolUseBlocks.length > 0) {
          loopMessages.push({
            role: "assistant",
            content: toolUseBlocks.map((b) => ({
              type: "tool_use" as const,
              id: b.id,
              name: b.name,
              input: b.input,
            })) as unknown as string,
          });
          loopMessages.push({
            role: "user",
            content: toolResults as unknown as string,
          });
        }
      }
    } else {
      // Tool mode: plain streaming without MCP tools
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

    // Auto-title: if still default title, derive from first user message
    const updatePayload: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date() };
    if (conv.title === "New Conversation") {
      const userMsg = body.content.trim().replace(/\s+/g, " ");
      const autoTitle = userMsg.length > 60 ? userMsg.slice(0, 57) + "..." : userMsg;
      if (autoTitle) updatePayload.title = autoTitle;
    }

    await db
      .update(conversations)
      .set(updatePayload)
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

export default router;
