import { SettingsMapDefaultModel, useGetSystemStatus } from "@workspace/api-client-react";
import { Settings, Zap, TerminalSquare } from "lucide-react";
import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface TopBarProps {
  model: SettingsMapDefaultModel;
  onModelChange: (model: SettingsMapDefaultModel) => void;
  onTerminalToggle?: () => void;
}

export function TopBar({ model, onModelChange, onTerminalToggle }: TopBarProps) {
  const { data: status } = useGetSystemStatus({ query: { refetchInterval: 30_000, queryKey: ["system-status"] } });

  return (
    <div className="h-14 w-full flex items-center justify-between px-6 glass-panel border-b border-white/5 relative z-10 shrink-0">

      {/* System Status Pills */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-white/5 text-xs font-medium text-muted-foreground">
          <div className={cn(
            "w-2 h-2 rounded-full",
            (status?.connectedServers || 0) > 0 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500"
          )} />
          <span className="text-white">{status?.connectedServers || 0}</span> Servers
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-white/5 text-xs font-medium text-muted-foreground hidden sm:flex">
          <Zap className="w-3.5 h-3.5 text-yellow-500" />
          <span className="text-white">{status?.totalTools || 0}</span> Tools Ready
        </div>

        {status?.agentState === "busy" && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-xs font-medium text-primary animate-pulse">
            <span className="w-1.5 h-1.5 bg-primary rounded-full" />
            Agent Active
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        {/* Model Selector */}
        <div className="hidden sm:block">
          <Select value={model} onValueChange={(v) => onModelChange(v as SettingsMapDefaultModel)}>
            <SelectTrigger className="w-[200px] h-9 bg-background/50 border-white/10 text-xs font-medium">
              <SelectValue placeholder="Select Model" />
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

        <div className="w-px h-6 bg-white/10 hidden sm:block" />

        {/* Terminal Toggle */}
        {onTerminalToggle && (
          <button
            onClick={onTerminalToggle}
            className="p-2 text-muted-foreground hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            title="Toggle Terminal"
          >
            <TerminalSquare className="w-5 h-5" />
          </button>
        )}

        <Link href="/settings" className="p-2 text-muted-foreground hover:text-white hover:bg-white/10 rounded-lg transition-colors">
          <Settings className="w-5 h-5" />
        </Link>
      </div>
    </div>
  );
}
