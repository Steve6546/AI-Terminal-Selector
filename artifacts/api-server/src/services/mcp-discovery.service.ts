import { db } from "@workspace/db";
import { mcpServers, mcpTools, mcpResources, mcpPrompts } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { testMcpConnection, discoverMcpCapabilities } from "../lib/mcp-gateway";
import { maskSecret, unmaskSecret } from "../lib/secret-utils";
import { checkEndpointAllowed } from "../lib/domain-allowlist";

function buildServerConfig(server: typeof mcpServers.$inferSelect) {
  return {
    transportType: server.transportType,
    endpoint: server.endpoint,
    command: server.command,
    args: (server.args as string[] | null) ?? [],
    authType: server.authType,
    authSecret: unmaskSecret(server.encryptedSecret),
    timeout: server.timeout ?? 30,
    retryCount: server.retryCount ?? 0,
  };
}

function formatServer(s: typeof mcpServers.$inferSelect, toolCount: number) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    transportType: s.transportType,
    endpoint: s.endpoint,
    command: s.command,
    args: s.args,
    authType: s.authType,
    status: s.status,
    enabled: s.enabled,
    timeout: s.timeout,
    retryCount: s.retryCount,
    toolCount,
    lastCheckedAt: s.lastCheckedAt?.toISOString(),
    createdAt: s.createdAt.toISOString(),
  };
}

export async function listServers() {
  const rows = await db
    .select({
      id: mcpServers.id,
      name: mcpServers.name,
      description: mcpServers.description,
      transportType: mcpServers.transportType,
      endpoint: mcpServers.endpoint,
      command: mcpServers.command,
      args: mcpServers.args,
      authType: mcpServers.authType,
      status: mcpServers.status,
      enabled: mcpServers.enabled,
      timeout: mcpServers.timeout,
      retryCount: mcpServers.retryCount,
      lastCheckedAt: mcpServers.lastCheckedAt,
      createdAt: mcpServers.createdAt,
      toolCount: count(mcpTools.id),
    })
    .from(mcpServers)
    .leftJoin(mcpTools, eq(mcpTools.serverId, mcpServers.id))
    .groupBy(mcpServers.id);

  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    transportType: s.transportType,
    endpoint: s.endpoint,
    command: s.command,
    args: s.args,
    authType: s.authType,
    timeout: s.timeout,
    retryCount: s.retryCount,
    status: s.status,
    enabled: s.enabled,
    toolCount: Number(s.toolCount),
    lastCheckedAt: s.lastCheckedAt?.toISOString(),
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function createServer(body: {
  name: string;
  description?: string;
  transportType: string;
  endpoint?: string;
  command?: string;
  args?: string[];
  authType?: string;
  authSecret?: string;
  timeout?: number;
  retryCount?: number;
  enabled?: boolean;
}) {
  const allowCheck = await checkEndpointAllowed(body.endpoint, body.transportType);
  if (!allowCheck.allowed) {
    return { error: allowCheck.reason ?? "Endpoint not allowed by domain allowlist" };
  }

  const [server] = await db
    .insert(mcpServers)
    .values({
      name: body.name,
      description: body.description,
      transportType: body.transportType,
      endpoint: body.endpoint,
      command: body.command,
      args: body.args ?? [],
      authType: body.authType ?? "none",
      encryptedSecret: maskSecret(body.authSecret),
      timeout: body.timeout ?? 30,
      retryCount: body.retryCount ?? 3,
      enabled: body.enabled ?? true,
      status: "disconnected",
    })
    .returning();

  return { server: formatServer(server, 0) };
}

export async function getServer(id: number) {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
  if (!server) return null;

  const toolCountResult = await db.select({ count: count() }).from(mcpTools).where(eq(mcpTools.serverId, id));
  return formatServer(server, Number(toolCountResult[0]?.count ?? 0));
}

export async function updateServer(
  id: number,
  body: {
    name?: string;
    description?: string;
    transportType?: string;
    endpoint?: string;
    command?: string;
    args?: string[];
    authType?: string;
    authSecret?: string;
    timeout?: number;
    retryCount?: number;
    enabled?: boolean;
  },
) {
  const [existing] = await db
    .select({ endpoint: mcpServers.endpoint, transportType: mcpServers.transportType })
    .from(mcpServers)
    .where(eq(mcpServers.id, id));

  if (!existing) return { notFound: true };

  const effectiveEndpoint = body.endpoint !== undefined ? body.endpoint : existing.endpoint;
  const effectiveTransportType = body.transportType !== undefined ? body.transportType : existing.transportType;

  const allowCheck = await checkEndpointAllowed(effectiveEndpoint, effectiveTransportType);
  if (!allowCheck.allowed) {
    return { error: allowCheck.reason ?? "Endpoint not allowed by domain allowlist" };
  }

  const updateData: Partial<typeof mcpServers.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.transportType !== undefined) updateData.transportType = body.transportType;
  if (body.endpoint !== undefined) updateData.endpoint = body.endpoint;
  if (body.command !== undefined) updateData.command = body.command;
  if (body.args !== undefined) updateData.args = body.args;
  if (body.authType !== undefined) updateData.authType = body.authType;
  if (body.authSecret !== undefined) updateData.encryptedSecret = maskSecret(body.authSecret);
  if (body.timeout !== undefined) updateData.timeout = body.timeout;
  if (body.retryCount !== undefined) updateData.retryCount = body.retryCount;
  if (body.enabled !== undefined) updateData.enabled = body.enabled;

  const [updated] = await db.update(mcpServers).set(updateData).where(eq(mcpServers.id, id)).returning();
  if (!updated) return { notFound: true };

  const toolCountResult = await db.select({ count: count() }).from(mcpTools).where(eq(mcpTools.serverId, id));
  return { server: formatServer(updated, Number(toolCountResult[0]?.count ?? 0)) };
}

