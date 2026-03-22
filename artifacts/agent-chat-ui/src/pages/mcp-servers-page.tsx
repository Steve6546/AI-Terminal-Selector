import { Sidebar } from "@/components/layout/sidebar";
import { useListMcpServers, useCreateMcpServer, useDeleteMcpServer } from "@workspace/api-client-react";
import { Server, Plus, Power, Trash2, Settings2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { PageLoader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

export default function McpServersPage() {
  const { data: servers, isLoading } = useListMcpServers();
  const deleteMutation = useDeleteMcpServer();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-5xl mx-auto">
          
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-display font-bold text-white">MCP Servers</h1>
              <p className="text-muted-foreground mt-2">Manage connected tools and data sources for the agent.</p>
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl font-medium shadow-lg glow-effect transition-transform hover:-translate-y-0.5">
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
              <p className="text-muted-foreground max-w-sm mb-6">Connect your first Model Context Protocol server to give your agent access to databases, APIs, and file systems.</p>
              <button className="px-6 py-3 bg-secondary text-white rounded-xl hover:bg-secondary/80 transition-colors border border-border">
                Browse Directory
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {servers.map(server => (
                <div key={server.id} className="glass-panel p-6 rounded-2xl flex flex-col hover:border-white/10 transition-colors group">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/5 flex items-center justify-center">
                        <Server className="w-6 h-6 text-indigo-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg text-white">{server.name}</h3>
                        <p className="text-xs font-mono text-muted-foreground flex items-center gap-1.5 mt-1">
                          <span className={cn(
                            "w-2 h-2 rounded-full",
                            server.status === 'connected' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : 
                            server.status === 'error' ? "bg-red-500" : "bg-yellow-500"
                          )} />
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
                        className="p-2 bg-destructive/10 rounded-lg text-destructive hover:bg-destructive hover:text-white transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mb-6 flex-1">
                    {server.description || "No description provided."}
                  </p>

                  <div className="flex items-center justify-between pt-4 border-t border-white/5">
                    <div className="flex gap-4 text-xs font-mono text-muted-foreground">
                      <span>{server.toolCount} tools</span>
                      <span>•</span>
                      <span>{server.transportType}</span>
                    </div>
                    <button className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" /> Test
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
