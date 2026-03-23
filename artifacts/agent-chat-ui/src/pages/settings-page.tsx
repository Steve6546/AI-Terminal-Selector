import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import {
  Settings, User, Shield, Activity, Server, Wrench, Palette,
  CheckCircle2, XCircle, Clock, Lock, AlertCircle, Plus, Trash2,
  Database, TestTube, ChevronDown, ChevronRight, Loader2, X,
  Eye, EyeOff, RefreshCw, Globe,
} from "lucide-react";
import {
  useGetSettings,
  useUpdateSettings,
  useListMcpServers,
  useListMcpTools,
  useUpdateMcpTool,
  useListExecutions,
  useListAllExecutionLogs,
  useListDatabaseConnections,
  useCreateDatabaseConnection,
  useUpdateDatabaseConnection,
  useDeleteDatabaseConnection,
  useTestDatabaseConnection,
  SettingsMapDefaultModel,
  type DatabaseConnection,
  type McpServer,
  type ExecutionLogExtended,
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
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";

const TABS = [
  { id: "general", label: "General", icon: Settings },
  { id: "agent", label: "Agent Settings", icon: User },
  { id: "mcp-servers", label: "MCP Servers", icon: Server },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "databases", label: "Databases", icon: Database },
  { id: "security", label: "Security", icon: Shield },
  { id: "logs", label: "Logs & Debug", icon: Activity },
  { id: "ui", label: "UI Settings", icon: Palette },
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${
        checked ? "bg-primary" : "bg-white/10"
      }`}
      style={checked ? { boxShadow: "0 0 8px rgba(99,102,241,0.4)" } : {}}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${
          checked ? "right-0.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

function ExecutionRow({ exec }: {
  exec: { id: number; toolName: string; serverName?: string | null; status: string; durationMs?: number | null; startedAt: string }
}) {
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
      <div className="flex items-center gap-2">
        <span className={cn(
          "text-xs px-2 py-0.5 rounded-full",
          isSuccess ? "bg-green-500/10 text-green-400" :
          isError ? "bg-red-500/10 text-red-400" :
          "bg-yellow-500/10 text-yellow-400"
        )}>
          {exec.status}
        </span>
        <div className="text-xs text-muted-foreground font-mono shrink-0">
          {exec.durationMs != null ? `${exec.durationMs}ms` : "—"}
        </div>
      </div>
    </div>
  );
}

function McpServersTab({ servers }: { servers: McpServer[] | undefined }) {
  const connected = servers?.filter((s) => s.status === "connected").length ?? 0;
  const total = servers?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-black/40 rounded-xl border border-white/5 text-center">
          <div className="text-3xl font-bold text-white font-display">{total}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Servers</div>
        </div>
        <div className="p-4 bg-black/40 rounded-xl border border-white/5 text-center">
          <div className="text-3xl font-bold text-green-400 font-display">{connected}</div>
          <div className="text-xs text-muted-foreground mt-1">Connected</div>
        </div>
        <div className="p-4 bg-black/40 rounded-xl border border-white/5 text-center">
          <div className="text-3xl font-bold text-yellow-400 font-display">{total - connected}</div>
          <div className="text-xs text-muted-foreground mt-1">Offline</div>
        </div>
      </div>

      {!servers || servers.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Server className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No MCP servers configured.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <div key={server.id} className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-2.5 h-2.5 rounded-full",
                  server.status === "connected" ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" :
                  server.status === "error" ? "bg-red-400" : "bg-yellow-400"
                )} />
                <div>
                  <p className="text-sm font-medium text-white">{server.name}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {server.transportType} · {server.toolCount} tools
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={server.status} />
                <Link href="/mcp-servers" className="text-xs text-primary hover:text-primary/80 transition-colors">
                  Manage →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link href="/mcp-servers">
        <button className="w-full py-3 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-all flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" />
          Add MCP Server
        </button>
      </Link>
    </div>
  );
}

function ToolsTab({ servers }: { servers: McpServer[] | undefined }) {
  const [expandedServers, setExpandedServers] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const updateTool = useUpdateMcpTool();

  const toggleServer = (id: number) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!servers || servers.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Wrench className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No MCP servers configured yet.</p>
        <p className="text-xs mt-1">Add servers in the MCP Servers tab to manage their tools.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Enable or disable individual tools, and configure which ones require manual approval before execution.
      </p>
      {servers.map((server) => (
        <ServerToolGroup
          key={server.id}
          server={server}
          expanded={expandedServers.has(server.id)}
          onToggle={() => toggleServer(server.id)}
          onToolUpdate={() => queryClient.invalidateQueries({ queryKey: [`/api/mcp-servers/${server.id}/tools`] })}
          updateTool={updateTool}
        />
      ))}
    </div>
  );
}

function ServerToolGroup({
  server,
  expanded,
  onToggle,
  onToolUpdate,
  updateTool,
}: {
  server: McpServer;
  expanded: boolean;
  onToggle: () => void;
  onToolUpdate: () => void;
  updateTool: ReturnType<typeof useUpdateMcpTool>;
}) {
  const { data: tools, isLoading } = useListMcpTools(server.id, {
    query: { enabled: expanded, queryKey: [`/api/mcp-servers/${server.id}/tools`] },
  });

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-black/40 hover:bg-black/60 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-2 h-2 rounded-full",
            server.status === "connected" ? "bg-green-400" :
            server.status === "error" ? "bg-red-400" : "bg-yellow-400"
          )} />
          <span className="text-sm font-medium text-white">{server.name}</span>
          <span className="text-xs text-muted-foreground">
            {server.toolCount} tools
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-white/5">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            </div>
          ) : !tools || tools.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No tools discovered. Ping the server to discover tools.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              <div className="grid grid-cols-[1fr_80px_120px] gap-2 px-4 py-2 bg-black/20 text-xs text-muted-foreground">
                <span>Tool</span>
                <span className="text-center">Enabled</span>
                <span className="text-center">Requires Approval</span>
              </div>
              {tools.map((tool) => (
                <div key={tool.id} className="grid grid-cols-[1fr_80px_120px] gap-2 items-center px-4 py-3 hover:bg-white/2 transition-colors">
                  <div>
                    <p className="text-sm font-mono text-white">{tool.toolName}</p>
                    {tool.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  <div className="flex justify-center">
                    <Toggle
                      checked={tool.enabled}
                      onChange={(v) => {
                        updateTool.mutate(
                          { toolId: tool.id, data: { enabled: v } },
                          { onSuccess: onToolUpdate }
                        );
                      }}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Toggle
                      checked={tool.requiresApproval}
                      onChange={(v) => {
                        updateTool.mutate(
                          { toolId: tool.id, data: { requiresApproval: v } },
                          { onSuccess: onToolUpdate }
                        );
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DatabasesTab() {
  const queryClient = useQueryClient();
  const { data: connections, isLoading } = useListDatabaseConnections();
  const createConn = useCreateDatabaseConnection();
  const deleteConn = useDeleteDatabaseConnection();
  const testConn = useTestDatabaseConnection();

  const [showForm, setShowForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string; latencyMs?: number }>>({});

  const [form, setForm] = useState({
    name: "",
    type: "postgresql",
    host: "localhost",
    port: 5432,
    username: "",
    password: "",
    database: "",
    ssl: false,
  });

  const handleCreate = async () => {
    if (!form.name || !form.database) return;
    await createConn.mutateAsync({ data: form });
    queryClient.invalidateQueries({ queryKey: [`/api/database-connections`] });
    setShowForm(false);
    setForm({ name: "", type: "postgresql", host: "localhost", port: 5432, username: "", password: "", database: "", ssl: false });
  };

  const handleDelete = async (id: number) => {
    await deleteConn.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: [`/api/database-connections`] });
    setTestResults((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const handleTest = async (conn: DatabaseConnection) => {
    setTestingId(conn.id);
    try {
      const result = await testConn.mutateAsync({ id: conn.id });
      setTestResults((prev) => ({ ...prev, [conn.id]: result }));
      queryClient.invalidateQueries({ queryKey: [`/api/database-connections`] });
    } finally {
      setTestingId(null);
    }
  };

  const dbTypeIcon = (type: string) => {
    if (type === "postgresql") return "🐘";
    if (type === "mysql") return "🐬";
    if (type === "sqlite") return "💾";
    return "🗄️";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Connect to external databases for use in agent workflows.
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-all glow-effect"
        >
          <Plus className="w-4 h-4" />
          Add Connection
        </button>
      </div>

      {showForm && (
        <div className="p-5 bg-black/40 rounded-xl border border-primary/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">New Database Connection</h3>
            <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Connection Name *</label>
              <input
                type="text"
                placeholder="My Database"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
              >
                <option value="postgresql">🐘 PostgreSQL</option>
                <option value="mysql">🐬 MySQL</option>
                <option value="sqlite">💾 SQLite</option>
              </select>
            </div>
          </div>

          {form.type !== "sqlite" && (
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Host</label>
                <input
                  type="text"
                  placeholder="localhost"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 5432 })}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                {form.type === "sqlite" ? "File Path *" : "Database Name *"}
              </label>
              <input
                type="text"
                placeholder={form.type === "sqlite" ? "/data/app.db" : "mydb"}
                value={form.database}
                onChange={(e) => setForm({ ...form, database: e.target.value })}
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
              />
            </div>
            {form.type !== "sqlite" && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Username</label>
                <input
                  type="text"
                  placeholder="postgres"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
                />
              </div>
            )}
          </div>

          {form.type !== "sqlite" && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 pr-10 text-sm text-white focus:outline-none focus:border-primary transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {form.type !== "sqlite" && (
            <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg">
              <span className="text-sm text-white">Enable SSL/TLS</span>
              <Toggle checked={form.ssl} onChange={(v) => setForm({ ...form, ssl: v })} />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={createConn.isPending || !form.name || !form.database}
              className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {createConn.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Connection
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      ) : !connections || connections.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No database connections configured.</p>
          <p className="text-xs mt-1">Add a connection to use databases in your agent workflows.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map((conn) => {
            const result = testResults[conn.id];
            const isTesting = testingId === conn.id;
            return (
              <div key={conn.id} className="p-4 bg-black/40 rounded-xl border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{dbTypeIcon(conn.type)}</span>
                    <div>
                      <p className="text-sm font-medium text-white">{conn.name}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {conn.type !== "sqlite" ? `${conn.host ?? "localhost"}:${conn.port ?? 5432}` : ""}/{conn.database}
                        {conn.username ? ` · ${conn.username}` : ""}
                        {conn.ssl ? " · SSL" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={conn.status} />
                    <button
                      onClick={() => handleTest(conn)}
                      disabled={isTesting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 hover:border-primary/50 hover:text-primary text-muted-foreground transition-all"
                    >
                      {isTesting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <TestTube className="w-3.5 h-3.5" />
                      )}
                      Test
                    </button>
                    <button
                      onClick={() => handleDelete(conn.id)}
                      disabled={deleteConn.isPending}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {result && (
                  <div className={cn(
                    "flex items-start gap-2 p-2.5 rounded-lg text-xs",
                    result.success ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                  )}>
                    {result.success ? (
                      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    )}
                    <span>{result.message}{result.latencyMs ? ` (${result.latencyMs}ms)` : ""}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SecurityTab({
  mcpServers,
  domainAllowlist,
  onDomainAllowlistChange,
}: {
  mcpServers: McpServer[] | undefined;
  domainAllowlist: string[];
  onDomainAllowlistChange: (domains: string[]) => void;
}) {
  const [newDomain, setNewDomain] = useState("");

  const addDomain = () => {
    const d = newDomain.trim().toLowerCase();
    if (d && !domainAllowlist.includes(d)) {
      onDomainAllowlistChange([...domainAllowlist, d]);
      setNewDomain("");
    }
  };

  const removeDomain = (domain: string) => {
    onDomainAllowlistChange(domainAllowlist.filter((d) => d !== domain));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 p-4 bg-black/40 rounded-xl border border-white/5">
        <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
          <Lock className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <p className="font-medium text-white text-sm">Secret Encryption</p>
          <p className="text-xs text-muted-foreground mt-1">
            All secrets (MCP auth tokens, database passwords) are encrypted at rest using AES-256-GCM.
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-green-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Encryption active — SECRET_ENCRYPTION_KEY is set</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4" />
          Domain Allowlist
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Restrict MCP server connections to these origins. Leave empty to allow all origins.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="https://api.example.com"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDomain()}
            className="flex-1 bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
          />
          <button
            onClick={addDomain}
            disabled={!newDomain.trim()}
            className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {domainAllowlist.length === 0 ? (
          <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/10 text-xs text-yellow-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            No domains in allowlist — all origins are permitted.
          </div>
        ) : (
          <div className="space-y-1.5">
            {domainAllowlist.map((domain) => (
              <div key={domain} className="flex items-center justify-between px-3 py-2 bg-black/40 rounded-lg border border-white/5">
                <span className="text-sm font-mono text-white">{domain}</span>
                <button
                  onClick={() => removeDomain(domain)}
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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

      <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-xs text-blue-300">
        <Shield className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
        <span>
          Secrets are never returned in plain text through the API. Key material lives only in
          SECRET_ENCRYPTION_KEY and in AES-256-GCM ciphertext in the database.
        </span>
      </div>
    </div>
  );
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  info: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  warn: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  error: "bg-red-500/20 text-red-300 border-red-500/30",
  debug: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

function RawEventRow({ log }: { log: ExecutionLogExtended }) {
  const levelColor = LOG_LEVEL_COLORS[log.level] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";
  return (
    <div className="py-2.5 px-1 flex items-start gap-3 text-xs font-mono border-b border-white/5 hover:bg-white/2 transition-colors">
      <span className="shrink-0 text-muted-foreground/60 tabular-nums w-20 pt-0.5">
        {new Date(log.createdAt).toLocaleTimeString()}
      </span>
      <span className={cn("shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase", levelColor)}>
        {log.level}
      </span>
      <span className="shrink-0 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-purple-300 uppercase">
        {log.eventType}
      </span>
      {log.serverName && (
        <span className="shrink-0 text-cyan-400/70">[{log.serverName}]</span>
      )}
      {log.toolName && (
        <span className="shrink-0 text-orange-400/70">{log.toolName}</span>
      )}
      <span className="text-muted-foreground break-all leading-relaxed">{log.message}</span>
    </div>
  );
}

function LogsTab({
  executions,
  mcpServers,
}: {
  executions: { id: number; toolName: string; serverName?: string | null; status: string; durationMs?: number | null; startedAt: string }[] | undefined;
  mcpServers: McpServer[] | undefined;
}) {
  const [view, setView] = useState<"executions" | "events">("executions");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [serverFilter, setServerFilter] = useState<string>("all");

  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [serverIdFilter, setServerIdFilter] = useState<number | undefined>(undefined);
  const [afterFilter, setAfterFilter] = useState<string>("");
  const [beforeFilter, setBeforeFilter] = useState<string>("");

  const rawLogsParams = view === "events" ? {
    level: levelFilter !== "all" ? levelFilter : undefined,
    eventType: eventTypeFilter !== "all" ? eventTypeFilter : undefined,
    serverId: serverIdFilter,
    after: afterFilter || undefined,
    before: beforeFilter || undefined,
    limit: 200,
  } : undefined;

  const { data: rawLogs, isLoading: logsLoading } = useListAllExecutionLogs(rawLogsParams, {
    query: { enabled: view === "events", queryKey: ["/api/execution-logs", rawLogsParams] },
  });

  const servers = [...new Set((executions ?? []).map((e) => e.serverName).filter(Boolean))];

  const filtered = (executions ?? []).filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (serverFilter !== "all" && e.serverName !== serverFilter) return false;
    return true;
  });

  const stats = {
    total: executions?.length ?? 0,
    success: executions?.filter((e) => e.status === "success").length ?? 0,
    error: executions?.filter((e) => e.status === "error" || e.status === "failed").length ?? 0,
    avgLatency: executions?.reduce((acc, e) => acc + (e.durationMs ?? 0), 0) ?? 0,
  };

  const eventTypes = [...new Set((rawLogs ?? []).map((l) => l.eventType).filter(Boolean))].sort();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-white" },
          { label: "Success", value: stats.success, color: "text-green-400" },
          { label: "Errors", value: stats.error, color: "text-red-400" },
          {
            label: "Avg Latency",
            value: stats.total > 0 ? `${Math.round(stats.avgLatency / stats.total)}ms` : "—",
            color: "text-blue-400"
          },
        ].map((stat) => (
          <div key={stat.label} className="p-3 bg-black/40 rounded-xl border border-white/5 text-center">
            <div className={`text-2xl font-bold font-display ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-black/40 rounded-xl p-1 border border-white/5">
        {(["executions", "events"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-sm font-medium transition-all",
              view === v
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {v === "executions" ? "Tool Executions" : "Raw Events"}
          </button>
        ))}
      </div>

      {view === "executions" ? (
        <>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
            </select>
            {servers.length > 0 && (
              <select
                value={serverFilter}
                onChange={(e) => setServerFilter(e.target.value)}
                className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
              >
                <option value="all">All servers</option>
                {servers.map((s) => (
                  <option key={s} value={s!}>{s}</option>
                ))}
              </select>
            )}
            <span className="ml-auto text-xs text-muted-foreground font-mono">
              {filtered.length} / {stats.total} records
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No executions match the current filters.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map((exec) => (
                <ExecutionRow key={exec.id} exec={exec} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
            >
              <option value="all">All levels</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </select>
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
            >
              <option value="all">All event types</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {mcpServers && mcpServers.length > 0 && (
              <select
                value={serverIdFilter ?? "all"}
                onChange={(e) => setServerIdFilter(e.target.value === "all" ? undefined : parseInt(e.target.value))}
                className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
              >
                <option value="all">All servers</option>
                {mcpServers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <input
              type="datetime-local"
              value={afterFilter}
              onChange={(e) => setAfterFilter(e.target.value)}
              placeholder="After"
              className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
              title="After date/time"
            />
            <input
              type="datetime-local"
              value={beforeFilter}
              onChange={(e) => setBeforeFilter(e.target.value)}
              placeholder="Before"
              className="bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-all"
              title="Before date/time"
            />
            <span className="ml-auto text-xs text-muted-foreground font-mono">
              {rawLogs?.length ?? 0} events
            </span>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : !rawLogs || rawLogs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No events match the current filters.</p>
            </div>
          ) : (
            <div className="bg-black/60 rounded-xl border border-white/5 p-3 max-h-[480px] overflow-y-auto font-mono">
              {rawLogs.map((log) => (
                <RawEventRow key={log.id} log={log} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UISettingsTab({
  developerMode,
  showTimeline,
  showTechnicalDetails,
  compactMode,
  onChangeDeveloperMode,
  onChangeShowTimeline,
  onChangeShowTechnicalDetails,
  onChangeCompactMode,
}: {
  developerMode: boolean;
  showTimeline: boolean;
  showTechnicalDetails: boolean;
  compactMode: boolean;
  onChangeDeveloperMode: (v: boolean) => void;
  onChangeShowTimeline: (v: boolean) => void;
  onChangeShowTechnicalDetails: (v: boolean) => void;
  onChangeCompactMode: (v: boolean) => void;
}) {
  const uiOptions = [
    {
      label: "Developer Mode",
      description: "Show raw API responses, tool inputs/outputs, and debug information",
      value: developerMode,
      onChange: onChangeDeveloperMode,
    },
    {
      label: "Show Execution Timeline",
      description: "Display the tool execution timeline panel during agent conversations",
      value: showTimeline,
      onChange: onChangeShowTimeline,
    },
    {
      label: "Show Technical Details",
      description: "Include model IDs, token counts, and latency in message headers",
      value: showTechnicalDetails,
      onChange: onChangeShowTechnicalDetails,
    },
    {
      label: "Compact Mode",
      description: "Reduce padding and spacing for a denser interface",
      value: compactMode,
      onChange: onChangeCompactMode,
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Customize the interface to match your workflow preferences.
      </p>
      {uiOptions.map((opt) => (
        <div key={opt.label} className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
          <div>
            <p className="font-medium text-white text-sm">{opt.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
          </div>
          <Toggle checked={opt.value} onChange={opt.onChange} />
        </div>
      ))}

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Theme</label>
        <select className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all">
          <option value="dark">Dark Mode (Default)</option>
          <option disabled>Light Mode (Coming Soon)</option>
          <option disabled>System (Coming Soon)</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Language</label>
        <select className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all">
          <option value="en">English</option>
          <option value="ar">العربية</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="es">Español</option>
          <option value="zh">中文</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Timezone</label>
        <select className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all">
          <option value="local">Local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
          <option value="UTC">UTC</option>
          <option value="America/New_York">Eastern (US)</option>
          <option value="America/Los_Angeles">Pacific (US)</option>
          <option value="Europe/London">London</option>
          <option value="Europe/Paris">Paris</option>
          <option value="Asia/Tokyo">Tokyo</option>
          <option value="Asia/Dubai">Dubai</option>
        </select>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const searchString = useSearch();
  const initialTab = (() => {
    const params = new URLSearchParams(searchString);
    const tab = params.get("tab");
    return tab && TABS.some((t) => t.id === tab) ? tab : "general";
  })();
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const tab = params.get("tab");
    if (tab && TABS.some((t) => t.id === tab)) {
      setActiveTab(tab);
    }
  }, [searchString]);

  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { data: mcpServers } = useListMcpServers();
  const { data: executions } = useListExecutions({}, {
    query: { enabled: activeTab === "logs", queryKey: ["executions", "all"] }
  });

  const [agentName, setAgentName] = useState<string | undefined>(undefined);
  const [systemPrompt, setSystemPrompt] = useState<string | undefined>(undefined);
  const [autoRun, setAutoRun] = useState<boolean | undefined>(undefined);
  const [defaultModel, setDefaultModel] = useState<SettingsMapDefaultModel | undefined>(undefined);
  const [maxToolCalls, setMaxToolCalls] = useState<number | undefined>(undefined);
  const [maxExecutionTime, setMaxExecutionTime] = useState<number | undefined>(undefined);
  const [developerMode, setDeveloperMode] = useState<boolean | undefined>(undefined);
  const [showTimeline, setShowTimeline] = useState<boolean | undefined>(undefined);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean | undefined>(undefined);
  const [compactMode, setCompactMode] = useState<boolean | undefined>(undefined);
  const [domainAllowlist, setDomainAllowlist] = useState<string[] | undefined>(undefined);

  const effectiveAgentName = agentName ?? settings?.agentName ?? "Claude Assistant";
  const effectiveSystemPrompt = systemPrompt ?? settings?.systemPrompt ?? "";
  const effectiveAutoRun = autoRun ?? settings?.autoRun ?? true;
  const effectiveModel = defaultModel ?? (settings?.defaultModel as SettingsMapDefaultModel) ?? "claude-sonnet-4-6";
  const effectiveMaxToolCalls = maxToolCalls ?? settings?.maxToolCalls ?? 10;
  const effectiveMaxExecutionTime = maxExecutionTime ?? settings?.maxExecutionTime ?? 60;
  const effectiveDeveloperMode = developerMode ?? settings?.developerMode ?? false;
  const effectiveShowTimeline = showTimeline ?? settings?.showTimeline ?? true;
  const effectiveShowTechnicalDetails = showTechnicalDetails ?? settings?.showTechnicalDetails ?? false;
  const effectiveCompactMode = compactMode ?? (settings as Record<string, unknown> | undefined)?.compactMode as boolean ?? false;
  const effectiveDomainAllowlist = domainAllowlist ?? (settings as Record<string, unknown> | undefined)?.domainAllowlist as string[] ?? [];

  const handleSave = () => {
    updateSettings.mutate({
      data: {
        agentName: effectiveAgentName,
        systemPrompt: effectiveSystemPrompt,
        autoRun: effectiveAutoRun,
        defaultModel: effectiveModel,
        maxToolCalls: effectiveMaxToolCalls,
        maxExecutionTime: effectiveMaxExecutionTime,
        developerMode: effectiveDeveloperMode,
        showTimeline: effectiveShowTimeline,
        showTechnicalDetails: effectiveShowTechnicalDetails,
        compactMode: effectiveCompactMode,
        domainAllowlist: effectiveDomainAllowlist,
      } as Parameters<typeof updateSettings.mutate>[0]["data"],
    });
  };

  const needsSave = ["general", "agent", "security", "ui"].includes(activeTab);
  const tabTitle = activeTab === "mcp-servers" ? "MCP Servers" : activeTab === "ui" ? "UI Settings" : activeTab === "logs" ? "Logs & Debug" : activeTab.charAt(0).toUpperCase() + activeTab.slice(1);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex overflow-hidden">
        <div className="w-60 border-r border-border/50 bg-black/20 p-4 flex-shrink-0">
          <h2 className="text-lg font-bold font-display text-white mb-6 px-2">Settings</h2>
          <nav className="space-y-0.5">
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
                <tab.icon className="w-4 h-4 flex-shrink-0" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-3xl">
            {isLoading ? (
              <PageLoader />
            ) : (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h1 className="text-3xl font-display font-bold text-white">{tabTitle}</h1>
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

                      <div className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
                        <div>
                          <p className="font-medium text-white text-sm">Auto-Run Tools</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Allow agent to run tools without explicit approval
                          </p>
                        </div>
                        <Toggle checked={effectiveAutoRun} onChange={setAutoRun} />
                      </div>
                    </>
                  )}

                  {activeTab === "agent" && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">System Prompt</label>
                        <textarea
                          rows={8}
                          value={effectiveSystemPrompt}
                          onChange={(e) => setSystemPrompt(e.target.value)}
                          placeholder="You are a helpful AI assistant with access to MCP tools..."
                          className="w-full bg-input border border-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono custom-scrollbar resize-none"
                        />
                        <p className="text-xs text-muted-foreground">{effectiveSystemPrompt.length} characters</p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">Max Tool Calls</label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={effectiveMaxToolCalls}
                            onChange={(e) => setMaxToolCalls(parseInt(e.target.value) || 10)}
                            className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                          />
                          <p className="text-xs text-muted-foreground">Maximum tool calls per conversation turn</p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground">Max Execution Time (s)</label>
                          <input
                            type="number"
                            min={5}
                            max={300}
                            value={effectiveMaxExecutionTime}
                            onChange={(e) => setMaxExecutionTime(parseInt(e.target.value) || 60)}
                            className="w-full bg-input border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                          />
                          <p className="text-xs text-muted-foreground">Per-tool execution timeout</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-black/40 rounded-xl border border-white/5">
                        <div>
                          <p className="font-medium text-white text-sm">Auto-Run Tools</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Allow agent to run tools without explicit approval
                          </p>
                        </div>
                        <Toggle checked={effectiveAutoRun} onChange={setAutoRun} />
                      </div>
                    </>
                  )}

                  {activeTab === "mcp-servers" && (
                    <McpServersTab servers={mcpServers} />
                  )}

                  {activeTab === "tools" && (
                    <ToolsTab servers={mcpServers} />
                  )}

                  {activeTab === "databases" && (
                    <DatabasesTab />
                  )}

                  {activeTab === "security" && (
                    <SecurityTab
                      mcpServers={mcpServers}
                      domainAllowlist={effectiveDomainAllowlist}
                      onDomainAllowlistChange={setDomainAllowlist}
                    />
                  )}

                  {activeTab === "logs" && (
                    <LogsTab executions={executions} mcpServers={mcpServers} />
                  )}

                  {activeTab === "ui" && (
                    <UISettingsTab
                      developerMode={effectiveDeveloperMode}
                      showTimeline={effectiveShowTimeline}
                      showTechnicalDetails={effectiveShowTechnicalDetails}
                      compactMode={effectiveCompactMode}
                      onChangeDeveloperMode={setDeveloperMode}
                      onChangeShowTimeline={setShowTimeline}
                      onChangeShowTechnicalDetails={setShowTechnicalDetails}
                      onChangeCompactMode={setCompactMode}
                    />
                  )}

                  {needsSave && (
                    <div className="pt-6 mt-6 border-t border-border flex items-center justify-end gap-3">
                      {updateSettings.isSuccess && (
                        <span className="text-sm text-green-400 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          Saved successfully
                        </span>
                      )}
                      {updateSettings.isError && (
                        <span className="text-sm text-destructive">Failed to save</span>
                      )}
                      <button
                        onClick={handleSave}
                        disabled={updateSettings.isPending}
                        className="px-6 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-all glow-effect disabled:opacity-50 flex items-center gap-2"
                      >
                        {updateSettings.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
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
