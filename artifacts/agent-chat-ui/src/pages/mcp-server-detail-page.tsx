import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetMcpServer,
  useTestMcpServerConnection,
  useDiscoverMcpTools,
  useListMcpTools,
  useListMcpPrompts,
  useListMcpResources,
  useUpdateMcpTool,
  getGetMcpServerQueryKey,
  getListMcpToolsQueryKey,
  getListMcpPromptsQueryKey,
  getListMcpResourcesQueryKey,
} from "@workspace/api-client-react";
import type { McpServer } from "@workspace/api-client-react";
import { useMcpHealth } from "@/hooks/use-mcp-health";
import { useQueryClient } from "@tanstack/react-query";
import { PageLoader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, RefreshCw, Zap, Wrench, FileText, MessageSquare,
  Shield, ShieldAlert, ShieldCheck, ShieldX,
  Clock, CheckCircle2, XCircle, Loader2, AlertTriangle,
  Lock, Globe, ToggleLeft, ToggleRight,
} from "lucide-react";

type RiskLevel = "low" | "medium" | "high";

function getToolRisk(tool: { requiresApproval: boolean; toolName: string }): RiskLevel {
  if (tool.requiresApproval) return "high";
  const name = tool.toolName.toLowerCase();
  const highRiskPatterns = ["delete", "remove", "drop", "exec", "run", "write", "create", "update", "send", "deploy"];
  const mediumRiskPatterns = ["modify", "edit", "set", "put", "patch", "move", "copy"];
  if (highRiskPatterns.some((p) => name.includes(p))) return "high";
  if (mediumRiskPatterns.some((p) => name.includes(p))) return "medium";
  return "low";
}

function RiskBadge({ level }: { level: RiskLevel }) {
  if (level === "high") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">
        <ShieldAlert className="w-3 h-3" /> HIGH
      </span>
    );
  }
  if (level === "medium") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
        <Shield className="w-3 h-3" /> MED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">
      <ShieldCheck className="w-3 h-3" /> LOW
    </span>
  );
}

function StatusBadge({ status, latencyMs }: { status: string; latencyMs?: number | null }) {
  const configs: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    connected: { color: "text-green-400 bg-green-500/10 border-green-500/20", icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "CONNECTED" },
    degraded: { color: "text-orange-400 bg-orange-500/10 border-orange-500/20", icon: <AlertTriangle className="w-3.5 h-3.5" />, label: "DEGRADED" },
    auth_required: { color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", icon: <Lock className="w-3.5 h-3.5" />, label: "AUTH REQUIRED" },
    disconnected: { color: "text-red-400 bg-red-500/10 border-red-500/20", icon: <XCircle className="w-3.5 h-3.5" />, label: "DISCONNECTED" },
    error: { color: "text-red-400 bg-red-500/10 border-red-500/20", icon: <ShieldX className="w-3.5 h-3.5" />, label: "ERROR" },
    checking: { color: "text-blue-400 bg-blue-500/10 border-blue-500/20", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, label: "CHECKING" },
  };
  const c = configs[status] ?? configs.error!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg border", c.color)}>
      {c.icon} {c.label}
      {latencyMs != null && status === "connected" && <span className="text-muted-foreground">· {latencyMs}ms</span>}
    </span>
  );
}

function InfoBadge({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 rounded-xl border border-white/5">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-xs text-white font-medium">{value}</p>
      </div>
    </div>
  );
}

function ToolRow({ tool, onToggleApproval }: {
  tool: { id: number; toolName: string; description?: string | null; requiresApproval: boolean; enabled: boolean };
  onToggleApproval: (id: number, val: boolean) => void;
}) {
  const risk = getToolRisk(tool);
  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-white/[0.02] rounded-lg group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-sm text-white font-mono">{tool.toolName}</code>
          <RiskBadge level={risk} />
        </div>
        {tool.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{tool.description}</p>
        )}
      </div>
      <button
        onClick={() => onToggleApproval(tool.id, !tool.requiresApproval)}
        className={cn(
          "flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg transition-colors ml-3",
          tool.requiresApproval
            ? "text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20"
            : "text-muted-foreground hover:text-white hover:bg-white/5"
        )}
        title={tool.requiresApproval ? "Approval required — click to disable" : "No approval needed — click to require"}
      >
        {tool.requiresApproval ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
        {tool.requiresApproval ? "Approval ON" : "Approval OFF"}
      </button>
    </div>
  );
}

