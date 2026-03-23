import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, ShieldAlert, Server, Wrench, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LiveTool } from "@/hooks/use-chat-stream";

interface LiveToolCardProps {
  tool: LiveTool;
  compact?: boolean;
}

export function LiveToolCard({ tool, compact = false }: LiveToolCardProps) {
  const [stdoutOpen, setStdoutOpen] = useState(false);

  const isDone = tool.phase === "done";
  const isRunning = tool.phase === "running";
  const isApproval = tool.phase === "approval_required";

  const statusColor = isApproval
    ? "border-orange-500/30 bg-orange-500/5"
    : isDone && tool.success
    ? "border-green-500/20 bg-green-500/5"
    : isDone && !tool.success
    ? "border-red-500/20 bg-red-500/5"
    : "border-blue-500/20 bg-blue-500/5";

  const iconColor = isApproval ? "text-orange-400" : isDone && tool.success ? "text-green-400" : isDone && !tool.success ? "text-red-400" : "text-blue-400";
  const icon = isApproval
    ? <ShieldAlert className={cn("w-4 h-4", iconColor)} />
    : isDone && tool.success
    ? <CheckCircle2 className={cn("w-4 h-4", iconColor)} />
    : isDone && !tool.success
    ? <XCircle className={cn("w-4 h-4", iconColor)} />
    : <Loader2 className={cn("w-4 h-4 animate-spin", iconColor)} />;

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono border",
          statusColor
        )}
      >
        {icon}
        <span className={isDone && tool.success ? "text-green-400" : isDone ? "text-red-400" : isApproval ? "text-orange-300" : "text-blue-400"}>
          {tool.toolName}
        </span>
        {tool.serverName && (
          <span className="text-muted-foreground opacity-60">@ {tool.serverName}</span>
        )}
        {isDone && tool.durationMs != null && (
          <span className="opacity-50 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {tool.durationMs}ms
          </span>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-xl border overflow-hidden", statusColor)}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium text-foreground">{tool.toolName}</span>
            {tool.serverName && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Server className="w-3 h-3" />
                {tool.serverName}
              </span>
            )}
          </div>
          {tool.error && (
            <p className="text-xs text-red-400/80 mt-0.5 truncate">{tool.error}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground">
          {isDone && tool.durationMs != null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {tool.durationMs}ms
            </span>
          )}
          {isApproval && (
            <span className="text-orange-400 font-mono text-[10px] animate-pulse">AWAITING APPROVAL</span>
          )}
          {isRunning && (
            <span className="text-blue-400/60 font-mono text-[10px]">RUNNING</span>
          )}
          {/* stdout toggle */}
          {tool.stdout && (
            <button
              onClick={() => setStdoutOpen((p) => !p)}
              className="p-1 rounded hover:bg-white/10 transition-colors ml-1"
            >
              {stdoutOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Stdout panel */}
      <AnimatePresence initial={false}>
        {tool.stdout && stdoutOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 bg-black/20">
              <div className="px-4 py-2 flex items-center gap-1.5 border-b border-white/5">
                <Wrench className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Output</span>
              </div>
              <pre className="px-4 py-3 text-xs font-mono text-foreground/80 whitespace-pre-wrap overflow-x-auto custom-scrollbar max-h-48 overflow-y-auto">
                {tool.stdout}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input preview when running */}
      {isRunning && tool.inputs && Object.keys(tool.inputs).length > 0 && (
        <div className="border-t border-white/5 px-4 py-2 flex gap-3 overflow-x-auto">
          {Object.entries(tool.inputs).slice(0, 3).map(([k, v]) => (
            <span key={k} className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
              <span className="text-blue-400/60">{k}:</span>{" "}
              {typeof v === "string" ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
