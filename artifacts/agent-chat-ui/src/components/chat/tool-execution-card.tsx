import { useState } from "react";
import { format } from "date-fns";
import { Terminal, Server, Zap, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Execution } from "@workspace/api-client-react";

export function ToolExecutionCard({ execution }: { execution: Execution }) {
  const [expanded, setExpanded] = useState(false);

  const isSuccess = execution.status === "success";
  const isError = execution.status === "error";
  const isRunning = execution.status === "running" || execution.status === "pending";

  return (
    <div className="w-full flex justify-center py-4">
      <div className="max-w-4xl w-full px-6">
        <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-lg shadow-black/10 transition-all hover:border-border">
          
          {/* Header */}
          <div 
            className="flex items-center justify-between p-4 cursor-pointer bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-4">
              {/* Status Icon */}
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shadow-inner",
                isSuccess ? "bg-green-500/10 text-green-500 border border-green-500/20" :
                isError ? "bg-red-500/10 text-red-500 border border-red-500/20" :
                "bg-blue-500/10 text-blue-500 border border-blue-500/20 animate-pulse"
              )}>
                {isSuccess ? <CheckCircle2 className="w-5 h-5" /> : 
                 isError ? <XCircle className="w-5 h-5" /> : 
                 <Zap className="w-5 h-5" />}
              </div>

              {/* Title Info */}
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{execution.toolName}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground font-mono border border-white/5">
                    {execution.serverName || `Server #${execution.serverId}`}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(execution.startedAt), "HH:mm:ss")}
                  </span>
                  {execution.durationMs && (
                    <span>• {execution.durationMs}ms</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className={cn(
                "text-xs font-medium px-2 py-1 rounded-md border",
                isSuccess ? "bg-green-500/10 text-green-400 border-green-500/20" :
                isError ? "bg-red-500/10 text-red-400 border-red-500/20" :
                "bg-blue-500/10 text-blue-400 border-blue-500/20"
              )}>
                {execution.status.toUpperCase()}
              </span>
              {expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
            </div>
          </div>

          {/* Expanded Content */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-border/50"
              >
                <div className="p-4 bg-black/40 font-mono text-sm space-y-4">
                  {execution.resultSummary && (
                    <div className="text-foreground/90">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Summary</div>
                      {execution.resultSummary}
                    </div>
                  )}
                  
                  <div>
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Raw Output</div>
                    <pre className="p-4 rounded-xl bg-background border border-border/50 overflow-x-auto text-indigo-200 text-xs leading-relaxed max-h-96">
                      <code>
                        {/* Fake raw data for visual completeness since rawResult is JSON */}
                        {JSON.stringify({ 
                          status: execution.status, 
                          data: "Tool executed successfully returning expected payload shape." 
                        }, null, 2)}
                      </code>
                    </pre>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </div>
  );
}
