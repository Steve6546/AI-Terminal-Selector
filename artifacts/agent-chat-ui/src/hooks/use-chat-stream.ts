import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAnthropicMessagesQueryKey, getListExecutionsQueryKey, getListAnthropicConversationsQueryKey, autoNameAnthropicConversation } from "@workspace/api-client-react";

// ─── Typed event shapes (mirrors backend RunEvent) ──────────────────────────

export type RunEventType =
  | "run.created" | "model.started"
  | "thinking.started" | "thinking.delta" | "thinking.completed"
  | "text.delta"
  | "tool.started" | "tool.stdout" | "tool.completed" | "tool.approval_required"
  | "artifact.created"
  | "run.completed" | "run.failed";

export interface RunEvent {
  type: RunEventType;
  run_id?: string;
  [key: string]: unknown;
}

// ─── Live tool state ─────────────────────────────────────────────────────────

export type LiveToolPhase = "starting" | "running" | "approval_required" | "done";

export interface LiveTool {
  toolId: string;
  toolName: string;
  serverId?: number | null;
  serverName?: string | null;
  inputs?: Record<string, unknown>;
  phase: LiveToolPhase;
  stdout?: string;
  executionId?: number | null;
  success?: boolean;
  durationMs?: number;
  error?: string;
}

// ─── Approval request ────────────────────────────────────────────────────────

export interface ApprovalRequest {
  runId: string;
  toolId: string;
  toolName: string;
  serverName: string | null;
  inputs: Record<string, unknown>;
  conversationId: number;
}

// ─── Legacy compatibility (for ToolExecutionCard still in history) ───────────
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
  onAutoNamed?: (title: string) => void;
}

