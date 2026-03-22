import { Router, type IRouter } from "express";
import healthRouter from "./health";
import anthropicRouter from "./anthropic/conversations";
import mcpRouter from "./mcp/servers";
import systemRouter from "./system/status";
import settingsRouter from "./settings";
import executionsRouter from "./executions";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/anthropic", anthropicRouter);
router.use(mcpRouter);
router.use("/system", systemRouter);
router.use(settingsRouter);
router.use(executionsRouter);

export default router;