function RiskSummaryInline({ tools }: { tools: Array<{ requiresApproval: boolean; toolName: string }> }) {
  if (tools.length === 0) return null;
  const counts = { high: 0, medium: 0, low: 0 };
  tools.forEach((t) => { counts[getToolRisk(t)]++; });
  return (
    <span className="flex items-center gap-1.5 text-[10px]">
      {counts.high > 0 && <span className="text-red-400">{counts.high}H</span>}
      {counts.medium > 0 && <span className="text-yellow-400">{counts.medium}M</span>}
      {counts.low > 0 && <span className="text-green-400">{counts.low}L</span>}
    </span>
  );
}

export { getToolRisk, RiskBadge, RiskSummaryInline };

export default function McpServerDetailPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const serverId = params?.id ? parseInt(params.id) : 0;
  const queryClient = useQueryClient();
  const { getLiveStatus } = useMcpHealth();

  const { data: server, isLoading } = useGetMcpServer(serverId, { query: { enabled: serverId > 0 } });
  const { data: tools } = useListMcpTools(serverId, { query: { enabled: serverId > 0 } });
  const { data: prompts } = useListMcpPrompts(serverId, { query: { enabled: serverId > 0 } });
  const { data: resources } = useListMcpResources(serverId, { query: { enabled: serverId > 0 } });

  const testMutation = useTestMcpServerConnection();
  const discoverMutation = useDiscoverMcpTools();
  const updateToolMutation = useUpdateMcpTool();

  const [activeTab, setActiveTab] = useState<"tools" | "resources" | "prompts">("tools");

  if (isLoading) return <PageLoader />;
  if (!server) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">Server not found</h2>
          <button onClick={() => setLocation("/servers")} className="text-primary hover:underline text-sm">
            Back to servers
          </button>
        </div>
      </div>
    );
  }

  const liveHealth = getLiveStatus(server.id);
  const displayStatus = liveHealth?.status ?? server.status;
  const displayLatency = liveHealth?.latencyMs ?? (server as McpServer & { latencyMs?: number }).latencyMs;

  const handleTest = () => {
    testMutation.mutate({ id: serverId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMcpServerQueryKey(serverId) });
        queryClient.invalidateQueries({ queryKey: getListMcpToolsQueryKey(serverId) });
      },
    });
  };

  const handleDiscover = () => {
    discoverMutation.mutate({ id: serverId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMcpServerQueryKey(serverId) });
        queryClient.invalidateQueries({ queryKey: getListMcpToolsQueryKey(serverId) });
        queryClient.invalidateQueries({ queryKey: getListMcpPromptsQueryKey(serverId) });
        queryClient.invalidateQueries({ queryKey: getListMcpResourcesQueryKey(serverId) });
      },
    });
  };

  const handleToggleApproval = (toolId: number, requiresApproval: boolean) => {
    updateToolMutation.mutate(
      { toolId, data: { requiresApproval } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMcpToolsQueryKey(serverId) }) },
    );
  };

  const toolsArr = tools ?? [];
  const promptsArr = prompts ?? [];
  const resourcesArr = resources ?? [];
  const approvalCount = toolsArr.filter((t) => t.requiresApproval).length;
  const riskCounts = { high: 0, medium: 0, low: 0 };
  toolsArr.forEach((t) => { riskCounts[getToolRisk(t)]++; });

  const lastChecked = (server as McpServer & { lastCheckedAt?: string }).lastCheckedAt;
  const lastSuccess = (server as McpServer & { lastSuccessAt?: string }).lastSuccessAt;
  const lastFailure = (server as McpServer & { lastFailureAt?: string }).lastFailureAt;
  const lastError = (server as McpServer & { lastErrorMessage?: string }).lastErrorMessage;

  const formatTime = (iso?: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleString();
  };

  const tabs = [
    { key: "tools" as const, label: "Tools", icon: <Wrench className="w-3.5 h-3.5" />, count: toolsArr.length },
    { key: "resources" as const, label: "Resources", icon: <FileText className="w-3.5 h-3.5" />, count: resourcesArr.length },
    { key: "prompts" as const, label: "Prompts", icon: <MessageSquare className="w-3.5 h-3.5" />, count: promptsArr.length },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => setLocation("/servers")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors mb-6 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back to Servers
          </button>

          <div className="glass-panel rounded-2xl p-6 mb-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-display font-bold text-white">{server.name}</h1>
                {server.description && <p className="text-muted-foreground mt-1">{server.description}</p>}
                <div className="flex items-center gap-3 mt-3">
                  <StatusBadge status={displayStatus} latencyMs={displayLatency} />
                  <span className="text-xs bg-secondary rounded-lg px-2 py-0.5 text-muted-foreground font-mono">
                    {server.transportType}
                  </span>
                  {server.authType !== "none" && (
                    <span className="text-xs bg-secondary rounded-lg px-2 py-0.5 text-muted-foreground flex items-center gap-1">
                      <Lock className="w-3 h-3" /> {server.authType}
                    </span>
                  )}
                  {!server.enabled && (
                    <span className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-lg px-2 py-0.5">
                      disabled
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleTest}
                  disabled={testMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-xl text-sm hover:bg-secondary/80 transition-colors border border-white/5 disabled:opacity-50"
                >
                  {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Test Connection
                </button>
                <button
                  onClick={handleDiscover}
                  disabled={discoverMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {discoverMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Refresh Tools
                </button>
              </div>
            </div>

            {testMutation.isSuccess && testMutation.data && (
              <div className={cn(
                "mt-4 p-3 rounded-xl text-sm border",
                (testMutation.data as { success?: boolean }).success
                  ? "bg-green-500/10 border-green-500/20 text-green-300"
                  : "bg-red-500/10 border-red-500/20 text-red-300"
              )}>
                {(testMutation.data as { message?: string }).message ?? "Test complete"}
                {(testMutation.data as { latencyMs?: number }).latencyMs != null && (
                  <span className="ml-2 text-muted-foreground">({(testMutation.data as { latencyMs?: number }).latencyMs}ms)</span>
                )}
              </div>
            )}
            {testMutation.isError && (
              <div className="mt-4 p-3 rounded-xl text-sm border bg-red-500/10 border-red-500/20 text-red-300">
                Connection test failed. Check server configuration.
              </div>
            )}

            {lastError && displayStatus !== "connected" && (
              <div className="mt-4 p-3 rounded-xl text-sm border bg-red-500/5 border-red-500/10 text-red-300/80">
                <span className="font-medium">Last error:</span> {lastError}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <InfoBadge
              icon={<Clock className="w-4 h-4" />}
              label="Last Checked"
              value={formatTime(lastChecked)}
            />
            <InfoBadge
              icon={<CheckCircle2 className="w-4 h-4 text-green-400" />}
              label="Last Success"
              value={formatTime(lastSuccess)}
            />
            <InfoBadge
              icon={<XCircle className="w-4 h-4 text-red-400" />}
              label="Last Failure"
              value={formatTime(lastFailure)}
            />
            <InfoBadge
              icon={displayLatency != null ? <Zap className="w-4 h-4 text-yellow-400" /> : <Globe className="w-4 h-4" />}
              label="Latency"
              value={displayLatency != null ? `${displayLatency}ms` : "N/A"}
            />
          </div>

          {toolsArr.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 rounded-xl border border-white/5">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Approval Required</p>
                  <p className="text-xs text-white font-medium">{approvalCount} of {toolsArr.length} tools</p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 rounded-xl border border-white/5">
                <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Risk Summary</p>
                  <div className="flex items-center gap-2 text-xs">
                    {riskCounts.high > 0 && <span className="text-red-400">{riskCounts.high} high</span>}
                    {riskCounts.medium > 0 && <span className="text-yellow-400">{riskCounts.medium} med</span>}
                    {riskCounts.low > 0 && <span className="text-green-400">{riskCounts.low} low</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 rounded-xl border border-white/5">
                <Wrench className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Capabilities</p>
                  <p className="text-xs text-white font-medium">
                    {toolsArr.length}T · {resourcesArr.length}R · {promptsArr.length}P
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="flex border-b border-white/5">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                    activeTab === tab.key
                      ? "text-white border-primary"
                      : "text-muted-foreground border-transparent hover:text-white hover:border-white/20"
                  )}
                >
                  {tab.icon} {tab.label}
                  <span className="text-xs bg-secondary rounded px-1.5 py-0.5">{tab.count}</span>
                </button>
              ))}
            </div>

            <div className="p-2">
              {activeTab === "tools" && (
                toolsArr.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Wrench className="w-8 h-8 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No tools discovered yet.</p>
                    <button onClick={handleDiscover} className="text-primary text-sm mt-2 hover:underline">
                      Discover tools
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {toolsArr.map((tool) => (
                      <ToolRow
                        key={tool.id}
                        tool={tool}
                        onToggleApproval={handleToggleApproval}
                      />
                    ))}
                  </div>
                )
              )}

              {activeTab === "resources" && (
                resourcesArr.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No resources discovered.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {resourcesArr.map((r) => (
                      <div key={r.id} className="py-3 px-4">
                        <code className="text-sm text-white font-mono">{r.resourceName}</code>
                        {r.resourceType && (
                          <span className="ml-2 text-[10px] bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">
                            {r.resourceType}
                          </span>
                        )}
                        {r.description && <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>}
                      </div>
                    ))}
                  </div>
                )
              )}

              {activeTab === "prompts" && (
                promptsArr.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No prompts discovered.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {promptsArr.map((p) => (
                      <div key={p.id} className="py-3 px-4">
                        <code className="text-sm text-white font-mono">{p.promptName}</code>
                        {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
