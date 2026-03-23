/**
 * Tool Mode execution — POST /mcp-tools/:toolId/execute
 *
 * Directly executes a specific MCP tool with user-supplied arguments.
 * Creates an execution record, calls the Python gateway, and returns the result.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { mcpTools, mcpServers, executions } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeMcpTool } from "../../lib/mcp-gateway";
import { handleRouteError } from "../../lib/handle-error";
import { unmaskSecret } from "../../lib/secret-utils";
import { checkEndpointAllowed } from "../../lib/domain-allowlist";

const router: IRouter = Router();

router.post("/mcp-tools/:toolId/execute", async (req, res) => {
  try {
    const toolId = parseInt(req.params.toolId);
    const { arguments: toolArgs = {}, conversationId } = req.body as {
      arguments?: Record<string, unknown>;
      conversationId?: number;
    };

    const [tool] = await db
      .select()
      .from(mcpTools)
      .where(eq(mcpTools.id, toolId));

    if (!tool) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }

    const [server] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, tool.serverId));

    if (!server) {
      res.status(404).json({ error: "Server not found for this tool" });
      return;
    }

    if (!tool.enabled) {
      res.status(400).json({ error: "Tool is disabled" });
      return;
    }

    const allowCheck = await checkEndpointAllowed(server.endpoint, server.transportType);
    if (!allowCheck.allowed) {
      res.status(403).json({ error: allowCheck.reason ?? "Endpoint not allowed by domain allowlist" });
      return;
    }

    if (tool.requiresApproval) {
      const { approved } = req.body as { approved?: boolean };
      if (!approved) {
        res.status(403).json({
          error: "Tool requires explicit approval before execution",
          requiresApproval: true,
          toolId: tool.id,
          toolName: tool.toolName,
        });
        return;
      }
    }

    const [execution] = await db
      .insert(executions)
      .values({
        conversationId: conversationId ?? null,
        serverId: server.id,
        toolName: tool.toolName,
        status: "running",
        arguments: toolArgs,
      })
      .returning();

    const startedAt = Date.now();

    const result = await executeMcpTool(
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
      tool.toolName,
      toolArgs
    );

    const durationMs = Date.now() - startedAt;

    const summary = result.success
      ? typeof result.content === "string"
        ? result.content.slice(0, 500)
        : JSON.stringify(result.content ?? "").slice(0, 500)
      : result.error ?? "Unknown error";

    const [updated] = await db
      .update(executions)
      .set({
        status: result.success ? "success" : "error",
        completedAt: new Date(),
        durationMs,
        resultSummary: summary,
        rawResult: result.content as Record<string, unknown> | null,
        errorMessage: result.error ?? null,
      })
      .where(eq(executions.id, execution.id))
      .returning();

    res.json({
      id: updated.id,
      conversationId: updated.conversationId,
      serverId: updated.serverId,
      serverName: server.name,
      toolName: updated.toolName,
      status: updated.status,
      startedAt: updated.startedAt.toISOString(),
      completedAt: updated.completedAt?.toISOString(),
      durationMs: updated.durationMs,
      resultSummary: updated.resultSummary,
      rawResult: updated.rawResult,
      errorMessage: updated.errorMessage,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to execute tool");
    handleRouteError(res, err, "Tool execution failed");
  }
});

export default router;
