import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { mcpServers, mcpTools } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import {
  CreateMcpServerBody,
  UpdateMcpServerBody,
  UpdateMcpToolBody,
} from "@workspace/api-zod";
import { maskSecret } from "../../lib/secret-utils";
import { handleRouteError } from "../../lib/handle-error";

const router: IRouter = Router();

router.get("/mcp-servers", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        description: mcpServers.description,
        transportType: mcpServers.transportType,
        endpoint: mcpServers.endpoint,
        command: mcpServers.command,
        args: mcpServers.args,
        authType: mcpServers.authType,
        status: mcpServers.status,
        enabled: mcpServers.enabled,
        timeout: mcpServers.timeout,
        retryCount: mcpServers.retryCount,
        lastCheckedAt: mcpServers.lastCheckedAt,
        createdAt: mcpServers.createdAt,
        toolCount: count(mcpTools.id),
      })
      .from(mcpServers)
      .leftJoin(mcpTools, eq(mcpTools.serverId, mcpServers.id))
      .groupBy(mcpServers.id);

    res.json(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        transportType: s.transportType,
        endpoint: s.endpoint,
        command: s.command,
        args: s.args,
        authType: s.authType,
        status: s.status,
        enabled: s.enabled,
        toolCount: Number(s.toolCount),
        lastCheckedAt: s.lastCheckedAt?.toISOString(),
        createdAt: s.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list MCP servers");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/mcp-servers", async (req, res) => {
  try {
    const body = CreateMcpServerBody.parse(req.body);
    const [server] = await db
      .insert(mcpServers)
      .values({
        name: body.name,
        description: body.description,
        transportType: body.transportType,
        endpoint: body.endpoint,
        command: body.command,
        args: body.args ?? [],
        authType: body.authType ?? "none",
        encryptedSecret: maskSecret(body.authSecret),
        timeout: body.timeout ?? 30,
        retryCount: body.retryCount ?? 3,
        enabled: body.enabled ?? true,
        status: "disconnected",
      })
      .returning();

    res.status(201).json({
      id: server.id,
      name: server.name,
      description: server.description,
      transportType: server.transportType,
      endpoint: server.endpoint,
      command: server.command,
      args: server.args,
      authType: server.authType,
      status: server.status,
      enabled: server.enabled,
      toolCount: 0,
      lastCheckedAt: server.lastCheckedAt?.toISOString(),
      createdAt: server.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/mcp-servers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id));

    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const toolCount = await db
      .select({ count: count() })
      .from(mcpTools)
      .where(eq(mcpTools.serverId, id));

    res.json({
      id: server.id,
      name: server.name,
      description: server.description,
      transportType: server.transportType,
      endpoint: server.endpoint,
      command: server.command,
      args: server.args,
      authType: server.authType,
      status: server.status,
      enabled: server.enabled,
      toolCount: Number(toolCount[0]?.count ?? 0),
      lastCheckedAt: server.lastCheckedAt?.toISOString(),
      createdAt: server.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/mcp-servers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = UpdateMcpServerBody.parse(req.body);

    const updateData: Partial<typeof mcpServers.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.transportType !== undefined) updateData.transportType = body.transportType;
    if (body.endpoint !== undefined) updateData.endpoint = body.endpoint;
    if (body.command !== undefined) updateData.command = body.command;
    if (body.args !== undefined) updateData.args = body.args;
    if (body.authType !== undefined) updateData.authType = body.authType;
    if (body.authSecret !== undefined) updateData.encryptedSecret = maskSecret(body.authSecret);
    if (body.timeout !== undefined) updateData.timeout = body.timeout;
    if (body.retryCount !== undefined) updateData.retryCount = body.retryCount;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;

    const [updated] = await db
      .update(mcpServers)
      .set(updateData)
      .where(eq(mcpServers.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const toolCount = await db
      .select({ count: count() })
      .from(mcpTools)
      .where(eq(mcpTools.serverId, id));

    res.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      transportType: updated.transportType,
      endpoint: updated.endpoint,
      command: updated.command,
      args: updated.args,
      authType: updated.authType,
      status: updated.status,
      enabled: updated.enabled,
      toolCount: Number(toolCount[0]?.count ?? 0),
      lastCheckedAt: updated.lastCheckedAt?.toISOString(),
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.delete("/mcp-servers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await db
      .delete(mcpServers)
      .where(eq(mcpServers.id, id))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/mcp-servers/:id/test", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id));

    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const startTime = Date.now();

    await db
      .update(mcpServers)
      .set({ status: "checking", lastCheckedAt: new Date() })
      .where(eq(mcpServers.id, id));

    let success = false;
    let message = "Connection failed";

    try {
      if (server.transportType === "streamable-http" && server.endpoint) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), (server.timeout ?? 30) * 1000);
        try {
          const response = await fetch(server.endpoint, {
            method: "GET",
            signal: controller.signal,
          });
          clearTimeout(timeout);
          success = response.ok || response.status < 500;
          message = success ? "Connection successful" : `Server returned ${response.status}`;
        } catch (_e) {
          clearTimeout(timeout);
          message = "Could not reach server endpoint";
        }
      } else if (server.transportType === "stdio") {
        success = true;
        message = "stdio server configuration saved (connection tested at runtime)";
      } else {
        message = "No endpoint configured";
      }
    } catch (_err) {
      message = "Connection error";
    }

    const latencyMs = Date.now() - startTime;

    await db
      .update(mcpServers)
      .set({
        status: success ? "connected" : "error",
        lastCheckedAt: new Date(),
      })
      .where(eq(mcpServers.id, id));

    const toolCountResult = await db
      .select({ count: count() })
      .from(mcpTools)
      .where(eq(mcpTools.serverId, id));

    res.json({
      success,
      message,
      toolCount: Number(toolCountResult[0]?.count ?? 0),
      latencyMs,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to test MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/mcp-servers/:id/discover", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id));

    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const existingTools = await db
      .select()
      .from(mcpTools)
      .where(eq(mcpTools.serverId, id));

    if (existingTools.length > 0) {
      res.json(
        existingTools.map((t) => ({
          id: t.id,
          serverId: t.serverId,
          serverName: server.name,
          toolName: t.toolName,
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          enabled: t.enabled,
          requiresApproval: t.requiresApproval,
          createdAt: t.createdAt.toISOString(),
        }))
      );
      return;
    }

    res.json([]);
  } catch (err) {
    req.log.error({ err }, "Failed to discover tools");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/mcp-servers/:id/tools", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id));

    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const tools = await db
      .select()
      .from(mcpTools)
      .where(eq(mcpTools.serverId, id));

    res.json(
      tools.map((t) => ({
        id: t.id,
        serverId: t.serverId,
        serverName: server.name,
        toolName: t.toolName,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        enabled: t.enabled,
        requiresApproval: t.requiresApproval,
        createdAt: t.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list tools");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/mcp-tools/:toolId", async (req, res) => {
  try {
    const toolId = parseInt(req.params.toolId);
    const body = UpdateMcpToolBody.parse(req.body);

    const updateData: Partial<typeof mcpTools.$inferInsert> = {};
    if (body.enabled !== undefined) updateData.enabled = body.enabled;
    if (body.requiresApproval !== undefined) updateData.requiresApproval = body.requiresApproval;

    const [updated] = await db
      .update(mcpTools)
      .set(updateData)
      .where(eq(mcpTools.id, toolId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }

    const [server] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, updated.serverId));

    res.json({
      id: updated.id,
      serverId: updated.serverId,
      serverName: server?.name ?? "",
      toolName: updated.toolName,
      description: updated.description,
      inputSchema: updated.inputSchema,
      outputSchema: updated.outputSchema,
      enabled: updated.enabled,
      requiresApproval: updated.requiresApproval,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update tool");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
