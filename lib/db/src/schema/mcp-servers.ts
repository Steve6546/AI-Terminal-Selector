import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mcpServers = pgTable("mcp_servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  transportType: text("transport_type").notNull().default("streamable-http"),
  endpoint: text("endpoint"),
  command: text("command"),
  args: jsonb("args").$type<string[]>().default([]),
  authType: text("auth_type").notNull().default("none"),
  encryptedSecret: text("encrypted_secret"),
  timeout: integer("timeout").notNull().default(30),
  retryCount: integer("retry_count").notNull().default(3),
  status: text("status").notNull().default("disconnected"),
  enabled: boolean("enabled").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mcpTools = pgTable("mcp_tools", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id")
    .notNull()
    .references(() => mcpServers.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  description: text("description"),
  inputSchema: jsonb("input_schema"),
  outputSchema: jsonb("output_schema"),
  enabled: boolean("enabled").notNull().default(true),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mcpResources = pgTable("mcp_resources", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id")
    .notNull()
    .references(() => mcpServers.id, { onDelete: "cascade" }),
  resourceName: text("resource_name").notNull(),
  description: text("description"),
  resourceType: text("resource_type"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertMcpServerSchema = createInsertSchema(mcpServers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastCheckedAt: true,
});

export const insertMcpToolSchema = createInsertSchema(mcpTools).omit({
  id: true,
  createdAt: true,
});

export type McpServer = typeof mcpServers.$inferSelect;
export type InsertMcpServer = z.infer<typeof insertMcpServerSchema>;
export type McpTool = typeof mcpTools.$inferSelect;
export type InsertMcpTool = z.infer<typeof insertMcpToolSchema>;
export type McpResource = typeof mcpResources.$inferSelect;
