import { db } from "@workspace/db";
import { approvalDecisions } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

export async function createApproval(data: {
  runId?: number;
  toolCallId?: number;
  toolName: string;
  serverName?: string;
  inputs?: Record<string, unknown>;
  decision: string;
  reason?: string;
}) {
  const [row] = await db
    .insert(approvalDecisions)
    .values({
      runId: data.runId || null,
      toolCallId: data.toolCallId || null,
      toolName: data.toolName,
      serverName: data.serverName || null,
      inputs: data.inputs || {},
      decision: data.decision,
      actor: "user",
      reason: data.reason || null,
    })
    .returning();
  return { id: row.id };
}

export async function listApprovals(runId?: number, limit = 20) {
  const rows = runId
    ? await db.select().from(approvalDecisions).where(eq(approvalDecisions.runId, runId)).orderBy(desc(approvalDecisions.decidedAt)).limit(limit)
    : await db.select().from(approvalDecisions).orderBy(desc(approvalDecisions.decidedAt)).limit(limit);

  return rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    toolCallId: r.toolCallId,
    toolName: r.toolName,
    serverName: r.serverName,
    decision: r.decision,
    actor: r.actor,
    reason: r.reason,
    decidedAt: r.decidedAt?.toISOString() ?? null,
  }));
}
