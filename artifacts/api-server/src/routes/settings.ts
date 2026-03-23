import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { settings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { handleRouteError } from "../lib/handle-error";

const router: IRouter = Router();

const defaultSettings = {
  agentName: "Agent",
  defaultModel: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful AI assistant with access to MCP tools.",
  autoRun: false,
  maxToolCalls: 10,
  maxExecutionTime: 60,
  theme: "dark",
  language: "en",
  developerMode: false,
  showTimeline: true,
  showTechnicalDetails: false,
};

router.get("/settings", async (req, res) => {
  try {
    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, unknown> = { ...defaultSettings };

    for (const s of allSettings) {
      try {
        settingsMap[s.key] = JSON.parse(s.valueJson);
      } catch {
        settingsMap[s.key] = s.valueJson;
      }
    }

    res.json(settingsMap);
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    handleRouteError(res, err, "Internal server error");
  }
});

router.put("/settings", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;

    for (const [key, value] of Object.entries(body)) {
      const valueJson = JSON.stringify(value);
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key));

      if (existing.length > 0) {
        await db
          .update(settings)
          .set({ valueJson, updatedAt: new Date() })
          .where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, valueJson });
      }
    }

    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, unknown> = { ...defaultSettings };

    for (const s of allSettings) {
      try {
        settingsMap[s.key] = JSON.parse(s.valueJson);
      } catch {
        settingsMap[s.key] = s.valueJson;
      }
    }

    for (const [key, value] of Object.entries(body)) {
      settingsMap[key] = value;
    }

    res.json(settingsMap);
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
