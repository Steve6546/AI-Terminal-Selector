import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { format } from "date-fns";
import { User, Sparkles, Copy, Check, RotateCcw, Edit2, Send, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnthropicMessage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import TextareaAutosize from "react-textarea-autosize";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AVAILABLE_MODELS } from "@/hooks/use-local-settings";

interface MessageBubbleProps {
  message: AnthropicMessage;
  currentModel?: string;
  onRetry?: (messageId: number, model: string) => void;
  onEditResend?: (messageId: number, newContent: string) => void;
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className ?? "");
  const code = String(children).replace(/\n$/, "");

  if (match) {
    return (
      <div className="rounded-xl overflow-hidden my-4 border border-white/10 shadow-lg bg-[#1e1e1e]">
        <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/5">
          <span className="text-xs font-mono text-muted-foreground">{match[1]}</span>
        </div>
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={match[1]}
          PreTag="div"
          customStyle={{ margin: 0, padding: "1rem", background: "transparent" }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code className={cn("bg-white/10 px-1.5 py-0.5 rounded-md font-mono text-[0.85em] text-indigo-300", className)}>
      {children}
    </code>
  );
}

export function MessageBubble({ message, currentModel, onRetry, onEditResend }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const { toast } = useToast();

  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      toast({ description: "Copied to clipboard", duration: 2000 });
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content, toast]);

  const handleRetryWithModel = useCallback((model: string) => {
    onRetry?.(message.id, model);
  }, [message.id, onRetry]);

  const handleEditSubmit = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false);
      setEditText(message.content);
      return;
    }
    onEditResend?.(message.id, trimmed);
    setIsEditing(false);
  }, [editText, message.content, message.id, onEditResend]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditText(message.content);
  }, [message.content]);

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    } else if (e.key === "Escape") {
      handleEditCancel();
    }
  };

  return (
    <div
      className={cn(
        "w-full flex py-6 group/bubble",
        isUser ? "justify-end" : "justify-start bg-secondary/20 border-y border-white/[0.02]"
      )}
    >
      <div
        className={cn(
          "flex gap-4 max-w-4xl w-full px-4 sm:px-6",
          isUser ? "flex-row-reverse" : "flex-row"
        )}
      >
        <div className="flex-shrink-0 mt-1">
          <div
            className={cn(
              "w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg",
              isUser
                ? "bg-background border border-white/10"
                : "bg-gradient-to-br from-primary to-accent border border-primary/30 glow-effect"
            )}
          >
            {isUser ? (
              <User className="w-5 h-5 text-muted-foreground" />
            ) : (
              <Sparkles className="w-5 h-5 text-white" />
            )}
          </div>
        </div>

        <div className={cn("flex flex-col gap-2 min-w-0 flex-1", isUser ? "items-end" : "items-start")}>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span>{isUser ? "You" : (message.model ?? "Agent")}</span>
            <span>•</span>
            <span>{format(new Date(message.createdAt), "h:mm a")}</span>
          </div>

          {isEditing && isUser ? (
            <div className="w-full max-w-xl">
              <TextareaAutosize
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleEditKeyDown}
                autoFocus
                className="w-full bg-secondary border border-primary/50 rounded-2xl rounded-tr-sm px-5 py-3 text-sm text-foreground outline-none resize-none focus:ring-1 focus:ring-primary custom-scrollbar"
                minRows={2}
                maxRows={12}
              />
              <div className="flex items-center gap-2 mt-2 justify-end">
                <button
                  onClick={handleEditCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
                <button
                  onClick={handleEditSubmit}
                  disabled={!editText.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "text-sm leading-relaxed overflow-hidden",
                isUser
                  ? "bg-secondary text-secondary-foreground px-5 py-3 rounded-2xl rounded-tr-sm max-w-[85%]"
                  : "w-full text-foreground"
              )}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="markdown-content w-full">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      code: CodeBlock,
                      p: ({ children }) => <p className="mb-4 last:mb-0 text-foreground/90">{children}</p>,
                      a: ({ href, children }) => (
                        <a href={href} className="text-primary hover:text-primary/80 underline underline-offset-4" target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                      ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="text-foreground/90">{children}</li>,
                      h1: ({ children }) => <h1 className="text-2xl font-bold font-display mt-8 mb-4 text-white">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-xl font-bold font-display mt-6 mb-3 text-white">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-lg font-bold font-display mt-4 mb-2 text-white">{children}</h3>,
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-primary/40 pl-4 my-4 italic text-muted-foreground">
                          {children}
                        </blockquote>
                      ),
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-4 rounded-xl border border-white/10">
                          <table className="w-full text-sm border-collapse">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
                      th: ({ children }) => (
                        <th className="px-4 py-2 text-left font-semibold text-white border-b border-white/10">{children}</th>
                      ),
                      td: ({ children }) => (
                        <td className="px-4 py-2 text-foreground/80 border-b border-white/5">{children}</td>
                      ),
                      tr: ({ children }) => <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr>,
                      hr: () => <hr className="border-white/10 my-6" />,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {!isEditing && (
            <div
              className={cn(
                "flex items-center gap-1 mt-0.5",
                isUser ? "flex-row-reverse" : "flex-row",
                "opacity-0 group-hover/bubble:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
              )}
            >
                {!isUser && (
                  <>
                    <button
                      onClick={handleCopy}
                      title="Copy message"
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
                    </button>

                    {onRetry && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            title="Retry"
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Retry</span>
                            <ChevronDown className="w-3 h-3 opacity-60" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-52 bg-card border-border">
                          <DropdownMenuItem
                            className="gap-2 cursor-pointer text-sm"
                            onClick={() => handleRetryWithModel(message.model ?? currentModel ?? "claude-sonnet-4-6")}
                          >
                            <RotateCcw className="w-4 h-4 text-muted-foreground" />
                            Retry with same model
                          </DropdownMenuItem>
                          {AVAILABLE_MODELS.filter((m) => m.id !== (message.model ?? currentModel ?? "claude-sonnet-4-6")).map((m) => (
                            <DropdownMenuItem
                              key={m.id}
                              className="gap-2 cursor-pointer text-sm"
                              onClick={() => handleRetryWithModel(m.id)}
                            >
                              <RotateCcw className="w-4 h-4 text-muted-foreground" />
                              Retry with {m.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </>
                )}

                {isUser && onEditResend && (
                  <button
                    onClick={() => setIsEditing(true)}
                    title="Edit message"
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/10 transition-all"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Edit</span>
                  </button>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
