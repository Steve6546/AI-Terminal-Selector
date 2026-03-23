import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingPanelProps {
  lines: string[];
  isThinking: boolean;
  isDone: boolean;
}

export function ThinkingPanel({ lines, isThinking, isDone }: ThinkingPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (lines.length === 0 && !isThinking) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="w-full px-6"
    >
      <div className={cn(
        "rounded-xl border overflow-hidden transition-colors",
        isThinking
          ? "border-violet-500/30 bg-violet-500/5"
          : isDone
          ? "border-white/5 bg-white/[0.02]"
          : "border-violet-500/20 bg-violet-500/5"
      )}>
        {/* Header */}
        <button
          onClick={() => setCollapsed((p) => !p)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
        >
          <Brain className={cn(
            "w-3.5 h-3.5 flex-shrink-0",
            isThinking ? "text-violet-400 animate-pulse" : "text-violet-400/60"
          )} />
          <span className={cn(
            "text-xs font-mono flex-1",
            isThinking ? "text-violet-300" : "text-violet-400/60"
          )}>
            {isThinking ? "Thinking..." : `${lines.length} planning step${lines.length !== 1 ? "s" : ""}`}
          </span>
          {isThinking && (
            <span className="flex gap-1 mr-1">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-bounce" style={{ animationDelay: "100ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-bounce" style={{ animationDelay: "200ms" }} />
            </span>
          )}
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </button>

        {/* Lines */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 pt-1 flex flex-col gap-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                {lines.map((line, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.03 * i }}
                    className="flex items-start gap-2"
                  >
                    <span className="w-4 text-[10px] font-mono text-violet-500/50 mt-0.5 flex-shrink-0 text-right">
                      {i + 1}.
                    </span>
                    <span className="text-xs text-violet-200/70 leading-relaxed">{line}</span>
                  </motion.div>
                ))}
                {isThinking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 pl-6"
                  >
                    <span className="text-xs text-violet-400/50 italic">planning next step...</span>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
