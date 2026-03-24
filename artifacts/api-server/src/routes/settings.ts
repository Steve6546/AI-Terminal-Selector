import { Router, type IRouter } from "express";
import { handleRouteError } from "../lib/handle-error";
import * as settingsService from "../services/settings.service";
import { writeAuditEvent } from "../services/audit.service";

const router: IRouter = Router();

router.get("/settings", async (req, res) => {
  try {
    res.json(await settingsService.getSettings());
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to get settings");
    handleRouteError(res, err, "Internal server error");
  }
});

router.put("/settings", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const result = await settingsService.updateSettings(body);
    await writeAuditEvent({ eventType: "settings.updated", details: { keys: Object.keys(body) }, traceId: req.traceId });
    res.json(result);
  } catch (err) {
    req.log.error({ err, traceId: req.traceId }, "Failed to update settings");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
