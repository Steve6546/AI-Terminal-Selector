import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { format } from "date-fns";
import { User, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnthropicMessage } from "@workspace/api-client-react";

interface MessageBubbleProps {
  message: AnthropicMessage;
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

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "w-full flex py-6",
        isUser ? "justify-end" : "justify-start bg-secondary/20 border-y border-white/[0.02]"
      )}
    >
      <div
        className={cn(
          "flex gap-4 max-w-4xl w-full px-6",
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

          <div
            className={cn(
              "text-sm leading-relaxed overflow-hidden",
              isUser
                ? "bg-secondary text-secondary-foreground px-5 py-3 rounded-2xl rounded-tr-sm"
                : "w-full text-foreground"
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="markdown-content w-full">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: CodeBlock,
                    p: ({ children }) => <p className="mb-4 last:mb-0 text-foreground/90">{children}</p>,
                    a: ({ href, children }) => (
                      <a href={href} className="text-primary hover:text-primary/80 underline underline-offset-4">
                        {children}
                      </a>
                    ),
                    ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
                    h1: ({ children }) => <h1 className="text-2xl font-bold font-display mt-8 mb-4 text-white">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-xl font-bold font-display mt-6 mb-3 text-white">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-lg font-bold font-display mt-4 mb-2 text-white">{children}</h3>,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
