import { useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, Zap, Code2, AlignLeft, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Execution } from "@workspace/api-client-react";

function formatArgsSummary(args: Record<string, unknown> | undefined): string | null {
  if (!args || typeof args !== "object") return null;
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      const val = typeof v === "string"
        ? v.length > 30 ? `"${v.slice(0, 30)}..."` : `"${v}"`
        : JSON.stringify(v);
      return `${k}: ${val}`;
    })
    .join(", ") + (entries.length > 3 ? ` +${entries.length - 3} more` : "");
}

export function ToolExecutionCard({ execution }: { execution: Execution }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const isSuccess = execution.status === "success";
  const isError = execution.status === "error";
  const isRunning = execution.status === "running" || execution.status === "pending";
  const hasRaw = execution.rawResult != null;
  const hasArgs = execution.arguments != null && Object.keys(execution.arguments).length > 0;
  const argsSummary = formatArgsSummary(execution.arguments);

  return (
    <div className="w-full flex justify-center py-3">
      <div className="max-w-4xl w-full px-4 sm:px-6">
        <div className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-lg shadow-black/10 transition-all hover:border-border">
          <div
            className="flex items-center justify-between p-4 min-h-[56px] cursor-pointer bg-white/[0.02] hover:bg-white/[0.04] active:bg-white/[0.06] transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shadow-inner flex-shrink-0",
                  isSuccess
                    ? "bg-green-500/10 text-green-500 border border-green-500/20"
                    : isError
                    ? "bg-red-500/10 text-red-500 border border-red-500/20"
                    : "bg-blue-500/10 text-blue-500 border border-blue-500/20 animate-pulse"
                )}
              >
                {isSuccess ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : isError ? (
                  <XCircle className="w-5 h-5" />
                ) : (
                  <Zap className="w-5 h-5" />
                )}
              </div>

              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-foreground">{execution.toolName}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground font-mono border border-white/5 flex-shrink-0">
                    {execution.serverName ?? `Server #${execution.serverId}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    {format(new Date(execution.startedAt), "HH:mm:ss")}
                  </span>
                  {execution.durationMs != null && (
                    <span className="text-xs text-muted-foreground font-mono">• {execution.durationMs}ms</span>
                  )}
                  {argsSummary && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground/70 font-mono min-w-0">
                      <ArrowRight className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate max-w-[200px] sm:max-w-xs">{argsSummary}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 ml-2">
              <span
                className={cn(
                  "text-xs font-medium px-2 py-1 rounded-md border hidden sm:inline-flex",
                  isSuccess
                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                    : isError
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                )}
              >
                {execution.status.toUpperCase()}
              </span>
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </div>

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
                  {/* Tab selector for Summary / Raw */}
                  {hasRaw && (
                    <div className="flex gap-1 p-1 bg-black/30 rounded-lg border border-border/40 w-fit">
                      <button
                        onClick={() => setShowRaw(false)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                          !showRaw
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <AlignLeft className="w-3 h-3" /> Summary
                      </button>
                      <button
                        onClick={() => setShowRaw(true)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                          showRaw
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Code2 className="w-3 h-3" /> Raw Response
                      </button>
                    </div>
                  )}

                  {!showRaw ? (
                    <>
                      {/* Input arguments */}
                      {hasArgs && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                            Inputs
                          </div>
                          <pre className="p-3 rounded-xl bg-background border border-border/50 overflow-x-auto text-amber-200 text-xs leading-relaxed max-h-48">
                            <code>{JSON.stringify(execution.arguments, null, 2)}</code>
                          </pre>
                        </div>
                      )}

                      {execution.resultSummary && (
                        <div className="text-foreground/90">
                          <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                            Summary
                          </div>
                          {execution.resultSummary}
                        </div>
                      )}

                      <div>
                        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                          Execution Details
                        </div>
                        <pre className="p-4 rounded-xl bg-background border border-border/50 overflow-x-auto text-indigo-200 text-xs leading-relaxed max-h-96">
                          <code>
                            {JSON.stringify(
                              {
                                id: execution.id,
                                toolName: execution.toolName,
                                serverName: execution.serverName,
                                status: execution.status,
                                startedAt: execution.startedAt,
                                completedAt: execution.completedAt,
                                durationMs: execution.durationMs,
                              },
                              null,
                              2
                            )}
                          </code>
                        </pre>
                      </div>
                    </>
                  ) : (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                        Raw Response
                      </div>
                      <pre className="p-4 rounded-xl bg-background border border-border/50 overflow-x-auto text-emerald-200 text-xs leading-relaxed max-h-96">
                        <code>
                          {JSON.stringify(execution.rawResult, null, 2)}
                        </code>
                      </pre>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
