import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { handleRouteError } from "../../lib/handle-error";
import * as systemService from "../../services/system.service";
import { streamManager } from "../../services/stream-manager";
import { getToolMetrics } from "../../services/metrics.service";

const router: IRouter = Router();

router.get("/status", async (req, res) => {
  try {
    res.json(await systemService.getSystemStatus());
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to get system status");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/executions", async (req, res) => {
  try {
    const conversationId = req.query.conversationId
      ? parseInt(req.query.conversationId as string)
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    res.json(await systemService.getSystemExecutions(conversationId, limit));
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to list executions");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/status/events", (req, res) => {
  const clientId = randomUUID();
  streamManager.addClient(clientId, res);
  req.on("close", () => {
    streamManager.removeClient(clientId);
  });
});

router.get("/metrics", (_req, res) => {
  res.json({
    tools: getToolMetrics(),
    streamClients: streamManager.getClientCount(),
  });
});

export default router;
