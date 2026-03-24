import { db } from "@workspace/db";
import { auditEvents } from "@workspace/db";
import { logger } from "../lib/logger";

interface ToolMetrics {
  executionCount: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  lastExecutionAt: string | null;
}

const toolMetricsMap = new Map<string, ToolMetrics>();
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL_MS = 60_000;

export function recordToolExecution(
  toolName: string,
  success: boolean,
  latencyMs: number,
): void {
  const existing = toolMetricsMap.get(toolName) ?? {
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    totalLatencyMs: 0,
    lastExecutionAt: null,
  };

  existing.executionCount += 1;
  if (success) {
    existing.successCount += 1;
  } else {
    existing.failureCount += 1;
  }
  existing.totalLatencyMs += latencyMs;
  existing.lastExecutionAt = new Date().toISOString();
  toolMetricsMap.set(toolName, existing);
}

export function getToolMetrics(): Record<
  string,
  ToolMetrics & { avgLatencyMs: number; successRate: number }
> {
  const result: Record<
    string,
    ToolMetrics & { avgLatencyMs: number; successRate: number }
  > = {};

  for (const [name, m] of toolMetricsMap.entries()) {
    result[name] = {
      ...m,
      avgLatencyMs:
        m.executionCount > 0
          ? Math.round(m.totalLatencyMs / m.executionCount)
          : 0,
      successRate:
        m.executionCount > 0
          ? Math.round((m.successCount / m.executionCount) * 10000) / 100
          : 0,
    };
  }

  return result;
}

export function resetToolMetrics(): void {
  toolMetricsMap.clear();
}

export async function flushMetricsToDb(): Promise<void> {
  if (toolMetricsMap.size === 0) return;
  try {
    const snapshot = getToolMetrics();
    await db.insert(auditEvents).values({
      eventType: "metrics.flush",
      entityType: "system",
      actor: "system",
      details: snapshot,
    });
    logger.debug({ toolCount: Object.keys(snapshot).length }, "Flushed tool metrics to DB");
  } catch (err) {
    logger.warn({ err }, "Failed to flush metrics to DB");
  }
}

export function startPeriodicFlush(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushMetricsToDb().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

export function stopPeriodicFlush(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