export function useChatStream({ conversationId, model, mode = "agent", onFinish, onError, onAutoNamed }: StreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  // Thinking state
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingLines, setThinkingLines] = useState<string[]>([]);
  const [thinkingDone, setThinkingDone] = useState(false);

  // Live tool state (new)
  const [liveTools, setLiveTools] = useState<LiveTool[]>([]);

  // Pending approval
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const updateTool = useCallback((toolId: string, update: Partial<LiveTool>) => {
    setLiveTools((prev) => {
      const idx = prev.findIndex((t) => t.toolId === toolId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...update };
      return next;
    });
  }, []);

  const sendMessage = useCallback(async (
    content: string,
    attachmentIds?: number[],
    toolParams?: { serverId: number; toolName: string; toolArgs: Record<string, unknown> },
    modelOverride?: string
  ) => {
    setIsStreaming(true);
    setStreamedText("");
    setLiveTools([]);
    setIsThinking(false);
    setThinkingLines([]);
    setThinkingDone(false);
    setRunId(null);
    setPendingApproval(null);

    abortControllerRef.current = new AbortController();

    try {
      const body: Record<string, unknown> = { content, model: modelOverride ?? model, mode };
      if (attachmentIds && attachmentIds.length > 0) body.attachmentIds = attachmentIds;
      if (toolParams) {
        body.selectedServerId = toolParams.serverId;
        body.selectedToolName = toolParams.toolName;
        body.toolArgs = toolParams.toolArgs;
      }

      const response = await fetch(`/api/anthropic/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
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

            // ── Handle typed events (new protocol) ────────────────────────
            if (typeof data.type === "string") {
              const event = data as RunEvent;

              switch (event.type) {
                case "run.created":
                  setRunId(event.run_id ?? null);
                  break;

                case "model.started":
                  break;

                case "thinking.started":
                  setIsThinking(true);
                  setThinkingDone(false);
                  if (event.message) setThinkingLines([event.message as string]);
                  break;

                case "thinking.delta":
                  if (event.content) {
                    setThinkingLines((prev) => [...prev, event.content as string]);
                  }
                  break;

                case "thinking.completed":
                  setIsThinking(false);
                  setThinkingDone(true);
                  break;

                case "text.delta":
                  if (event.content) setStreamedText((prev) => prev + (event.content as string));
                  break;

                case "tool.started": {
                  const newTool: LiveTool = {
                    toolId: event.tool_id as string,
                    toolName: event.tool_name as string,
                    serverId: event.server_id as number | null,
                    serverName: event.server_name as string | null,
                    inputs: event.inputs as Record<string, unknown>,
                    phase: "running",
                  };
                  setLiveTools((prev) => [...prev, newTool]);
                  break;
                }

                case "tool.stdout":
                  updateTool(event.tool_id as string, {
                    stdout: event.content as string,
                  });
                  break;

                case "tool.completed":
                  updateTool(event.tool_id as string, {
                    phase: "done",
                    executionId: event.execution_id as number | null,
                    success: event.success as boolean,
                    durationMs: event.duration_ms as number,
                    error: event.error as string | undefined,
                  });
                  break;

                case "tool.approval_required": {
                  const currentRunId = event.run_id ?? "";
                  updateTool(event.tool_id as string, { phase: "approval_required" });
                  // If no matching tool yet, create one
                  setLiveTools((prev) => {
                    const hasIt = prev.some((t) => t.toolId === (event.tool_id as string));
                    if (hasIt) return prev;
                    return [...prev, {
                      toolId: event.tool_id as string,
                      toolName: event.tool_name as string,
                      serverName: event.server_name as string | null,
                      inputs: event.inputs as Record<string, unknown>,
                      phase: "approval_required",
                    }];
                  });
                  setPendingApproval({
                    runId: currentRunId,
                    toolId: event.tool_id as string,
                    toolName: event.tool_name as string,
                    serverName: event.server_name as string | null,
                    inputs: event.inputs as Record<string, unknown>,
                    conversationId,
                  });
                  break;
                }

                case "artifact.created":
                  // Large tool result — stdout already surfaced via tool.stdout event
                  break;

                case "run.completed":
                  break outer;

                case "run.failed":
                  onError?.(new Error(typeof event.error === "string" ? event.error : "Run failed"));
                  return;
              }
              continue;
            }

            // ── Legacy event format (backward compat) ─────────────────────
            if (data.done) {
              break outer;
            } else if (data.content) {
              setStreamedText((prev) => prev + (data.content as string));
            } else if (data.tool_execution) {
              // legacy tool_execution events — map to liveTools for any old format consumers
            } else if (data.error) {
              const streamErr = new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
              onError?.(streamErr);
              return;
            }
          } catch {
            // non-fatal parse error
          }
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name !== "AbortError") {
        console.error("Stream error:", error);
        onError?.(error);
      }
      return;
    } finally {
      setIsStreaming(false);
      setIsThinking(false);
      setPendingApproval(null);
      queryClient.invalidateQueries({ queryKey: getListAnthropicMessagesQueryKey(conversationId) });
      queryClient.invalidateQueries({ queryKey: getListExecutionsQueryKey({ conversationId }) });
      queryClient.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
      onFinish?.();
    }

    autoNameAnthropicConversation(conversationId)
      .then((result) => {
        queryClient.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
        onAutoNamed?.(result.title);
      })
      .catch(() => {});
  }, [conversationId, model, mode, queryClient, onFinish, onError, onAutoNamed, updateTool]);

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setIsThinking(false);
    setLiveTools([]);
    setPendingApproval(null);
  }, []);

  // Approve or reject a pending tool
  const resolveApproval = useCallback(async (approve: boolean) => {
    if (!pendingApproval) return;
    const { runId: rid, toolId, conversationId: cid } = pendingApproval;
    setPendingApproval(null);

    updateTool(toolId, { phase: approve ? "running" : "done", success: approve ? undefined : false });

    try {
      await fetch(`/api/anthropic/conversations/${cid}/runs/${rid}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_id: toolId, approved: approve }),
      });
    } catch (err) {
      console.error("Approval request failed:", err);
    }
  }, [pendingApproval, updateTool]);

  // Legacy compatibility: map liveTools to liveExecutions format
  const liveExecutions: LiveToolExecution[] = liveTools.map((t) => ({
    phase: t.phase === "approval_required" ? "running" : t.phase === "starting" ? "starting" : t.phase === "done" ? "done" : "running",
    executionId: t.executionId ?? undefined,
    toolName: t.toolName,
    serverId: t.serverId,
    serverName: t.serverName,
    success: t.success,
    durationMs: t.durationMs,
  }));

  return {
    sendMessage,
    stopStream,
    isStreaming,
    streamedText,
    runId,
    // New state
    isThinking,
    thinkingLines,
    thinkingDone,
    liveTools,
    pendingApproval,
    resolveApproval,
    // Legacy compat
    liveExecutions,
  };
}
