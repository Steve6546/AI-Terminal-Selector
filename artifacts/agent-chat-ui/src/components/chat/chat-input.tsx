import { useState, useRef, useCallback } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Send, Square, Paperclip, Database, Server, Settings, Plus, Bot, Wrench, X, FileText, Image, ChevronDown } from "lucide-react";
import { InteractionMode } from "@/hooks/use-local-settings";
import { cn } from "@/lib/utils";
import { useListMcpServers, useListMcpTools } from "@workspace/api-client-react";
import { useLocation } from "wouter";
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

export interface ToolParams {
  serverId: number;
  toolName: string;
  toolArgs: Record<string, unknown>;
}

interface ChatInputProps {
  onSend: (text: string, attachmentIds?: number[], toolParams?: ToolParams) => void;
  onStop: () => void;
  isStreaming: boolean;
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
  conversationId?: number | null;
}

const ACCEPT_TYPES = "image/*,.pdf,.txt,.md,.csv,.json,.xml,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cpp,.c,.h,.sh";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function ChatInput({ onSend, onStop, isStreaming, mode, onModeChange, conversationId }: ChatInputProps) {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [argsError, setArgsError] = useState<string | null>(null);

  // Tool mode state
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);

  const { data: mcpServers } = useListMcpServers();
  const { data: mcpTools } = useListMcpTools(selectedServerId ?? 0);

  const selectedServer = mcpServers?.find((s) => s.id === selectedServerId);
  const selectedTool = mcpTools?.find((t) => t.toolName === selectedToolName);

  const parseToolArgs = (): Record<string, unknown> | null => {
    const trimmed = text.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && !Array.isArray(parsed) && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
      setArgsError("Args must be a JSON object { ... }");
      return null;
    } catch {
      setArgsError("Invalid JSON — please enter a valid JSON object for tool args");
      return null;
    }
  };

  const handleSubmit = () => {
    if (isStreaming) return;

    if (mode === "tool") {
      if (!selectedServerId || !selectedToolName) {
        setArgsError("Select a server and tool first");
        return;
      }
      const toolArgs = parseToolArgs();
      if (toolArgs === null) return;
      setArgsError(null);
      onSend(text.trim() || "{}", attachments.map((a) => a.id), {
        serverId: selectedServerId,
        toolName: selectedToolName,
        toolArgs,
      });
      setText("");
      setAttachments([]);
      return;
    }

    if (text.trim()) {
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

  const canSend = mode === "tool"
    ? !isStreaming && !!selectedServerId && !!selectedToolName
    : !isStreaming && !!text.trim() && !uploading;

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

        {/* Tool Mode selector bar */}
        {mode === "tool" && (
          <div className="px-4 pt-3 flex flex-wrap items-center gap-2 border-b border-border/40 pb-3">
            <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Direct Execute:</span>

            {/* Server selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  selectedServer
                    ? "bg-accent/20 text-accent border-accent/30"
                    : "bg-secondary text-muted-foreground border-border hover:border-accent/30"
                )}>
                  <Server className="w-3 h-3" />
                  {selectedServer?.name ?? "Select Server"}
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52 bg-card border-border shadow-2xl">
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider font-mono">MCP Servers</DropdownMenuLabel>
                {mcpServers && mcpServers.length > 0 ? (
                  mcpServers.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      className="gap-2 cursor-pointer text-sm"
                      onClick={() => {
                        setSelectedServerId(s.id);
                        setSelectedToolName(null);
                        setArgsError(null);
                      }}
                    >
                      <div className={cn("w-2 h-2 rounded-full", s.status === "connected" ? "bg-green-400" : "bg-muted-foreground")} />
                      {s.name}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    No MCP servers found
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Tool selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={!selectedServerId}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                    selectedTool
                      ? "bg-primary/20 text-primary border-primary/30"
                      : "bg-secondary text-muted-foreground border-border hover:border-primary/30"
                  )}
                >
                  <Wrench className="w-3 h-3" />
                  {selectedTool?.toolName ?? "Select Tool"}
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60 bg-card border-border shadow-2xl max-h-64 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Tools</DropdownMenuLabel>
                {mcpTools && mcpTools.length > 0 ? (
                  mcpTools.filter((t) => t.enabled).map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      className="gap-2 cursor-pointer flex-col items-start"
                      onClick={() => { setSelectedToolName(t.toolName); setArgsError(null); }}
                    >
                      <span className="font-mono text-xs font-semibold">{t.toolName}</span>
                      {t.description && (
                        <span className="text-[10px] text-muted-foreground line-clamp-1">{t.description}</span>
                      )}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    {selectedServerId ? "No tools available" : "Select a server first"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {selectedTool?.description && (
              <span className="text-[10px] text-muted-foreground italic hidden sm:block">
                {selectedTool.description.slice(0, 80)}{selectedTool.description.length > 80 ? "..." : ""}
              </span>
            )}
          </div>
        )}

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
              <DropdownMenuItem
                className="gap-3 py-2 cursor-pointer"
                onClick={() => navigate("/settings?tab=databases")}
              >
                <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Database className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-sm">Databases</span>
                  <span className="text-[10px] text-muted-foreground">Manage DB connections</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-3 py-2 cursor-pointer"
                onClick={() => navigate("/settings?tab=mcp-servers")}
              >
                <div className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <Server className="w-4 h-4 text-green-400" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-sm">MCP Servers</span>
                  <span className="text-[10px] text-muted-foreground">Configure MCP connections</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-3 py-2 cursor-pointer"
                onClick={() => navigate("/settings")}
              >
                <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center">
                  <Settings className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-sm">Manage Connectors</span>
                  <span className="text-[10px] text-muted-foreground">All settings & integrations</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Textarea */}
          <TextareaAutosize
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); setArgsError(null); }}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "agent"
                ? "Ask the agent to do something..."
                : selectedToolName
                ? `JSON args for "${selectedToolName}", e.g. { "key": "value" } (or leave empty)`
                : "Select a server and tool above, then enter JSON args here..."
            }
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
                disabled={!canSend}
                className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shadow-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed glow-effect"
              >
                <Send className="w-4 h-4 translate-x-0.5" />
              </button>
            )}
          </div>
        </div>

        {/* Args error */}
        {argsError && (
          <div className="px-4 pb-2 text-xs text-red-400 font-mono">{argsError}</div>
        )}
      </div>
      <div className="text-center mt-2">
        <span className="text-[10px] text-muted-foreground font-mono">Agent Tool Chat uses Replit AI Integrations.</span>
      </div>
    </div>
  );
}
