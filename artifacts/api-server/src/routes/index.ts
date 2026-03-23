import { Router, type IRouter } from "express";
import healthRouter from "./health";
import anthropicRouter from "./anthropic/conversations";
import mcpRouter from "./mcp/servers";
import toolExecuteRouter from "./mcp/tool-execute";
import systemRouter from "./system/status";
import settingsRouter from "./settings";
import executionsRouter from "./executions";
import logsRouter from "./logs";
import attachmentsRouter from "./attachments";
import terminalTokenRouter from "./terminal-token";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/anthropic", anthropicRouter);
router.use(mcpRouter);
router.use(toolExecuteRouter);
router.use("/system", systemRouter);
router.use(settingsRouter);
router.use(executionsRouter);
router.use(logsRouter);
router.use(attachmentsRouter);
router.use(terminalTokenRouter);

export default router;
