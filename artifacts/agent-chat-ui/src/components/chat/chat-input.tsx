import { useState, useRef, useEffect } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Send, Square, Paperclip, Database, Server, Settings, Plus, Bot, Wrench } from "lucide-react";
import { InteractionMode } from "@/hooks/use-local-settings";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
}

export function ChatInput({ onSend, onStop, isStreaming, mode, onModeChange }: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (text.trim() && !isStreaming) {
      onSend(text.trim());
      setText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-6 pb-6 pt-2">
      <div className={cn(
        "relative flex flex-col bg-input border border-border rounded-2xl shadow-xl transition-all duration-300",
        text.trim() ? "border-primary/50 shadow-[0_8px_30px_rgba(99,102,241,0.1)]" : "hover:border-border/80"
      )}>
        
        {/* Input Area */}
        <div className="px-4 py-3 flex items-end gap-2">
          
          {/* Plus Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 mb-1 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                <Plus className="w-5 h-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 bg-card border-border mb-2 shadow-2xl">
              <DropdownMenuItem className="gap-3 py-2.5 cursor-pointer">
                <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Paperclip className="w-4 h-4 text-primary" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-sm">Attach File</span>
                  <span className="text-[10px] text-muted-foreground">Upload document or image</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Connectors</DropdownMenuLabel>
              <DropdownMenuItem className="gap-3 py-2 cursor-pointer">
                <Database className="w-4 h-4 text-blue-400" /> Databases
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-3 py-2 cursor-pointer">
                <Server className="w-4 h-4 text-green-400" /> MCP Servers
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-3 py-2 cursor-pointer">
                <Settings className="w-4 h-4 text-muted-foreground" /> Manage
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Textarea */}
          <TextareaAutosize
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === "Agent" ? "Ask the agent to do something..." : "Type a manual tool command..."}
            className="flex-1 bg-transparent border-0 outline-none resize-none py-2 text-sm text-foreground placeholder:text-muted-foreground max-h-64 custom-scrollbar"
            minRows={1}
            maxRows={8}
          />

          {/* Right Controls */}
          <div className="flex items-center gap-2 mb-1">
            {/* Mode Toggle */}
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
              <button 
                onClick={() => onModeChange("Agent")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all",
                  mode === "Agent" ? "bg-primary text-white shadow-md" : "text-muted-foreground hover:text-white"
                )}
              >
                <Bot className="w-3.5 h-3.5" /> Agent
              </button>
              <button 
                onClick={() => onModeChange("Tool")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all",
                  mode === "Tool" ? "bg-accent text-white shadow-md" : "text-muted-foreground hover:text-white"
                )}
              >
                <Wrench className="w-3.5 h-3.5" /> Tool
              </button>
            </div>

            {/* Send/Stop Button */}
            {isStreaming ? (
              <button 
                onClick={onStop}
                className="w-10 h-10 rounded-xl bg-destructive text-white flex items-center justify-center shadow-lg hover:bg-destructive/90 transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button 
                onClick={handleSubmit}
                disabled={!text.trim()}
                className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shadow-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed glow-effect"
              >
                <Send className="w-4 h-4 translate-x-0.5" />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="text-center mt-2">
        <span className="text-[10px] text-muted-foreground font-mono">Agent Tool Chat uses Replit AI Integrations.</span>
      </div>
    </div>
  );
}
