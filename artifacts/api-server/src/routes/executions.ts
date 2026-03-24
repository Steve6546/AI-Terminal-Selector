import { Router, type IRouter } from "express";
import { handleRouteError } from "../lib/handle-error";
import * as executionService from "../services/execution.service";

const router: IRouter = Router();

router.get("/executions", async (req, res) => {
  try {
    const conversationId = req.query.conversationId
      ? parseInt(req.query.conversationId as string)
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    res.json(await executionService.listExecutions(conversationId, limit));
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to list executions");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
