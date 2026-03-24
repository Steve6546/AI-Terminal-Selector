import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Zap, Code, TerminalSquare, AlertTriangle, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useListMessages, useListExecutions, useCreateConversation, useTruncateMessagesFrom } from "@workspace/api-client-react";
import type { ChatMessage, Execution } from "@workspace/api-client-react";
import { useLocalSettings } from "@/hooks/use-local-settings";
import { useChatStream } from "@/hooks/use-chat-stream";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { ChatInput, type ToolParams } from "@/components/chat/chat-input";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ToolExecutionCard } from "@/components/chat/tool-execution-card";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import { LiveToolCard } from "@/components/chat/live-tool-card";
import { ApprovalCard } from "@/components/chat/approval-card";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { PageLoader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getListMessagesQueryKey } from "@workspace/api-client-react";

function friendlyErrorMessage(err: Error): string {
  const msg = err.message.toLowerCase();
  if (msg.includes("abort") || msg.includes("cancel")) return "The request was cancelled.";
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch"))
    return "Connection to the server failed. Check your network and try again.";
  if (msg.includes("timeout")) return "The request timed out. The server may be busy.";
  if (msg.includes("401") || msg.includes("403") || msg.includes("permission"))
    return "Permission denied. You may not have access to this resource.";
  if (msg.includes("404")) return "Resource not found. It may have been deleted.";
  if (msg.includes("429")) return "Too many requests. Please wait a moment and try again.";
  if (msg.includes("500") || msg.includes("502") || msg.includes("503"))
    return "The server encountered an error. Try again in a moment.";
  if (msg.includes("parse") || msg.includes("invalid json") || msg.includes("failed to parse"))
    return "Received an unexpected response from the server. This may be a temporary issue.";
  return "Something went wrong while sending your message. Please try again.";
}

