import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Settings, User, Shield, Activity } from "lucide-react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { PageLoader } from "@/components/ui/loader";

const TABS = [
  { id: "general", label: "General", icon: Settings },
  { id: "agent", label: "Agent Settings", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "logs", label: "Logs & Debug", icon: Activity },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("general");
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();

  const [agentName, setAgentName] = useState<string | undefined>(undefined);
  const [systemPrompt, setSystemPrompt] = useState<string | undefined>(undefined);
  const [autoRun, setAutoRun] = useState<boolean | undefined>(undefined);

  const effectiveAgentName = agentName ?? settings?.agentName ?? "Claude Assistant";
  const effectiveSystemPrompt =
    systemPrompt ??
    settings?.systemPrompt ??
    "You are a helpful AI assistant with access to MCP tools. Think carefully before executing tools.";
  const effectiveAutoRun = autoRun ?? settings?.autoRun ?? true;

  const handleSave = () => {
    updateSettings.mutate({
      data: {
        agentName: effectiveAgentName,
        systemPrompt: effectiveSystemPrompt,
        autoRun: effectiveAutoRun,
        defaultModel: settings?.defaultModel ?? "claude-sonnet-4-6",
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
                    {activeTab.replace("-", " ")}
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
                    <div className="text-center py-10">
                      <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                      <h3 className="text-lg font-medium text-white">Security Settings</h3>
                      <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                        Manage encrypted secrets, API keys, and allowed domains for remote MCP
                        connections.
                      </p>
                    </div>
                  )}

                  {activeTab === "logs" && (
                    <div className="text-center py-10">
                      <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                      <h3 className="text-lg font-medium text-white">Logs & Debug</h3>
                      <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                        View execution logs, request traces, and debug information from your agent
                        sessions.
                      </p>
                    </div>
                  )}

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
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
