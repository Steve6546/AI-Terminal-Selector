"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

interface StreamingBubbleProps {
  text: string;
  isThinking: boolean;
  hasActiveTool: boolean;
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

function StreamingBubbleInner({ text, isThinking, hasActiveTool }: StreamingBubbleProps) {
  const statusLabel = hasActiveTool
    ? "Executing tools..."
    : isThinking
    ? "Thinking..."
    : "Generating response...";

  return (
    <div className="w-full flex py-2 justify-start bg-secondary/20 border-y border-white/[0.02]">
      <div className="flex gap-4 max-w-4xl w-full px-6 flex-row">
        <div className="flex-shrink-0 mt-1">
          <div className={cn(
            "w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br from-primary to-accent border border-primary/30 glow-effect",
            !text && "animate-pulse"
          )}>
            <SparklesIcon className="w-5 h-5 text-white" />
          </div>
        </div>
        <div className="flex flex-col gap-2 min-w-0 flex-1 items-start">
          <div className="flex items-center gap-2 text-xs font-mono text-primary">
            <span>{statusLabel}</span>
          </div>
          <div className="text-sm leading-relaxed w-full text-foreground">
            {text ? (
              <p className="whitespace-pre-wrap">{text}</p>
            ) : (
              <span className="flex gap-1 mt-2">
                <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" />
                <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: "0.1s" }} />
                <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: "0.2s" }} />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const StreamingBubble = memo(StreamingBubbleInner);
