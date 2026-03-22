import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { conversations } from "./conversations";
import { mcpServers } from "./mcp-servers";

export const executions = pgTable("executions", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .references(() => conversations.id, { onDelete: "set null" }),
  serverId: integer("server_id")
    .references(() => mcpServers.id, { onDelete: "set null" }),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull().default("pending"),
  arguments: jsonb("arguments"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  resultSummary: text("result_summary"),
  rawResult: jsonb("raw_result"),
  errorMessage: text("error_message"),
});

export const executionLogs = pgTable("execution_logs", {
  id: serial("id").primaryKey(),
  executionId: integer("execution_id")
    .notNull()
    .references(() => executions.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("info"),
  eventType: text("event_type"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertExecutionSchema = createInsertSchema(executions).omit({
  id: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
});

export type Execution = typeof executions.$inferSelect;
export type InsertExecution = z.infer<typeof insertExecutionSchema>;
export type ExecutionLog = typeof executionLogs.$inferSelect;
