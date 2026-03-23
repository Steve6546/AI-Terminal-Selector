import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { databaseConnections } from "@workspace/db";
import { eq } from "drizzle-orm";
import { maskSecret, unmaskSecret } from "../lib/secret-utils";
import { handleRouteError } from "../lib/handle-error";

const router: IRouter = Router();

router.get("/database-connections", async (req, res) => {
  try {
    const rows = await db.select().from(databaseConnections).orderBy(databaseConnections.createdAt);
    const result = rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      host: r.host,
      port: r.port,
      username: r.username,
      database: r.database,
      ssl: r.ssl,
      status: r.status,
      lastTestedAt: r.lastTestedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list database connections");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/database-connections", async (req, res) => {
  try {
    const body = req.body as {
      name: string;
      type: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      database: string;
      ssl?: boolean;
    };

    if (!body.name || !body.database) {
      res.status(400).json({ error: "name and database are required" });
      return;
    }

    const encryptedPassword = body.password ? maskSecret(body.password) : null;

    const [inserted] = await db
      .insert(databaseConnections)
      .values({
        name: body.name,
        type: body.type ?? "postgresql",
        host: body.host ?? null,
        port: body.port ?? null,
        username: body.username ?? null,
        encryptedPassword,
        database: body.database,
        ssl: body.ssl ?? false,
        status: "disconnected",
      })
      .returning();

    res.status(201).json({
      id: inserted.id,
      name: inserted.name,
      type: inserted.type,
      host: inserted.host,
      port: inserted.port,
      username: inserted.username,
      database: inserted.database,
      ssl: inserted.ssl,
      status: inserted.status,
      lastTestedAt: null,
      createdAt: inserted.createdAt.toISOString(),
      updatedAt: inserted.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create database connection");
    handleRouteError(res, err, "Internal server error");
  }
});

router.patch("/database-connections/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body as {
      name?: string;
      type?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      database?: string;
      ssl?: boolean;
    };

    const existing = await db.select().from(databaseConnections).where(eq(databaseConnections.id, id));
    if (existing.length === 0) {
      res.status(404).json({ error: "Database connection not found" });
      return;
    }

    const updateData: Partial<typeof databaseConnections.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.host !== undefined) updateData.host = body.host;
    if (body.port !== undefined) updateData.port = body.port;
    if (body.username !== undefined) updateData.username = body.username;
    if (body.password !== undefined) updateData.encryptedPassword = maskSecret(body.password);
    if (body.database !== undefined) updateData.database = body.database;
    if (body.ssl !== undefined) updateData.ssl = body.ssl;

    const [updated] = await db
      .update(databaseConnections)
      .set(updateData)
      .where(eq(databaseConnections.id, id))
      .returning();

    res.json({
      id: updated.id,
      name: updated.name,
      type: updated.type,
      host: updated.host,
      port: updated.port,
      username: updated.username,
      database: updated.database,
      ssl: updated.ssl,
      status: updated.status,
      lastTestedAt: updated.lastTestedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update database connection");
    handleRouteError(res, err, "Internal server error");
  }
});

router.delete("/database-connections/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db.select().from(databaseConnections).where(eq(databaseConnections.id, id));
    if (existing.length === 0) {
      res.status(404).json({ error: "Database connection not found" });
      return;
    }
    await db.delete(databaseConnections).where(eq(databaseConnections.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete database connection");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/database-connections/:id/test", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [conn] = await db.select().from(databaseConnections).where(eq(databaseConnections.id, id));
    if (!conn) {
      res.status(404).json({ error: "Database connection not found" });
      return;
    }

    const start = Date.now();
    let testResult: { success: boolean; message: string; latencyMs?: number };

    if (conn.type === "postgresql") {
      try {
        const { Client } = await import("pg");
        const password = conn.encryptedPassword ? unmaskSecret(conn.encryptedPassword) : undefined;
        const client = new Client({
          host: conn.host ?? "localhost",
          port: conn.port ?? 5432,
          user: conn.username ?? undefined,
          password: password ?? undefined,
          database: conn.database,
          ssl: conn.ssl ? { rejectUnauthorized: true } : false,
          connectionTimeoutMillis: 5000,
        });
        await client.connect();
        await client.query("SELECT 1");
        await client.end();
        const latencyMs = Date.now() - start;
        testResult = { success: true, message: "Connection successful", latencyMs };
      } catch (e) {
        testResult = { success: false, message: (e as Error).message };
      }
    } else if (conn.type === "mysql") {
      try {
        const mysql2 = await import("mysql2/promise");
        const password = conn.encryptedPassword ? unmaskSecret(conn.encryptedPassword) : undefined;
        const connection = await mysql2.createConnection({
          host: conn.host ?? "localhost",
          port: conn.port ?? 3306,
          user: conn.username ?? undefined,
          password: password ?? undefined,
          database: conn.database,
          ssl: conn.ssl ? {} : undefined,
          connectTimeout: 5000,
        });
        await connection.query("SELECT 1");
        await connection.end();
        const latencyMs = Date.now() - start;
        testResult = { success: true, message: "Connection successful", latencyMs };
      } catch (e) {
        testResult = { success: false, message: (e as Error).message };
      }
    } else if (conn.type === "sqlite") {
      try {
        const { existsSync } = await import("node:fs");
        if (!existsSync(conn.database)) {
          testResult = { success: false, message: `SQLite file not found: ${conn.database}` };
        } else {
          const latencyMs = Date.now() - start;
          testResult = { success: true, message: "SQLite file accessible", latencyMs };
        }
      } catch (e) {
        testResult = { success: false, message: (e as Error).message };
      }
    } else {
      testResult = { success: false, message: `Unknown connection type: ${conn.type}` };
    }

    const newStatus = testResult.success ? "connected" : "error";
    await db
      .update(databaseConnections)
      .set({ status: newStatus, lastTestedAt: new Date(), updatedAt: new Date() })
      .where(eq(databaseConnections.id, id));

    res.json(testResult);
  } catch (err) {
    req.log.error({ err }, "Failed to test database connection");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
