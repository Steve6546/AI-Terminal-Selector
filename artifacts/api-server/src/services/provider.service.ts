import { db } from "@workspace/db";
import { mcpTools, mcpServers } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { unmaskSecret } from "../lib/secret-utils";
import { checkEndpointAllowed } from "../lib/domain-allowlist";

const AGENT_BACKEND_URL = `http://localhost:${process.env.AGENT_BACKEND_PORT ?? "9000"}`;

export async function buildToolDefinitions(serverIds?: number[]) {
  const baseConditions = and(
    eq(mcpTools.enabled, true),
    eq(mcpServers.enabled, true),
    eq(mcpServers.status, "connected"),
  );
  const toolRows = await db
    .select({
      id: mcpTools.id,
      serverId: mcpTools.serverId,
      toolName: mcpTools.toolName,
      description: mcpTools.description,
      inputSchema: mcpTools.inputSchema,
      requiresApproval: mcpTools.requiresApproval,
    })
    .from(mcpTools)
    .innerJoin(mcpServers, eq(mcpTools.serverId, mcpServers.id))
    .where(
      serverIds?.length
        ? and(baseConditions, inArray(mcpTools.serverId, serverIds))
        : baseConditions,
    );

  return toolRows.map((t) => ({
    name: `${t.serverId}__${t.toolName}`,
    description: t.description ?? t.toolName,
    input_schema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    _toolId: t.id,
    _serverId: t.serverId,
    requires_approval: t.requiresApproval ?? false,
  }));
}

export async function buildServerInfos() {
  const servers = await db.select().from(mcpServers).where(eq(mcpServers.enabled, true));

  const result = [];
  for (const s of servers) {
    const allowCheck = await checkEndpointAllowed(s.endpoint, s.transportType);
    if (!allowCheck.allowed) continue;
    result.push({
      id: s.id,
      name: s.name,
      transport_type: s.transportType,
      endpoint: s.endpoint,
      command: s.command,
      args: (s.args as string[]) ?? [],
      auth_type: s.authType,
      auth_secret: unmaskSecret(s.encryptedSecret),
      timeout: s.timeout,
      retry_count: s.retryCount,
    });
  }
  return result;
}

export async function forwardApproval(runId: string, toolId: string, approved: boolean, traceId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (traceId) headers["X-Trace-Id"] = traceId;
  const agentResp = await fetch(`${AGENT_BACKEND_URL}/agent/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ run_id: runId, tool_id: toolId, approved: !!approved }),
  });

  if (agentResp.ok) {
    return { ok: true };
  }

  const body = await agentResp.text().catch(() => "");
  return { error: body || "Approval failed", status: agentResp.status };
}

export function getAgentBackendUrl(): string {
  return AGENT_BACKEND_URL;
}
