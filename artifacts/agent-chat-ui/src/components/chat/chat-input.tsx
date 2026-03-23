import { useState, useRef, useCallback } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Send, Square, Paperclip, Database, Server, Settings, Plus, Bot, Wrench, X, FileText, Image } from "lucide-react";
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

export interface PendingAttachment {
  id: number;
  fileName: string;
  fileType: string;
}

interface ChatInputProps {
  onSend: (text: string, attachmentIds?: number[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
  conversationId?: number | null;
}

const ACCEPT_TYPES = "image/*,.pdf,.txt,.md,.csv,.json,.xml,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cpp,.c,.h,.sh";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function ChatInput({ onSend, onStop, isStreaming, mode, onModeChange, conversationId }: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (text.trim() && !isStreaming) {
      onSend(text.trim(), attachments.map((a) => a.id));
      setText("");
      setAttachments([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    const newAttachments: PendingAttachment[] = [];

    for (const file of files) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const resp = await fetch("/api/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationId ?? undefined,
            fileName: file.name,
            fileType: file.type || "application/octet-stream",
            content: base64,
          }),
        });

        if (resp.ok) {
          const data = await resp.json() as { id: number; fileName: string; fileType: string };
          newAttachments.push({ id: data.id, fileName: data.fileName, fileType: data.fileType });
        }
      } catch (err) {
        console.error("Failed to upload attachment:", err);
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [conversationId]);

  const removeAttachment = (id: number) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const isImage = (fileType: string) => IMAGE_TYPES.includes(fileType);

  return (
    <div className="w-full max-w-4xl mx-auto px-6 pb-6 pt-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_TYPES}
        className="hidden"
        onChange={handleFileChange}
      />

      <div className={cn(
        "relative flex flex-col bg-input border border-border rounded-2xl shadow-xl transition-all duration-300",
        text.trim() ? "border-primary/50 shadow-[0_8px_30px_rgba(99,102,241,0.1)]" : "hover:border-border/80"
      )}>

        {/* Attachment Chips */}
        {attachments.length > 0 && (
          <div className="px-4 pt-3 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary"
              >
                {isImage(att.fileType) ? (
                  <Image className="w-3 h-3" />
                ) : (
                  <FileText className="w-3 h-3" />
                )}
                <span className="max-w-[120px] truncate">{att.fileName}</span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="ml-0.5 text-primary/60 hover:text-primary transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/50 border border-border text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                Uploading...
              </div>
            )}
          </div>
        )}

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
              <DropdownMenuItem
                className="gap-3 py-2.5 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Paperclip className="w-4 h-4 text-primary" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-sm">Attach File</span>
                  <span className="text-[10px] text-muted-foreground">Image, PDF, code, or text</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Connectors</DropdownMenuLabel>
              <DropdownMenuItem className="gap-3 py-2 cursor-pointer opacity-50" disabled>
                <Database className="w-4 h-4 text-blue-400" /> Databases
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-3 py-2 cursor-pointer opacity-50" disabled>
                <Server className="w-4 h-4 text-green-400" /> MCP Servers
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-3 py-2 cursor-pointer opacity-50" disabled>
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
            placeholder={mode === "agent" ? "Ask the agent to do something..." : "Type a message (tool-free mode)..."}
            className="flex-1 bg-transparent border-0 outline-none resize-none py-2 text-sm text-foreground placeholder:text-muted-foreground max-h-64 custom-scrollbar"
            minRows={1}
            maxRows={8}
          />

          {/* Right Controls */}
          <div className="flex items-center gap-2 mb-1">
            {/* Mode Toggle */}
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => onModeChange("agent")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all",
                  mode === "agent" ? "bg-primary text-white shadow-md" : "text-muted-foreground hover:text-white"
                )}
              >
                <Bot className="w-3.5 h-3.5" /> Agent
              </button>
              <button
                onClick={() => onModeChange("tool")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all",
                  mode === "tool" ? "bg-accent text-white shadow-md" : "text-muted-foreground hover:text-white"
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
                disabled={!text.trim() || uploading}
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
