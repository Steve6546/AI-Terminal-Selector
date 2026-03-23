import { useState, useRef, useEffect, useCallback } from "react";
import {
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
  useTestMcpServerConnection,
  getListMcpServersQueryKey,
} from "@workspace/api-client-react";
import type { McpServer } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  X,
  Send,
  Bot,
  Loader2,
  Check,
  Ban,
  Server,
  Trash2,
  Power,
  Zap,
  Edit3,
  Copy,
  Activity,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ActionData {
  id: string;
  name: string;
  args: Record<string, unknown>;
  requiresConfirmation: boolean;
  status: "pending" | "executing" | "done" | "cancelled" | "error";
  errorMessage?: string;
}

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "status";
  content: string;
  isStreaming?: boolean;
  action?: ActionData;
  timestamp: Date;
}

// ─── Action icon + label helpers ────────────────────────────────────────────

function actionIcon(name: string) {
  if (name === "create_server") return <Server className="w-4 h-4 text-green-400" />;
  if (name === "edit_server") return <Edit3 className="w-4 h-4 text-blue-400" />;
  if (name === "delete_server") return <Trash2 className="w-4 h-4 text-red-400" />;
  if (name === "toggle_server") return <Power className="w-4 h-4 text-yellow-400" />;
  if (name === "test_server") return <Activity className="w-4 h-4 text-purple-400" />;
  if (name === "clone_server") return <Copy className="w-4 h-4 text-indigo-400" />;
  return <Zap className="w-4 h-4 text-primary" />;
}

function actionLabel(name: string, args: Record<string, unknown>) {
  if (name === "create_server") return `Create "${args.name}"`;
  if (name === "edit_server") return `Edit "${args.serverName}"`;
  if (name === "delete_server") return `Delete "${args.serverName}"`;
  if (name === "toggle_server") return `${args.enabled ? "Enable" : "Disable"} "${args.serverName}"`;
  if (name === "test_server") return `Test "${args.serverName}"`;
  if (name === "clone_server") return `Clone "${args.serverName}" → "${args.newName}"`;
  return name;
}

function actionDescription(name: string, args: Record<string, unknown>) {
  if (name === "create_server") {
    const parts: string[] = [];
    if (args.transportType) parts.push(String(args.transportType));
    if (args.endpoint) parts.push(String(args.endpoint));
    if (args.command) parts.push(String(args.command));
    if (args.authType && args.authType !== "none") parts.push(`auth: ${args.authType}`);
    return parts.join(" · ");
  }
  if (name === "edit_server") {
    const changes: string[] = [];
    if (args.name) changes.push(`name: ${args.name}`);
    if (args.endpoint) changes.push(`endpoint: ${args.endpoint}`);
    if (args.authType) changes.push(`auth: ${args.authType}`);
    if (args.timeout !== undefined) changes.push(`timeout: ${args.timeout}s`);
    if (args.retryCount !== undefined) changes.push(`retries: ${args.retryCount}`);
    if (args.enabled !== undefined) changes.push(args.enabled ? "enable" : "disable");
    return changes.join(" · ") || "Update server settings";
  }
  if (name === "delete_server") return "This action is permanent and cannot be undone.";
  if (name === "toggle_server") return args.enabled ? "Allow agent to use this server." : "Prevent agent from using this server.";
  if (name === "test_server") return "Check if the server responds correctly.";
  if (name === "clone_server") return `Duplicate with all the same settings.`;
  return "";
}

function actionColor(name: string) {
  if (name === "delete_server") return "border-red-500/30 bg-red-500/5";
  if (name === "create_server") return "border-green-500/30 bg-green-500/5";
  if (name === "edit_server") return "border-blue-500/30 bg-blue-500/5";
  if (name === "toggle_server") return "border-yellow-500/30 bg-yellow-500/5";
  return "border-primary/30 bg-primary/5";
}

// ─── Action Card ─────────────────────────────────────────────────────────────

