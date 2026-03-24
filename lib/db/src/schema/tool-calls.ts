import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { runs } from "./runs";
import { mcpServers } from "./mcp-servers";

export const toolCalls = pgTable("tool_calls", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .references(() => runs.id, { onDelete: "set null" }),
  serverId: integer("server_id")
    .references(() => mcpServers.id, { onDelete: "set null" }),
  toolName: text("tool_name").notNull(),
  arguments: jsonb("arguments").$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  resultSummary: text("result_summary"),
  status: text("status").notNull().default("pending"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approvalDecision: text("approval_decision"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertToolCallSchema = createInsertSchema(toolCalls).omit({
  id: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
});

export type ToolCall = typeof toolCalls.$inferSelect;
export type InsertToolCall = z.infer<typeof insertToolCallSchema>;