function ErrorBanner({ error, onDismiss }: { error: Error; onDismiss: () => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        className="mx-6 mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-300 font-medium">{friendlyErrorMessage(error)}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => setDrawerOpen(true)}
                className="text-xs text-red-400/70 hover:text-red-300 transition-colors underline underline-offset-2"
              >
                View technical details
              </button>
              <button
                onClick={onDismiss}
                className="text-xs text-muted-foreground hover:text-white transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="bottom" className="h-[50vh] bg-card border-border flex flex-col">
          <SheetHeader className="shrink-0">
            <SheetTitle className="text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Technical Details
            </SheetTitle>
          </SheetHeader>
          <pre className="flex-1 overflow-auto text-xs font-mono text-red-300/80 bg-black/30 rounded-lg p-4 mt-4 whitespace-pre-wrap break-all">
            {error.stack ?? error.message}
          </pre>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function ChatPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const conversationId = params.id ? parseInt(params.id) : null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<{ text: string; attachmentIds?: number[]; toolParams?: ToolParams } | null>(null);
  const [streamError, setStreamError] = useState<Error | null>(null);

  const { model, setModel, mode, setMode } = useLocalSettings();
  const createMutation = useCreateConversation();
  const truncateMutation = useTruncateMessagesFrom();
  const queryClient = useQueryClient();

  const { data: messages, isLoading: loadingMessages } = useListMessages(
    conversationId ?? 0,
    { query: { enabled: !!conversationId, queryKey: ["messages", conversationId] } }
  );

  const { data: executions, isLoading: loadingExecutions } = useListExecutions(
    { conversationId: conversationId ?? undefined },
    { query: { enabled: !!conversationId, queryKey: ["executions", conversationId] } }
  );

  const {
    sendMessage,
    stopStream,
    isStreaming,
    streamedText,
    isThinking,
    thinkingLines,
    thinkingDone,
    liveTools,
    pendingApproval,
    resolveApproval,
  } = useChatStream({
    conversationId: conversationId || 0,
    model,
    mode,
    onError: (err) => setStreamError(err),
  });

  const hasActiveTool = liveTools.some((t) => t.phase !== "done");

  // Accumulate tool output lines across the session for the Terminal Output tab
  const [toolOutputLines, setToolOutputLines] = useState<string[]>([]);
  const [sessionErrorLines, setSessionErrorLines] = useState<string[]>([]);
  const seenToolStdout = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const tool of liveTools) {
      if (tool.stdout) {
        const key = `${tool.toolId}:${tool.stdout.length}`;
        if (!seenToolStdout.current.has(key)) {
          seenToolStdout.current.add(key);
          setToolOutputLines((prev) => [
            ...prev,
            `[${tool.toolName}] ${tool.stdout!}`,
          ]);
        }
      }
    }
  }, [liveTools]);

  useEffect(() => {
    if (streamError) {
      setSessionErrorLines((prev) => [...prev, streamError.message]);
    }
  }, [streamError]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, executions, streamedText, liveTools, isThinking]);

  const timelineItems = useMemo(() => {
    if (!messages && !executions) return [];

    type TimelineItem =
      | { type: "msg"; data: ChatMessage; time: number }
      | { type: "exec"; data: Execution; time: number };
    const items: TimelineItem[] = [];

    messages?.forEach((m) => items.push({ type: "msg", data: m, time: new Date(m.createdAt).getTime() }));
    executions?.forEach((e) => items.push({ type: "exec", data: e, time: new Date(e.startedAt).getTime() }));

    return items.sort((a, b) => a.time - b.time);
  }, [messages, executions]);

  useEffect(() => {
    if (conversationId && pendingMessage) {
      const { text, attachmentIds, toolParams } = pendingMessage;
      setPendingMessage(null);
      sendMessage(text, attachmentIds, toolParams);
    }
  }, [conversationId, pendingMessage, sendMessage]);

  const handleSend = useCallback((text: string, attachmentIds?: number[], toolParams?: ToolParams) => {
    setStreamError(null);
    if (!conversationId) {
      createMutation.mutate(
        { data: { title: "New Conversation" } },
        {
          onSuccess: (data) => {
            setPendingMessage({ text, attachmentIds, toolParams });
            setLocation(`/c/${data.id}`);
          }
        }
      );
      return;
    }
    sendMessage(text, attachmentIds, toolParams);
  }, [conversationId, createMutation, sendMessage, setLocation]);

  const handleRetry = useCallback((assistantMessageId: number, retryModel: string) => {
    if (!conversationId || isStreaming) return;
    setStreamError(null);

    const allMessages = messages ?? [];
    const assistantIdx = allMessages.findIndex((m) => m.id === assistantMessageId);
    if (assistantIdx < 0) return;
    const userMessage = assistantIdx > 0 ? allMessages[assistantIdx - 1] : null;
    if (!userMessage || userMessage.role !== "user") return;

    if (retryModel !== model) {
      setModel(retryModel as typeof model);
    }

    truncateMutation.mutate(
      { id: conversationId, messageId: userMessage.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: ["executions", conversationId] });
          sendMessage(userMessage.content, undefined, undefined, retryModel);
        }
      }
    );
  }, [conversationId, isStreaming, messages, model, setModel, truncateMutation, queryClient, sendMessage]);

  const handleEditResend = useCallback((userMessageId: number, newContent: string) => {
    if (!conversationId || isStreaming) return;
    setStreamError(null);

    truncateMutation.mutate(
      { id: conversationId, messageId: userMessageId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: ["executions", conversationId] });
          sendMessage(newContent);
        }
      }
    );
  }, [conversationId, isStreaming, truncateMutation, queryClient, sendMessage]);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col relative min-w-0 overflow-hidden">
        <TopBar model={model} onModelChange={setModel} onTerminalToggle={() => setShowTerminal((p) => !p)} />

        <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth">
          {!conversationId ? (
            <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-8">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="relative mb-8"
              >
                <div className="absolute inset-0 bg-primary/20 blur-[60px] rounded-full" />
                <img
                  src={`${import.meta.env.BASE_URL}images/empty-state-orb.png`}
                  alt="AI Orb"
                  className="w-48 h-48 object-cover rounded-full shadow-2xl relative z-10 animate-float"
                />
              </motion.div>

              <h1 className="text-3xl font-display font-bold text-white mb-3 text-center">
                Agent Tool Chat
              </h1>
              <p className="text-muted-foreground max-w-md text-center mb-10 leading-relaxed">
                Connect your MCP servers, databases, and APIs. Let Claude reason, plan, and execute complex workflows autonomously.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl">
                <div className="glass-panel p-4 rounded-2xl flex flex-col gap-3 hover:bg-white/5 transition-colors cursor-pointer group">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-blue-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Connect Servers</h3>
                    <p className="text-xs text-muted-foreground mt-1">Add MCP servers to give the agent new capabilities.</p>
                  </div>
                </div>
                <div className="glass-panel p-4 rounded-2xl flex flex-col gap-3 hover:bg-white/5 transition-colors cursor-pointer group">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <Code className="w-5 h-5 text-purple-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Write Workflows</h3>
                    <p className="text-xs text-muted-foreground mt-1">Ask the agent to combine multiple tools to solve a problem.</p>
                  </div>
                </div>
                <div className="glass-panel p-4 rounded-2xl flex flex-col gap-3 hover:bg-white/5 transition-colors cursor-pointer group">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <TerminalSquare className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Monitor Execution</h3>
                    <p className="text-xs text-muted-foreground mt-1">Watch live timelines as the agent plans and runs tools.</p>
                  </div>
                </div>
              </div>
            </div>
          ) : loadingMessages || loadingExecutions ? (
            <PageLoader />
          ) : (
            <div className="pb-8">
              {timelineItems.length === 0 && !isStreaming ? (
                <div className="h-[60vh] flex flex-col items-center justify-center text-center px-4">
                  <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4 shadow-lg border border-white/5">
                    <MessageSquare className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-2">Start a new conversation</h3>
                  <p className="text-muted-foreground text-sm max-w-sm">
                    Select Agent mode to let Claude decide how to use tools, or Tool mode to execute them manually.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col w-full">
                  {timelineItems.map((item, i) => (
                    <motion.div
                      key={`${item.type}-${item.data.id || i}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      {item.type === "msg"
                        ? (
                          <MessageBubble
                            message={item.data}
                            currentModel={model}
                            onRetry={item.data.role === "assistant" ? handleRetry : undefined}
                            onEditResend={item.data.role === "user" ? handleEditResend : undefined}
                          />
                        )
                        : <ToolExecutionCard execution={item.data} />
                      }
                    </motion.div>
                  ))}

                  {/* ── Live streaming section ── */}
                  <AnimatePresence>
                    {isStreaming && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col gap-3 py-4"
                      >
                        {/* Thinking panel */}
                        <AnimatePresence>
                          {(isThinking || thinkingLines.length > 0) && (
                            <ThinkingPanel
                              lines={thinkingLines}
                              isThinking={isThinking}
                              isDone={thinkingDone}
                            />
                          )}
                        </AnimatePresence>

                        {/* Live tool cards */}
                        {liveTools.length > 0 && (
                          <div className="px-6 flex flex-col gap-2">
                            {liveTools.map((tool) => (
                              <motion.div
                                key={tool.toolId}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                              >
                                <LiveToolCard tool={tool} />
                              </motion.div>
                            ))}
                          </div>
                        )}

                        {/* Approval card — inline in stream */}
                        <AnimatePresence>
                          {pendingApproval && (
                            <ApprovalCard
                              approval={pendingApproval}
                              onApprove={() => resolveApproval(true)}
                              onReject={() => resolveApproval(false)}
                            />
                          )}
                        </AnimatePresence>

                        {/* Streaming text bubble */}
                        <div className="w-full flex py-2 justify-start bg-secondary/20 border-y border-white/[0.02]">
                          <div className="flex gap-4 max-w-4xl w-full px-6 flex-row">
                            <div className="flex-shrink-0 mt-1">
                              <div className={cn(
                                "w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br from-primary to-accent border border-primary/30 glow-effect",
                                !streamedText && "animate-pulse"
                              )}>
                                <SparklesIcon className="w-5 h-5 text-white" />
                              </div>
                            </div>
                            <div className="flex flex-col gap-2 min-w-0 flex-1 items-start">
                              <div className="flex items-center gap-2 text-xs font-mono text-primary">
                                <span>
                                  {hasActiveTool
                                    ? "Executing tools..."
                                    : isThinking
                                    ? "Thinking..."
                                    : "Generating response..."}
                                </span>
                              </div>
                              <div className="text-sm leading-relaxed w-full text-foreground markdown-content">
                                {streamedText ? (
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{streamedText}</ReactMarkdown>
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
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Banner */}
        <AnimatePresence>
          {streamError && (
            <ErrorBanner error={streamError} onDismiss={() => setStreamError(null)} />
          )}
        </AnimatePresence>

        {/* Input Area */}
        <div className="w-full bg-gradient-to-t from-background via-background/95 to-transparent pt-2 shrink-0">
          <ChatInput
            onSend={handleSend}
            onStop={stopStream}
            isStreaming={isStreaming}
            mode={mode}
            onModeChange={setMode}
            conversationId={conversationId}
          />
        </div>

        {/* Terminal Panel */}
        <AnimatePresence>
          {showTerminal && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              className="overflow-hidden shrink-0"
            >
              <TerminalPanel
                onClose={() => setShowTerminal(false)}
                toolOutputLines={toolOutputLines}
                errorLines={sessionErrorLines}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}
