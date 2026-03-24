import { db } from "@workspace/db";
import { runs, runEvents, toolCalls, executions } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logOperation } from "../lib/structured-log";

export async function createRun(data: {
  runId: string;
  conversationId: number;
  model: string;
  mode?: string;
  status?: string;
}) {
  const [row] = await db
    .insert(runs)
    .values({
      runId: data.runId,
      conversationId: data.conversationId,
      model: data.model,
      mode: data.mode || "agent",
      status: data.status || "running",
    })
    .returning();
  logOperation({ operation: "run.created", runId: data.runId, conversationId: data.conversationId, status: "running" });
  return { id: row.id, runId: row.runId };
}

export async function updateRun(
  runId: string,
  data: {
    status?: string;
    tokensIn?: number;
    tokensOut?: number;
    errorMessage?: string;
  },
) {
  const updates: Record<string, unknown> = {};
  if (data.status) updates.status = data.status;
  if (data.tokensIn !== undefined) updates.tokensIn = data.tokensIn;
  if (data.tokensOut !== undefined) updates.tokensOut = data.tokensOut;
  if (data.errorMessage !== undefined) updates.errorMessage = data.errorMessage;
  if (data.status === "completed" || data.status === "failed") {
    updates.completedAt = new Date();
  }
  await db.update(runs).set(updates).where(eq(runs.runId, runId));
  if (data.status) {
    logOperation({ operation: "run.updated", runId, status: data.status });
  }
}

export async function createToolCall(data: {
  runId?: number;
  serverId?: number;
  toolName: string;
  arguments?: Record<string, unknown>;
  status?: string;
  requiresApproval?: boolean;
}) {
  const [row] = await db
    .insert(toolCalls)
    .values({
      runId: data.runId || null,
      serverId: data.serverId || null,
      toolName: data.toolName,
      arguments: data.arguments || {},
      status: data.status || "pending",
      requiresApproval: data.requiresApproval || false,
    })
    .returning();
  return { id: row.id };
}

export async function updateToolCall(
  id: number,
  data: {
    status?: string;
    result?: unknown;
    resultSummary?: string;
    errorMessage?: string;
    approvalDecision?: string;
    durationMs?: number;
  },
) {
  const updates: Record<string, unknown> = {};
  if (data.status) updates.status = data.status;
  if (data.result !== undefined) updates.result = data.result;
  if (data.resultSummary !== undefined) updates.resultSummary = data.resultSummary;
  if (data.errorMessage !== undefined) updates.errorMessage = data.errorMessage;
  if (data.approvalDecision !== undefined) updates.approvalDecision = data.approvalDecision;
  if (data.durationMs !== undefined) updates.durationMs = data.durationMs;
  if (data.status === "success" || data.status === "error") {
    updates.completedAt = new Date();
  }
  await db.update(toolCalls).set(updates).where(eq(toolCalls.id, id));
}

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

export async function createExecution(data: {
  conversationId: number;
  serverId?: number;
  toolName: string;
  status: string;
  arguments?: Record<string, unknown>;
  resultSummary?: string;
  rawResult?: Record<string, unknown>;
  errorMessage?: string;
  durationMs?: number;
}) {
  const [row] = await db
    .insert(executions)
    .values({
      conversationId: data.conversationId,
      serverId: data.serverId || null,
      toolName: data.toolName,
      status: data.status,
      arguments: data.arguments || {},
      resultSummary: data.resultSummary || null,
      rawResult: data.rawResult || null,
      errorMessage: data.errorMessage || null,
      durationMs: data.durationMs || 0,
      completedAt: data.status === "success" || data.status === "error" ? new Date() : null,
    })
    .returning();
  return { id: row.id };
}

export async function updateExecution(
  id: number,
  data: {
    status?: string;
    resultSummary?: string;
    rawResult?: Record<string, unknown>;
    errorMessage?: string;
    durationMs?: number;
  },
) {
  const updates: Record<string, unknown> = {};
  if (data.status) updates.status = data.status;
  if (data.resultSummary !== undefined) updates.resultSummary = data.resultSummary;
  if (data.rawResult !== undefined) updates.rawResult = data.rawResult;
  if (data.errorMessage !== undefined) updates.errorMessage = data.errorMessage;
  if (data.durationMs !== undefined) updates.durationMs = data.durationMs;
  if (data.status === "success" || data.status === "error") {
    updates.completedAt = new Date();
  }
  await db.update(executions).set(updates).where(eq(executions.id, id));
}

export async function createRunEvent(data: {
  runId: number;
  eventType: string;
  data?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(runEvents)
    .values({
      runId: data.runId,
      eventType: data.eventType,
      data: data.data || null,
    })
    .returning();
  return { id: row.id };
}
