import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { runs } from "./runs";

export const approvalDecisions = pgTable("approval_decisions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .references(() => runs.id, { onDelete: "set null" }),
  toolCallId: integer("tool_call_id"),
  toolName: text("tool_name").notNull(),
  serverName: text("server_name"),
  inputs: jsonb("inputs").$type<Record<string, unknown>>(),
  decision: text("decision").notNull(),
  actor: text("actor").notNull().default("user"),
  reason: text("reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  timeoutAt: timestamp("timeout_at", { withTimezone: true }),
});

export const insertApprovalDecisionSchema = createInsertSchema(approvalDecisions).omit({
  id: true,
  decidedAt: true,
});

export type ApprovalDecision = typeof approvalDecisions.$inferSelect;
export type InsertApprovalDecision = z.infer<typeof insertApprovalDecisionSchema>;
