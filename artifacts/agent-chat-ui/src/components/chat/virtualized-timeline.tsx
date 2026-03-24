"use client";

import { useRef, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MessageBubble } from "./message-bubble";
import { ToolExecutionCard } from "./tool-execution-card";
import type { ChatMessage, Execution } from "@workspace/api-client-react";

export type TimelineItem =
  | { type: "msg"; data: ChatMessage; time: number }
  | { type: "exec"; data: Execution; time: number };

interface VirtualizedTimelineProps {
  items: TimelineItem[];
  model: string;
  onRetry?: (messageId: number, model: string) => void;
  onEditResend?: (messageId: number, newContent: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function VirtualizedTimeline({
  items,
  model,
  onRetry,
  onEditResend,
  scrollRef,
}: VirtualizedTimelineProps) {
  const prevCountRef = useRef(items.length);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = items[index];
      if (item.type === "exec") return 72;
      return item.data.role === "user" ? 100 : 200;
    },
    overscan: 5,
  });

  useEffect(() => {
    if (items.length > prevCountRef.current) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(items.length - 1, { align: "end" });
      });
    }
    prevCountRef.current = items.length;
  }, [items.length, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: "100%",
        position: "relative",
      }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {item.type === "msg" ? (
              <MessageBubble
                message={item.data}
                currentModel={model}
                onRetry={item.data.role === "assistant" ? onRetry : undefined}
                onEditResend={item.data.role === "user" ? onEditResend : undefined}
              />
            ) : (
              <ToolExecutionCard execution={item.data} />
            )}
          </div>
        );
      })}
    </div>
  );
}
