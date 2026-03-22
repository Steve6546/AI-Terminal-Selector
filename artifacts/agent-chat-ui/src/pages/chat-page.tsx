import { useEffect, useRef, useMemo } from "react";
import { useParams } from "wouter";
import { motion } from "framer-motion";
import { MessageSquare, Zap, Code, TerminalSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useListAnthropicMessages, useListExecutions } from "@workspace/api-client-react";
import { useLocalSettings } from "@/hooks/use-local-settings";
import { useChatStream } from "@/hooks/use-chat-stream";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { ChatInput } from "@/components/chat/chat-input";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ToolExecutionCard } from "@/components/chat/tool-execution-card";
import { PageLoader } from "@/components/ui/loader";

export default function ChatPage() {
  const params = useParams();
  const conversationId = params.id ? parseInt(params.id) : null;
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { model, setModel, mode, setMode } = useLocalSettings();

  // Queries
  const { data: messages, isLoading: loadingMessages } = useListAnthropicMessages(
    conversationId ?? 0,
    { query: { enabled: !!conversationId, queryKey: ["anthropic-messages", conversationId] } }
  );

  const { data: executions, isLoading: loadingExecutions } = useListExecutions(
    { conversationId: conversationId ?? undefined },
    { query: { enabled: !!conversationId, queryKey: ["executions", conversationId] } }
  );

  // Streaming Hook
  const { sendMessage, stopStream, isStreaming, streamedText } = useChatStream({
    conversationId: conversationId || 0,
    model
  });

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, executions, streamedText]);

  // Interleave and sort messages and executions
  const timelineItems = useMemo(() => {
    if (!messages && !executions) return [];
    
    const items: Array<{type: 'msg' | 'exec', data: any, time: number}> = [];
    
    messages?.forEach(m => items.push({ type: 'msg', data: m, time: new Date(m.createdAt).getTime() }));
    executions?.forEach(e => items.push({ type: 'exec', data: e, time: new Date(e.startedAt).getTime() }));
    
    return items.sort((a, b) => a.time - b.time);
  }, [messages, executions]);

  const handleSend = (text: string) => {
    if (!conversationId) {
      // In a real app, this would create a conversation first if on home page
      alert("Please create or select a conversation from the sidebar first.");
      return;
    }
    sendMessage(text);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      
      <main className="flex-1 flex flex-col relative min-w-0">
        <TopBar model={model} onModelChange={setModel} />
        
        <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth">
          {!conversationId ? (
            // EMPTY STATE (Home Page)
            <div className="h-full flex flex-col items-center justify-center p-8">
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
          ) : (loadingMessages || loadingExecutions) ? (
            <PageLoader />
          ) : (
            // CHAT VIEW
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
                      {item.type === 'msg' 
                        ? <MessageBubble message={item.data} />
                        : <ToolExecutionCard execution={item.data} />
                      }
                    </motion.div>
                  ))}
                  
                  {/* Streaming Indicator Bubble */}
                  {isStreaming && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="w-full flex py-6 justify-start bg-secondary/20 border-y border-white/[0.02]"
                    >
                       <div className="flex gap-4 max-w-4xl w-full px-6 flex-row">
                          <div className="flex-shrink-0 mt-1">
                            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br from-primary to-accent border border-primary/30 glow-effect animate-pulse">
                              <Sparkles className="w-5 h-5 text-white" />
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 min-w-0 flex-1 items-start">
                            <div className="flex items-center gap-2 text-xs font-mono text-primary">
                              <span>Generating response...</span>
                            </div>
                            <div className="text-sm leading-relaxed w-full text-foreground markdown-content">
                              {streamedText ? (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamedText}</ReactMarkdown>
                              ) : (
                                <span className="flex gap-1 mt-2">
                                  <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" />
                                  <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{animationDelay: '0.1s'}} />
                                  <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{animationDelay: '0.2s'}} />
                                </span>
                              )}
                            </div>
                          </div>
                       </div>
                    </motion.div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Area stays at bottom */}
        <div className="w-full bg-gradient-to-t from-background via-background to-transparent pt-6">
          <ChatInput 
            onSend={handleSend}
            onStop={stopStream}
            isStreaming={isStreaming}
            mode={mode}
            onModeChange={setMode}
          />
        </div>
      </main>
    </div>
  );
}

// Re-export Sparkles for the internal component usage above
function Sparkles(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" {...props}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
}
