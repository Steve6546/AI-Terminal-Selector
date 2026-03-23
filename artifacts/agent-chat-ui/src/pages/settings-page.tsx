import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Settings, User, Shield, Activity, CheckCircle2, XCircle, Clock, Lock, AlertCircle } from "lucide-react";
import {
  useGetSettings,
  useUpdateSettings,
  useListMcpServers,
  useListExecutions,
  SettingsMapDefaultModel,
} from "@workspace/api-client-react";
import { PageLoader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TABS = [
  { id: "general", label: "General", icon: Settings },
  { id: "agent", label: "Agent Settings", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "logs", label: "Logs & Debug", icon: Activity },
];

function StatusBadge({ status }: { status: string }) {
  const isConnected = status === "connected";
  const isError = status === "error";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
      isConnected ? "bg-green-500/10 text-green-400" :
      isError ? "bg-red-500/10 text-red-400" :
      "bg-yellow-500/10 text-yellow-400"
    )}>
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        isConnected ? "bg-green-400" : isError ? "bg-red-400" : "bg-yellow-400"
      )} />
      {status}
    </span>
  );
}

function ExecutionRow({ exec }: { exec: { id: number; toolName: string; serverName?: string | null; status: string; durationMs?: number | null; startedAt: string } }) {
  const isSuccess = exec.status === "success";
  const isError = exec.status === "error" || exec.status === "failed";
  const date = new Date(exec.startedAt);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <div className="flex-shrink-0">
        {isSuccess ? <CheckCircle2 className="w-4 h-4 text-green-400" /> :
          isError ? <XCircle className="w-4 h-4 text-red-400" /> :
          <Clock className="w-4 h-4 text-yellow-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-white truncate">{exec.toolName}</span>
          {exec.serverName && (
            <span className="text-xs text-muted-foreground">@ {exec.serverName}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {date.toLocaleString()}
        </div>
      </div>
      <div className="text-xs text-muted-foreground font-mono shrink-0">
        {exec.durationMs != null ? `${exec.durationMs}ms` : "—"}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("general");
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { data: mcpServers } = useListMcpServers();
  const { data: executions } = useListExecutions({}, { query: { enabled: activeTab === "logs", queryKey: ["executions", "all"] } });

  const [agentName, setAgentName] = useState<string | undefined>(undefined);
  const [systemPrompt, setSystemPrompt] = useState<string | undefined>(undefined);
  const [autoRun, setAutoRun] = useState<boolean | undefined>(undefined);
  const [defaultModel, setDefaultModel] = useState<SettingsMapDefaultModel | undefined>(undefined);

  const effectiveAgentName = agentName ?? settings?.agentName ?? "Claude Assistant";
  const effectiveSystemPrompt =
    systemPrompt ??
    settings?.systemPrompt ??
    "You are a helpful AI assistant with access to MCP tools. Think carefully before executing tools.";
  const effectiveAutoRun = autoRun ?? settings?.autoRun ?? true;
  const effectiveModel = defaultModel ?? (settings?.defaultModel as SettingsMapDefaultModel) ?? "claude-sonnet-4-6";

  const handleSave = () => {
    updateSettings.mutate({
      data: {
        agentName: effectiveAgentName,
        systemPrompt: effectiveSystemPrompt,
        autoRun: effectiveAutoRun,
        defaultModel: effectiveModel,
      },
    });
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex overflow-hidden">

        {/* Settings Sidebar */}
        <div className="w-64 border-r border-border/50 bg-black/20 p-4">
          <h2 className="text-lg font-bold font-display text-white mb-6 px-2">Settings</h2>
          <nav className="space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? "bg-primary text-white shadow-md glow-effect"
                    : "text-muted-foreground hover:bg-white/5 hover:text-white"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Settings Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-3xl">
            {isLoading ? (
              <PageLoader />
            ) : (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h1 className="text-3xl font-display font-bold text-white capitalize">
                    {activeTab === "logs" ? "Logs & Debug" : activeTab.replace("-", " ")}
                  </h1>
                  <p className="text-muted-foreground mt-2">
                    Manage your application preferences and configurations.
                  </p>
                </div>

                <div className="glass-panel rounded-2xl p-6 space-y-6">
                  {activeTab === "general" && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          Agent Display Name
                        </label>
                        <input
                          type="text"
                          value={effectiveAgentName}
                          onChange={(e) => setAgentName(e.target.value)}
                          className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Default Model</label>
                        <Select value={effectiveModel} onValueChange={(v) => setDefaultModel(v as SettingsMapDefaultModel)}>
                          <SelectTrigger className="w-full bg-input border border-border rounded-xl text-sm text-white focus:border-primary">
                            <SelectValue placeholder="Select model" />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            <SelectItem value="claude-sonnet-4-6">
                              <div className="flex flex-col">
                                <span>Claude Sonnet 4.6</span>
                                <span className="text-[10px] text-muted-foreground">Fast & efficient for most tasks</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="claude-opus-4-6">
                              <div className="flex flex-col">
                                <span>Claude Opus 4.6</span>
                                <span className="text-[10px] text-muted-foreground">Powerful reasoning & coding</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Theme</label>
                        <select className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all">
                          <option>Dark Mode (Default)</option>
                          <option disabled>Light Mode (Coming Soon)</option>
                        </select>
                      </div>
                    </>
                  )}

                  {activeTab === "agent" && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">System Prompt</label>
                        <textarea
                          rows={6}
                          value={effectiveSystemPrompt}
                          onChange={(e) => setSystemPrompt(e.target.value)}
                          className="w-full bg-input border border-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono custom-scrollbar"
                        />
                      </div>
                      <div className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
                        <div>
                          <p className="font-medium text-white text-sm">Auto-Run Tools</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Allow agent to run tools without explicit approval
                          </p>
                        </div>
                        <button
                          onClick={() => setAutoRun(!effectiveAutoRun)}
                          className={`w-12 h-6 rounded-full relative transition-colors ${
                            effectiveAutoRun ? "bg-primary" : "bg-secondary"
                          }`}
                          style={effectiveAutoRun ? { boxShadow: "0 0 10px rgba(99,102,241,0.5)" } : {}}
                        >
                          <div
                            className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${
                              effectiveAutoRun ? "right-1" : "left-1"
                            }`}
                          />
                        </button>
                      </div>
                    </>
                  )}

                  {activeTab === "security" && (
                    <div className="space-y-6">
                      {/* Encryption Status */}
                      <div className="flex items-start gap-4 p-4 bg-black/40 rounded-xl border border-white/5">
                        <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
                          <Lock className="w-5 h-5 text-green-400" />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Secret Encryption</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            All MCP server secrets are encrypted at rest using AES-256-GCM with a scrypt-derived key.
                          </p>
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-green-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Encryption active — SECRET_ENCRYPTION_KEY is set</span>
                          </div>
                        </div>
                      </div>

                      {/* MCP Server Auth Overview */}
                      <div>
                        <h3 className="text-sm font-medium text-foreground mb-3">MCP Server Authentication</h3>
                        {!mcpServers || mcpServers.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                            No MCP servers configured yet.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {mcpServers.map((server) => (
                              <div key={server.id} className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-white/5">
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "w-2 h-2 rounded-full",
                                    server.status === "connected" ? "bg-green-400" :
                                    server.status === "error" ? "bg-red-400" : "bg-yellow-400"
                                  )} />
                                  <div>
                                    <p className="text-sm font-medium text-white">{server.name}</p>
                                    <p className="text-xs text-muted-foreground font-mono">
                                      {server.transportType} · {server.authType || "no auth"}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {server.authType !== "none" && (
                                    <span className="text-xs text-muted-foreground font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5">
                                      <Lock className="w-3 h-3 inline mr-1 text-primary" />
                                      encrypted
                                    </span>
                                  )}
                                  <StatusBadge status={server.status} />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Security Note */}
                      <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-xs text-blue-300">
                        <Shield className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
                        <span>
                          Secrets are never returned in plain text through the API. The raw key material lives only in the
                          SECRET_ENCRYPTION_KEY environment variable and in AES-256-GCM ciphertext in the database.
                        </span>
                      </div>
                    </div>
                  )}

                  {activeTab === "logs" && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">Recent tool executions across all conversations.</p>
                        <span className="text-xs text-muted-foreground font-mono">
                          {executions?.length ?? 0} records
                        </span>
                      </div>

                      {!executions || executions.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground">
                          <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                          <p className="text-sm">No executions yet.</p>
                          <p className="text-xs mt-1">Start a conversation in Agent mode to see tool execution logs here.</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-white/5">
                          {executions.map((exec) => (
                            <ExecutionRow key={exec.id} exec={exec} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {(activeTab === "general" || activeTab === "agent") && (
                    <div className="pt-6 mt-6 border-t border-border flex items-center justify-end gap-3">
                      {updateSettings.isSuccess && (
                        <span className="text-sm text-green-400">Saved successfully</span>
                      )}
                      {updateSettings.isError && (
                        <span className="text-sm text-destructive">Failed to save</span>
                      )}
                      <button
                        onClick={handleSave}
                        disabled={updateSettings.isPending}
                        className="px-6 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-all glow-effect disabled:opacity-50"
                      >
                        {updateSettings.isPending ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
