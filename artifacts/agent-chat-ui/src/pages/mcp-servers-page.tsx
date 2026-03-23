import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import {
  useListMcpServers,
  useCreateMcpServer,
  useDeleteMcpServer,
} from "@workspace/api-client-react";
import { Server, Plus, Trash2, Settings2, X } from "lucide-react";
import { PageLoader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

interface AddServerForm {
  name: string;
  description: string;
  transportType: "stdio" | "streamable-http";
  endpoint: string;
  command: string;
  authType: "none" | "bearer" | "basic";
  authSecret: string;
}

const DEFAULT_FORM: AddServerForm = {
  name: "",
  description: "",
  transportType: "streamable-http",
  endpoint: "",
  command: "",
  authType: "none",
  authSecret: "",
};

export default function McpServersPage() {
  const { data: servers, isLoading } = useListMcpServers();
  const createMutation = useCreateMcpServer();
  const deleteMutation = useDeleteMcpServer();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [form, setForm] = useState<AddServerForm>(DEFAULT_FORM);

  const handleAdd = () => {
    createMutation.mutate(
      {
        data: {
          name: form.name,
          description: form.description || undefined,
          transportType: form.transportType,
          endpoint: form.transportType === "streamable-http" ? form.endpoint : undefined,
          command: form.transportType === "stdio" ? form.command : undefined,
          authType: form.authType,
          authSecret: form.authSecret || undefined,
        },
      },
      {
        onSuccess: () => {
          setShowAddDialog(false);
          setForm(DEFAULT_FORM);
        },
      }
    );
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-display font-bold text-white">MCP Servers</h1>
              <p className="text-muted-foreground mt-2">
                Manage connected tools and data sources for the agent.
              </p>
            </div>
            <button
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl font-medium shadow-lg glow-effect transition-transform hover:-translate-y-0.5"
            >
              <Plus className="w-4 h-4" /> Add Server
            </button>
          </div>

          {isLoading ? (
            <PageLoader />
          ) : !servers?.length ? (
            <div className="glass-panel rounded-3xl p-12 flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-secondary rounded-2xl flex items-center justify-center mb-6 shadow-xl">
                <Server className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">No servers connected</h3>
              <p className="text-muted-foreground max-w-sm mb-6">
                Connect your first Model Context Protocol server to give your agent access to
                databases, APIs, and file systems.
              </p>
              <button
                onClick={() => setShowAddDialog(true)}
                className="px-6 py-3 bg-secondary text-white rounded-xl hover:bg-secondary/80 transition-colors border border-border"
              >
                Add Your First Server
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="glass-panel p-6 rounded-2xl flex flex-col hover:border-white/10 transition-colors group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/5 flex items-center justify-center">
                        <Server className="w-6 h-6 text-indigo-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg text-white">{server.name}</h3>
                        <p className="text-xs font-mono text-muted-foreground flex items-center gap-1.5 mt-1">
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full",
                              server.status === "connected"
                                ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                                : server.status === "error"
                                  ? "bg-red-500"
                                  : "bg-yellow-500"
                            )}
                          />
                          {server.status.toUpperCase()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-2 bg-secondary rounded-lg text-muted-foreground hover:text-white transition-colors">
                        <Settings2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate({ id: server.id })}
                        disabled={deleteMutation.isPending}
                        className="p-2 bg-destructive/10 rounded-lg text-destructive hover:bg-destructive hover:text-white transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mb-6 flex-1">
                    {server.description || "No description provided."}
                  </p>

                  <div className="flex items-center justify-between pt-4 border-t border-white/5">
                    <span className="text-xs text-muted-foreground font-mono">
                      {server.transportType} · {server.toolCount} tools
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {server.endpoint ?? server.command ?? "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Add Server Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel rounded-2xl p-6 w-full max-w-lg space-y-4 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold text-white">Add MCP Server</h2>
              <button
                onClick={() => setShowAddDialog(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="My MCP Server"
                  className="mt-1 w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description"
                  className="mt-1 w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Transport
                </label>
                <select
                  value={form.transportType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      transportType: e.target.value as "stdio" | "streamable-http",
                    })
                  }
                  className="mt-1 w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="streamable-http">Streamable HTTP (Remote)</option>
                  <option value="stdio">stdio (Local Process)</option>
                </select>
              </div>

              {form.transportType === "streamable-http" ? (
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Endpoint URL *
                  </label>
                  <input
                    type="url"
                    value={form.endpoint}
                    onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                    placeholder="https://my-mcp-server.example.com"
                    className="mt-1 w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Command *
                  </label>
                  <input
                    type="text"
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder="npx @modelcontextprotocol/server-filesystem /path"
                    className="mt-1 w-full bg-input font-mono border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Auth Type
                  </label>
                  <select
                    value={form.authType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        authType: e.target.value as "none" | "bearer" | "basic",
                      })
                    }
                    className="mt-1 w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth</option>
                  </select>
                </div>

                {form.authType !== "none" && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Secret
                    </label>
                    <input
                      type="password"
                      value={form.authSecret}
                      onChange={(e) => setForm({ ...form, authSecret: e.target.value })}
                      placeholder="••••••••"
                      className="mt-1 w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                )}
              </div>
            </div>

            {createMutation.isError && (
              <p className="text-sm text-destructive">Failed to add server. Please try again.</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowAddDialog(false)}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={
                  !form.name ||
                  (form.transportType === "streamable-http" && !form.endpoint) ||
                  (form.transportType === "stdio" && !form.command) ||
                  createMutation.isPending
                }
                className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-all glow-effect disabled:opacity-50"
              >
                {createMutation.isPending ? "Adding..." : "Add Server"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
