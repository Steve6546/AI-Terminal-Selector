import { Router, type IRouter } from "express";
import healthRouter from "./health";
import conversationsRouter from "./conversations";
import mcpRouter from "./mcp/servers";
import toolExecuteRouter from "./mcp/tool-execute";
import systemRouter from "./system/status";
import settingsRouter from "./settings";
import executionsRouter from "./executions";
import logsRouter from "./logs";
import attachmentsRouter from "./attachments";
import terminalTokenRouter from "./terminal-token";
import databaseConnectionsRouter from "./database-connections";
import mcpAgentRouter from "./mcp-agent/chat";
import internalRouter from "./internal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(conversationsRouter);

router.use("/anthropic/*path", (req, res) => {
  const newPath = `/api/${req.params.path}`;
  res.redirect(308, newPath);
});
router.use(mcpRouter);
router.use(toolExecuteRouter);
router.use("/system", systemRouter);
router.use(settingsRouter);
router.use(executionsRouter);
router.use(logsRouter);
router.use(attachmentsRouter);
router.use(terminalTokenRouter);
router.use(databaseConnectionsRouter);
router.use(mcpAgentRouter);
router.use(internalRouter);

export default router;