function ActionCard({
  action,
  onConfirm,
  onCancel,
}: {
  action: ActionData;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={cn("rounded-xl border p-3 mt-2 space-y-2", actionColor(action.name))}>
      <div className="flex items-center gap-2">
        {actionIcon(action.name)}
        <span className="text-sm font-medium text-white">{actionLabel(action.name, action.args)}</span>
      </div>
      {actionDescription(action.name, action.args) && (
        <p className="text-xs text-muted-foreground pl-6">{actionDescription(action.name, action.args)}</p>
      )}
      {action.status === "pending" && (
        <div className="flex items-center gap-2 pt-1 pl-6">
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Check className="w-3 h-3" />
            Confirm
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-muted-foreground text-xs rounded-lg hover:text-white transition-colors"
          >
            <Ban className="w-3 h-3" />
            Cancel
          </button>
        </div>
      )}
      {action.status === "executing" && (
        <div className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Executing…
        </div>
      )}
      {action.status === "done" && (
        <div className="flex items-center gap-2 pl-6 text-xs text-green-400">
          <Check className="w-3 h-3" />
          Done
        </div>
      )}
      {action.status === "cancelled" && (
        <div className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
          <Ban className="w-3 h-3" />
          Cancelled
        </div>
      )}
      {action.status === "error" && (
        <div className="flex items-center gap-2 pl-6 text-xs text-red-400">
          <X className="w-3 h-3" />
          {action.errorMessage ?? "Action failed"}
        </div>
      )}
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/40 border border-white/5 rounded-full text-xs text-muted-foreground w-fit mx-auto my-1">
      <Loader2 className="w-3 h-3 animate-spin" />
      {text}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onConfirmAction,
  onCancelAction,
}: {
  message: AgentMessage;
  onConfirmAction: (msgId: string) => void;
  onCancelAction: (msgId: string) => void;
}) {
  if (message.role === "status") {
    return <StatusPill text={message.content} />;
  }

  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-2.5 items-start", isUser && "flex-row-reverse")}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-indigo-300" />
        </div>
      )}
      <div className={cn("max-w-[85%] space-y-1", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-white rounded-tr-sm"
              : "bg-secondary/60 text-white/90 rounded-tl-sm border border-white/5"
          )}
        >
          {message.content || (message.isStreaming ? <TypingDots /> : null)}
          {message.isStreaming && message.content && (
            <span className="inline-block w-0.5 h-3.5 bg-white/60 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
        {message.action && (
          <ActionCard
            action={message.action}
            onConfirm={() => onConfirmAction(message.id)}
            onCancel={() => onCancelAction(message.id)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "اعرض لي كل الخوادم",
  "Add a new HTTP server",
  "Disable all error servers",
  "What's the status of my servers?",
];

// ─── Main Sidebar Component ───────────────────────────────────────────────────

export default function McpAgentSidebar({
  open,
  onClose,
  servers,
}: {
  open: boolean;
  onClose: () => void;
  servers: McpServer[];
}) {
  const queryClient = useQueryClient();
  const createMutation = useCreateMcpServer();
  const updateMutation = useUpdateMcpServer();
  const deleteMutation = useDeleteMcpServer();
  const testMutation = useTestMcpServerConnection();

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = useCallback((msg: Omit<AgentMessage, "id" | "timestamp">) => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const full: AgentMessage = { ...msg, id, timestamp: new Date() };
    setMessages((prev) => [...prev, full]);
    return id;
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<AgentMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  }, []);

  const updateAction = useCallback((msgId: string, updates: Partial<ActionData>) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.action
          ? { ...m, action: { ...m.action, ...updates } }
          : m
      )
    );
  }, []);

  const getHistory = useCallback(() => {
    return messages
      .filter((m) => m.role === "user" || (m.role === "assistant" && !m.isStreaming))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;
      const userText = text.trim();
      setInput("");

      addMessage({ role: "user", content: userText });

      const history = getHistory();
      const assistantId = addMessage({ role: "assistant", content: "", isStreaming: true });

      setIsStreaming(true);

      const abort = new AbortController();
      streamAbortRef.current = abort;

      try {
        const resp = await fetch("/api/mcp-agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userText, history, servers }),
          signal: abort.signal,
        });

        if (!resp.ok || !resp.body) {
          throw new Error(`Request failed: ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            if (event.type === "text") {
              accText += String(event.content ?? "");
              updateMessage(assistantId, { content: accText, isStreaming: true });
            } else if (event.type === "action") {
              const rawAction = event.action as {
                id: string;
                name: string;
                args: Record<string, unknown>;
                requiresConfirmation: boolean;
              };
              updateMessage(assistantId, {
                action: {
                  id: rawAction.id,
                  name: rawAction.name,
                  args: rawAction.args,
                  requiresConfirmation: rawAction.requiresConfirmation,
                  status: "pending",
                },
              });
            } else if (event.type === "done") {
              updateMessage(assistantId, { isStreaming: false });
            } else if (event.type === "error") {
              updateMessage(assistantId, {
                content: accText + "\n\nSomething went wrong. Please try again.",
                isStreaming: false,
              });
            }
          }
        }

        updateMessage(assistantId, { isStreaming: false });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        updateMessage(assistantId, {
          content: "Connection error. Please try again.",
          isStreaming: false,
        });
      } finally {
        setIsStreaming(false);
        streamAbortRef.current = null;
      }
    },
    [isStreaming, servers, addMessage, getHistory, updateMessage]
  );

  const executeAction = useCallback(
    async (msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg?.action) return;
      const { name, args } = msg.action;

      updateAction(msgId, { status: "executing" });

      const invalidate = () => queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });

      try {
        if (name === "create_server" || name === "clone_server") {
          await new Promise<void>((resolve, reject) => {
            createMutation.mutate(
              {
                data: {
                  name: String(args.name ?? args.newName ?? "New Server"),
                  description: args.description ? String(args.description) : undefined,
                  transportType: String(args.transportType ?? "streamable-http") as "streamable-http" | "stdio",
                  endpoint: args.endpoint ? String(args.endpoint) : undefined,
                  command: args.command ? String(args.command) : undefined,
                  args: args.args ? String(args.args).split(/\s+/) : [],
                  authType: String(args.authType ?? "none") as "none" | "bearer" | "api-key",
                  timeout: Number(args.timeout ?? 30),
                  retryCount: Number(args.retryCount ?? 3),
                  enabled: args.enabled !== false,
                },
              },
              { onSuccess: () => { invalidate(); resolve(); }, onError: reject }
            );
          });
        } else if (name === "edit_server" || name === "toggle_server") {
          const serverId = Number(args.serverId);
          const updateData: Record<string, unknown> = {};
          if (args.name !== undefined) updateData.name = String(args.name);
          if (args.description !== undefined) updateData.description = String(args.description);
          if (args.endpoint !== undefined) updateData.endpoint = String(args.endpoint);
          if (args.command !== undefined) updateData.command = String(args.command);
          if (args.args !== undefined) updateData.args = String(args.args).split(/\s+/);
          if (args.authType !== undefined) updateData.authType = String(args.authType);
          if (args.timeout !== undefined) updateData.timeout = Number(args.timeout);
          if (args.retryCount !== undefined) updateData.retryCount = Number(args.retryCount);
          if (args.enabled !== undefined) updateData.enabled = Boolean(args.enabled);

          await new Promise<void>((resolve, reject) => {
            updateMutation.mutate(
              { id: serverId, data: updateData as Parameters<typeof updateMutation.mutate>[0]["data"] },
              { onSuccess: () => { invalidate(); resolve(); }, onError: reject }
            );
          });
        } else if (name === "delete_server") {
          const serverId = Number(args.serverId);
          await new Promise<void>((resolve, reject) => {
            deleteMutation.mutate(
              { id: serverId },
              { onSuccess: () => { invalidate(); resolve(); }, onError: reject }
            );
          });
        } else if (name === "test_server") {
          const serverId = Number(args.serverId);
          await new Promise<void>((resolve, reject) => {
            testMutation.mutate(
              { id: serverId },
              { onSuccess: () => { invalidate(); resolve(); }, onError: reject }
            );
          });
        }

        updateAction(msgId, { status: "done" });

        const doneMessages: Record<string, string> = {
          create_server: `✓ Server "${args.name}" was created successfully.`,
          clone_server: `✓ Cloned to "${args.newName}" successfully.`,
          edit_server: `✓ "${args.serverName}" was updated.`,
          toggle_server: `✓ "${args.serverName}" is now ${args.enabled ? "enabled" : "disabled"}.`,
          delete_server: `✓ "${args.serverName}" was deleted.`,
          test_server: `✓ Connection test for "${args.serverName}" completed.`,
        };
        if (doneMessages[name]) {
          addMessage({ role: "assistant", content: doneMessages[name] });
        }
      } catch {
        updateAction(msgId, { status: "error", errorMessage: "Action failed. Please try again." });
      }
    },
    [messages, addMessage, updateAction, createMutation, updateMutation, deleteMutation, testMutation, queryClient]
  );

  const cancelAction = useCallback(
    (msgId: string) => {
      updateAction(msgId, { status: "cancelled" });
      addMessage({ role: "assistant", content: "Cancelled. Let me know if you want to do something else." });
    },
    [updateAction, addMessage]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* Backdrop — only visible on small screens */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed top-0 right-0 h-full w-[380px] z-40 flex flex-col",
          "bg-[#0f0f14] border-l border-white/8 shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-white/10 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">MCP Assistant</p>
              <p className="text-[10px] text-muted-foreground leading-tight">
                {servers.length} server{servers.length !== 1 ? "s" : ""} · gpt-5.2
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors text-xs"
                title="Clear chat"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center pb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/8 flex items-center justify-center">
                <Bot className="w-7 h-7 text-indigo-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-white mb-1">MCP Server Assistant</p>
                <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">
                  Ask me to add, edit, test, or manage your MCP servers using natural language.
                </p>
              </div>
              <div className="flex flex-col gap-1.5 w-full mt-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="w-full text-left px-3 py-2 rounded-xl bg-secondary/40 border border-white/5 text-xs text-muted-foreground hover:text-white hover:bg-secondary/70 transition-colors flex items-center justify-between group"
                  >
                    <span>{prompt}</span>
                    <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onConfirmAction={executeAction}
                onCancelAction={cancelAction}
              />
            ))
          )}

          {isStreaming && messages.at(-1)?.isStreaming === false && (
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-white/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3.5 h-3.5 text-indigo-300" />
              </div>
              <div className="bg-secondary/60 border border-white/5 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-white/8 p-3">
          <div className="flex items-end gap-2 bg-secondary/40 border border-white/8 rounded-2xl px-3 py-2 focus-within:border-primary/40 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder="Ask me to manage your servers…"
              rows={1}
              className="flex-1 bg-transparent text-sm text-white placeholder:text-muted-foreground resize-none outline-none max-h-32 leading-relaxed"
              style={{ scrollbarWidth: "none" }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isStreaming}
              className={cn(
                "p-2 rounded-xl transition-all flex-shrink-0",
                input.trim() && !isStreaming
                  ? "bg-primary text-white hover:bg-primary/90"
                  : "bg-secondary text-muted-foreground cursor-not-allowed"
              )}
            >
              {isStreaming ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 text-center mt-2">
            Enter ↵ to send · Shift+Enter for new line
          </p>
        </div>
      </aside>
    </>
  );
}
