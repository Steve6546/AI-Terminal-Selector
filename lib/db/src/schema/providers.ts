import { pgTable, serial, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const providerSettings = pgTable("provider_settings", {
  id: serial("id").primaryKey(),
  providerName: text("provider_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  apiEndpoint: text("api_endpoint"),
  encryptedApiKey: text("encrypted_api_key"),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const modelRouting = pgTable("model_routing", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id")
    .notNull()
    .references(() => providerSettings.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull(),
  displayName: text("display_name").notNull(),
  taskType: text("task_type").notNull().default("general"),
  priority: integer("priority").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertProviderSettingSchema = createInsertSchema(providerSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertModelRoutingSchema = createInsertSchema(modelRouting).omit({
  id: true,
  createdAt: true,
});

export type ProviderSetting = typeof providerSettings.$inferSelect;
export type InsertProviderSetting = z.infer<typeof insertProviderSettingSchema>;
export type ModelRouting = typeof modelRouting.$inferSelect;
export type InsertModelRouting = z.infer<typeof insertModelRoutingSchema>;
