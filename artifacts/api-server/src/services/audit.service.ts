import { db } from "@workspace/db";
import { auditEvents } from "@workspace/db";
import { logger } from "../lib/logger";

export interface AuditEntry {
  eventType: string;
  entityType?: string;
  entityId?: number;
  actor?: string;
  details?: Record<string, unknown>;
  traceId?: string;
}

export async function writeAuditEvent(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      eventType: entry.eventType,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      actor: entry.actor ?? "system",
      details: entry.details ?? null,
      traceId: entry.traceId ?? null,
    });
  } catch (err) {
    logger.warn({ err, eventType: entry.eventType }, "Failed to write audit event");
  }
}