export async function deleteServer(id: number): Promise<boolean> {
  const deleted = await db.delete(mcpServers).where(eq(mcpServers.id, id)).returning();
  return deleted.length > 0;
}

export async function testServer(id: number) {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
  if (!server) return { notFound: true };

  const allowCheck = await checkEndpointAllowed(server.endpoint, server.transportType);
  if (!allowCheck.allowed) {
    return { error: allowCheck.reason ?? "Endpoint not allowed by domain allowlist" };
  }

  await db.update(mcpServers).set({ status: "checking", lastCheckedAt: new Date() }).where(eq(mcpServers.id, id));

  let result;
  try {
    result = await testMcpConnection(buildServerConfig(server));
  } catch (err) {
    await db.update(mcpServers).set({ status: "error", lastCheckedAt: new Date() }).where(eq(mcpServers.id, id));
    throw err;
  }

  await db
    .update(mcpServers)
    .set({ status: result.success ? "connected" : "error", lastCheckedAt: new Date() })
    .where(eq(mcpServers.id, id));

  const toolCountResult = await db.select({ count: count() }).from(mcpTools).where(eq(mcpTools.serverId, id));

  return {
    result: {
      success: result.success,
      message: result.message,
      toolCount: Number(toolCountResult[0]?.count ?? 0),
      latencyMs: result.latencyMs,
    },
  };
}

export async function discoverServer(id: number) {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
  if (!server) return { notFound: true };

  const allowCheck = await checkEndpointAllowed(server.endpoint, server.transportType);
  if (!allowCheck.allowed) {
    return { error: allowCheck.reason ?? "Endpoint not allowed by domain allowlist" };
  }

  await db.update(mcpServers).set({ status: "checking", lastCheckedAt: new Date() }).where(eq(mcpServers.id, id));

  let discovered;
  try {
    discovered = await discoverMcpCapabilities(buildServerConfig(server));
  } catch (err) {
    await db.update(mcpServers).set({ status: "error", lastCheckedAt: new Date() }).where(eq(mcpServers.id, id));
    throw err;
  }

  await db.delete(mcpTools).where(eq(mcpTools.serverId, id));
  await db.delete(mcpResources).where(eq(mcpResources.serverId, id));
  await db.delete(mcpPrompts).where(eq(mcpPrompts.serverId, id));

  let insertedTools: (typeof mcpTools.$inferSelect)[] = [];
  if (discovered.tools.length > 0) {
    insertedTools = await db
      .insert(mcpTools)
      .values(
        discovered.tools.map((t) => ({
          serverId: id,
          toolName: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | null,
          outputSchema: null,
          enabled: true,
          requiresApproval: false,
        })),
      )
      .returning();
  }

  if (discovered.resources.length > 0) {
    await db.insert(mcpResources).values(
      discovered.resources.map((r) => ({
        serverId: id,
        resourceName: r.name,
        description: r.description,
        resourceType: r.mimeType ?? "unknown",
        metadata: { uri: r.uri } as Record<string, unknown>,
      })),
    );
  }

  if (discovered.prompts.length > 0) {
    await db.insert(mcpPrompts).values(
      discovered.prompts.map((p) => ({
        serverId: id,
        promptName: p.name,
        description: p.description,
      })),
    );
  }

  await db.update(mcpServers).set({ status: "connected", lastCheckedAt: new Date() }).where(eq(mcpServers.id, id));

  return {
    tools: insertedTools.map((t) => ({
      id: t.id,
      serverId: t.serverId,
      serverName: server.name,
      toolName: t.toolName,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      enabled: t.enabled,
      requiresApproval: t.requiresApproval,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export async function getServerTools(id: number) {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
  if (!server) return null;

  const tools = await db.select().from(mcpTools).where(eq(mcpTools.serverId, id));

  return tools.map((t) => ({
    id: t.id,
    serverId: t.serverId,
    serverName: server.name,
    toolName: t.toolName,
    description: t.description,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    enabled: t.enabled,
    requiresApproval: t.requiresApproval,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function getServerPrompts(id: number) {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
  if (!server) return null;

  const prompts = await db.select().from(mcpPrompts).where(eq(mcpPrompts.serverId, id));
  return prompts.map((p) => ({
    id: p.id,
    serverId: p.serverId,
    promptName: p.promptName,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function getServerResources(id: number) {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
  if (!server) return null;

  const resources = await db.select().from(mcpResources).where(eq(mcpResources.serverId, id));
  return resources.map((r) => ({
    id: r.id,
    serverId: r.serverId,
    resourceName: r.resourceName,
    description: r.description,
    resourceType: r.resourceType,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function updateTool(
  toolId: number,
  data: { enabled?: boolean; requiresApproval?: boolean },
) {
  const updateData: Partial<typeof mcpTools.$inferInsert> = {};
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.requiresApproval !== undefined) updateData.requiresApproval = data.requiresApproval;

  const [updated] = await db.update(mcpTools).set(updateData).where(eq(mcpTools.id, toolId)).returning();
  if (!updated) return null;

  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, updated.serverId));

  return {
    id: updated.id,
    serverId: updated.serverId,
    serverName: server?.name ?? "",
    toolName: updated.toolName,
    description: updated.description,
    inputSchema: updated.inputSchema,
    outputSchema: updated.outputSchema,
    enabled: updated.enabled,
    requiresApproval: updated.requiresApproval,
    createdAt: updated.createdAt.toISOString(),
  };
}
