import { db } from "@workspace/db";
import { settings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const defaultSettings: Record<string, unknown> = {
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
  debugLogging: false,
};

async function buildSettingsMap(): Promise<Record<string, unknown>> {
  const allSettings = await db.select().from(settings);
  const settingsMap: Record<string, unknown> = { ...defaultSettings };

  for (const s of allSettings) {
    try {
      settingsMap[s.key] = JSON.parse(s.valueJson);
    } catch {
      settingsMap[s.key] = s.valueJson;
    }
  }

  return settingsMap;
}

export async function getSettings(): Promise<Record<string, unknown>> {
  return buildSettingsMap();
}

export async function updateSettings(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  for (const [key, value] of Object.entries(body)) {
    const valueJson = JSON.stringify(value);
    const existing = await db.select().from(settings).where(eq(settings.key, key));

    if (existing.length > 0) {
      await db.update(settings).set({ valueJson, updatedAt: new Date() }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, valueJson });
    }
  }

  if ("debugLogging" in body) {
    const level = body.debugLogging ? "debug" : "info";
    logger.level = level;
    logger.info({ debugLogging: body.debugLogging, level }, "Log level changed");
  }

  const settingsMap = await buildSettingsMap();
  for (const [key, value] of Object.entries(body)) {
    settingsMap[key] = value;
  }

  return settingsMap;
}
