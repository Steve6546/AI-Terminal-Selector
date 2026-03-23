import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAnthropicMessagesQueryKey, getListExecutionsQueryKey, getListAnthropicConversationsQueryKey } from "@workspace/api-client-react";

export interface LiveToolExecution {
  phase: "planning" | "starting" | "selecting-server" | "running" | "done";
  executionId?: number;
  toolName?: string;
  serverId?: number | null;
  serverName?: string | null;
  success?: boolean;
  durationMs?: number;
  message?: string;
}

interface StreamOptions {
  conversationId: number;
  model: string;
  mode?: string;
  onFinish?: () => void;
  onError?: (err: Error) => void;
}

export function useChatStream({ conversationId, model, mode = "agent", onFinish, onError }: StreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [liveExecutions, setLiveExecutions] = useState<LiveToolExecution[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const sendMessage = useCallback(async (content: string, attachmentIds?: number[]) => {
    setIsStreaming(true);
    setStreamedText("");
    setLiveExecutions([]);

    abortControllerRef.current = new AbortController();

    try {
      const body: Record<string, unknown> = { content, model, mode };
      if (attachmentIds && attachmentIds.length > 0) {
        body.attachmentIds = attachmentIds;
      }

      const response = await fetch(`/api/anthropic/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      outer: while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6);
          if (dataStr.trim() === "") continue;

          try {
            const data = JSON.parse(dataStr) as Record<string, unknown>;

            if (data.done) {
              break outer;
            } else if (data.content) {
              setStreamedText((prev) => prev + (data.content as string));
            } else if (data.tool_execution) {
              const exec = data.tool_execution as LiveToolExecution;
              setLiveExecutions((prev) => {
                if (exec.phase === "planning") {
                  const hasPlan = prev.some((e) => e.phase === "planning");
                  if (hasPlan) return prev.map((e) => e.phase === "planning" ? { ...e, ...exec } : e);
                  return [exec, ...prev];
                }
                if (exec.phase === "starting") {
                  // Remove planning indicator when first tool starts
                  const without = prev.filter((e) => e.phase !== "planning");
                  return [...without, exec];
                }
                // For running/selecting-server/done: match by executionId if known, else by toolName
                // This handles the case where "starting" had no executionId yet
                return prev.map((e) => {
                  const idMatch = exec.executionId != null && e.executionId === exec.executionId;
                  const nameMatch = e.toolName === exec.toolName && e.executionId == null;
                  return (idMatch || nameMatch) ? { ...e, ...exec } : e;
                });
              });
            } else if (data.error) {
              console.error("Stream error from server:", data.error);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === "AbortError") {
        // User stopped — normal
      } else {
        console.error("Stream error:", error);
        onError?.(error);
      }
    } finally {
      setIsStreaming(false);
      setLiveExecutions([]);
      queryClient.invalidateQueries({
        queryKey: getListAnthropicMessagesQueryKey(conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: getListExecutionsQueryKey({ conversationId }),
      });
      queryClient.invalidateQueries({
        queryKey: getListAnthropicConversationsQueryKey(),
      });
      onFinish?.();
    }
  }, [conversationId, model, mode, queryClient, onFinish, onError]);

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setLiveExecutions([]);
  }, []);

  return {
    sendMessage,
    stopStream,
    isStreaming,
    streamedText,
    liveExecutions,
  };
}
