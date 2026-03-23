import { motion } from "framer-motion";
import { ShieldAlert, Check, X, Server, Wrench } from "lucide-react";
import type { ApprovalRequest } from "@/hooks/use-chat-stream";

interface ApprovalCardProps {
  approval: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalCard({ approval, onApprove, onReject }: ApprovalCardProps) {
  const inputEntries = Object.entries(approval.inputs);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 6 }}
      className="mx-6 my-3"
    >
      <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-orange-500/20 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <ShieldAlert className="w-5 h-5 text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-orange-300">Tool Requires Approval</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The agent wants to execute a tool marked as requiring explicit permission.
            </p>
          </div>
        </div>

        {/* Tool info */}
        <div className="px-5 py-3 border-b border-orange-500/10 flex flex-wrap gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-white font-mono">{approval.toolName}</span>
          </div>
          {approval.serverName && (
            <div className="flex items-center gap-2 text-sm">
              <Server className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{approval.serverName}</span>
            </div>
          )}
        </div>

        {/* Input preview */}
        {inputEntries.length > 0 && (
          <div className="px-5 py-3 border-b border-orange-500/10">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Arguments</p>
            <div className="grid gap-1.5">
              {inputEntries.slice(0, 6).map(([key, val]) => (
                <div key={key} className="flex items-start gap-2">
                  <span className="text-xs font-mono text-orange-300/70 min-w-[80px] flex-shrink-0">{key}:</span>
                  <span className="text-xs font-mono text-foreground/80 truncate">
                    {typeof val === "string" ? val : JSON.stringify(val)}
                  </span>
                </div>
              ))}
              {inputEntries.length > 6 && (
                <p className="text-xs text-muted-foreground">+{inputEntries.length - 6} more arguments</p>
              )}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="px-5 py-4 flex items-center gap-3">
          <button
            onClick={onApprove}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-400 transition-colors shadow-lg shadow-green-500/20"
          >
            <Check className="w-4 h-4" />
            Approve
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-semibold hover:bg-red-500/20 transition-colors"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
          <p className="text-xs text-muted-foreground ml-auto">
            Timeout: 5 min
          </p>
        </div>
      </div>
    </motion.div>
  );
}
