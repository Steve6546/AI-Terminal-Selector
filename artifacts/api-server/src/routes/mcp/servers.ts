import { Router, type IRouter } from "express";
import { CreateMcpServerBody, UpdateMcpServerBody, UpdateMcpToolBody } from "@workspace/api-zod";
import { handleRouteError } from "../../lib/handle-error";
import * as mcpService from "../../services/mcp-discovery.service";
import { writeAuditEvent } from "../../services/audit.service";

const router: IRouter = Router();

router.get("/mcp-servers", async (req, res) => {
  try {
    res.json(await mcpService.listServers());
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to list MCP servers");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/mcp-servers", async (req, res) => {
  try {
    const body = CreateMcpServerBody.parse(req.body);
    const result = await mcpService.createServer(body);
    if ("error" in result) { res.status(403).json({ error: result.error }); return; }
    await writeAuditEvent({ eventType: "mcp_server.created", entityType: "mcp_server", entityId: result.server.id, details: { name: result.server.name }, traceId: req.traceId });
    res.status(201).json(result.server);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to create MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/mcp-servers/:id", async (req, res) => {
  try {
    const server = await mcpService.getServer(parseInt(req.params.id));
    if (!server) { res.status(404).json({ error: "Server not found" }); return; }
    res.json(server);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to get MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/mcp-servers/:id", async (req, res) => {
  try {
    const body = UpdateMcpServerBody.parse(req.body);
    const result = await mcpService.updateServer(parseInt(req.params.id), body);
    if ("notFound" in result) { res.status(404).json({ error: "Server not found" }); return; }
    if ("error" in result) { res.status(403).json({ error: result.error }); return; }
    res.json(result.server);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to update MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.delete("/mcp-servers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await mcpService.deleteServer(id);
    if (!deleted) { res.status(404).json({ error: "Server not found" }); return; }
    await writeAuditEvent({ eventType: "mcp_server.deleted", entityType: "mcp_server", entityId: id, traceId: req.traceId });
    res.status(204).send();
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to delete MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/mcp-servers/:id/test", async (req, res) => {
  try {
    const result = await mcpService.testServer(parseInt(req.params.id));
    if ("notFound" in result) { res.status(404).json({ error: "Server not found" }); return; }
    if ("error" in result) { res.status(403).json({ error: result.error }); return; }
    res.json(result.result);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to test MCP server");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/mcp-servers/:id/discover", async (req, res) => {
  try {
    const result = await mcpService.discoverServer(parseInt(req.params.id));
    if ("notFound" in result) { res.status(404).json({ error: "Server not found" }); return; }
    if ("error" in result) { res.status(403).json({ error: result.error }); return; }
    res.json(result.tools);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to discover tools");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/mcp-servers/:id/tools", async (req, res) => {
  try {
    const tools = await mcpService.getServerTools(parseInt(req.params.id));
    if (!tools) { res.status(404).json({ error: "Server not found" }); return; }
    res.json(tools);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to list tools");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/mcp-servers/:id/prompts", async (req, res) => {
  try {
    const prompts = await mcpService.getServerPrompts(parseInt(req.params.id));
    if (!prompts) { res.status(404).json({ error: "Server not found" }); return; }
    res.json(prompts);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to list prompts");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/mcp-servers/:id/resources", async (req, res) => {
  try {
    const resources = await mcpService.getServerResources(parseInt(req.params.id));
    if (!resources) { res.status(404).json({ error: "Server not found" }); return; }
    res.json(resources);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to list resources");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/mcp-tools/:toolId", async (req, res) => {
  try {
    const body = UpdateMcpToolBody.parse(req.body);
    const updated = await mcpService.updateTool(parseInt(req.params.toolId), body);
    if (!updated) { res.status(404).json({ error: "Tool not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to update tool");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
