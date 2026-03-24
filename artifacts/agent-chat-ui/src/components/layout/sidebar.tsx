import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { 
  MessageSquare, Plus, Search, MoreHorizontal, 
  Settings, Server, Terminal, Trash2, Edit2, Check, X,
  Pin, PinOff, Copy, Download, Wand2, Circle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  useListConversations, 
  useCreateConversation,
  useDeleteConversation,
  useUpdateConversation,
  usePinConversation,
  useUnpinConversation,
  useDuplicateConversation,
  useAutoNameConversation,
  getExportConversationUrl,
  useListMcpServers,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { getListConversationsQueryKey } from "@workspace/api-client-react";

const DEFAULT_TITLE_PATTERNS = ["New Chat", "New Conversation"];

function AnimatedTitle({ title, isActive }: { title: string; isActive: boolean }) {
  const [displayTitle, setDisplayTitle] = useState(title);
  const [animating, setAnimating] = useState(false);
  const prevTitleRef = useRef(title);

  useEffect((): void | (() => void) => {
    const prev = prevTitleRef.current;
    if (prev === title) return;
    // Only animate when transitioning from a default/placeholder title to a real one
    const wasDefault = DEFAULT_TITLE_PATTERNS.some((p) => prev === p);
    prevTitleRef.current = title;
    if (wasDefault) {
      setAnimating(true);
      const timer = setTimeout(() => {
        setDisplayTitle(title);
        setAnimating(false);
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setDisplayTitle(title);
    }
  }, [title]);

  return (
    <motion.span
      key={displayTitle}
      animate={{ opacity: animating ? 0 : 1, y: animating ? -4 : 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "font-medium text-sm truncate",
        isActive ? "text-primary" : "text-sidebar-foreground/80 group-hover:text-sidebar-foreground"
      )}
    >
      {displayTitle}
    </motion.span>
  );
}

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  
  const { data: conversations, isLoading } = useListConversations();
  const { data: mcpServers } = useListMcpServers({ query: { refetchInterval: 60_000, queryKey: ["mcp-servers-sidebar"] } });
  const createMutation = useCreateConversation();
  const deleteMutation = useDeleteConversation();
  const updateMutation = useUpdateConversation();
  const pinMutation = usePinConversation();
  const unpinMutation = useUnpinConversation();
  const duplicateMutation = useDuplicateConversation();
  const autoNameMutation = useAutoNameConversation();

  // Subscribe to SSE health events so sidebar server status updates immediately
  // when a health check fires (rather than waiting for the 60s poll interval).
  useEffect(() => {
    const es = new EventSource("/api/system/status/events");
    es.addEventListener("server_status", () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-servers-sidebar"] });
    });
    return () => es.close();
  }, [queryClient]);

  useEffect(() => {
    if (editingId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });

  const handleNewChat = () => {
    createMutation.mutate(
      { data: { title: "New Conversation" } },
      {
        onSuccess: (data) => {
          setLocation(`/c/${data.id}`);
        }
      }
    );
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        if (location === `/c/${id}`) setLocation("/");
        invalidate();
      }
    });
  };

  const startRename = (e: React.MouseEvent, id: number, currentTitle: string) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(id);
    setEditingTitle(currentTitle);
  };

  const commitRename = (id: number) => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed.length > 0) {
      updateMutation.mutate(
        { id, data: { title: trimmed } },
        { onSuccess: () => invalidate() }
      );
    }
    setEditingId(null);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, id: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(id);
    } else if (e.key === "Escape") {
      cancelRename();
    }
  };

  const handlePin = (e: React.MouseEvent, id: number, isPinned: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPinned) {
      unpinMutation.mutate({ id }, { onSuccess: () => invalidate() });
    } else {
      pinMutation.mutate({ id }, { onSuccess: () => invalidate() });
    }
  };

  const handleDuplicate = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    duplicateMutation.mutate({ id }, {
      onSuccess: (data) => {
        invalidate();
        setLocation(`/c/${data.id}`);
      }
    });
  };

  const handleAutoName = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    // force=true: user explicitly wants to rename even if title was manually set
    autoNameMutation.mutate({ id, force: true }, { onSuccess: () => invalidate() });
  };

  const handleExport = (e: React.MouseEvent, id: number, fmt: "json" | "markdown") => {
    e.preventDefault();
    e.stopPropagation();
    const baseUrl = window.location.origin;
    const url = baseUrl + getExportConversationUrl(id, { format: fmt });
    window.open(url, "_blank");
  };

  const filteredConversations = (conversations ?? []).filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  // Split into pinned and unpinned
  const pinned = filteredConversations.filter(c => !!c.pinnedAt);
  const unpinned = filteredConversations.filter(c => !c.pinnedAt);

  const renderConversation = (chat: typeof filteredConversations[0]) => {
    const isActive = location === `/c/${chat.id}`;
    const isEditing = editingId === chat.id;
    const isPinned = !!chat.pinnedAt;

    return (
      <motion.div
        key={chat.id}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.15 }}
      >
        <Link href={`/c/${chat.id}`} className={cn(
          "group flex flex-col gap-1 p-3 rounded-xl cursor-pointer transition-all duration-200 block",
          isActive 
            ? "bg-primary/10 border border-primary/20" 
            : "hover:bg-white/5 border border-transparent"
        )}>
          <div className="flex items-center justify-between w-full">
            {isEditing ? (
              <div className="flex items-center gap-1 flex-1" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                <input
                  ref={editInputRef}
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => handleRenameKeyDown(e, chat.id)}
                  onBlur={() => commitRename(chat.id)}
                  className="flex-1 min-w-0 bg-background border border-primary/50 rounded-lg px-2 py-0.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button onClick={() => commitRename(chat.id)} className="p-1 text-green-400 hover:text-green-300">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={cancelRename} className="p-1 text-muted-foreground hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {isPinned && <Pin className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                  <MessageSquare className={cn(
                    "w-3.5 h-3.5 flex-shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )} />
                  <AnimatedTitle title={chat.title} isActive={isActive} />
                </div>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button 
                      onClick={e => e.preventDefault()}
                      className={cn(
                        "p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center hover:bg-white/10 rounded-md transition-all flex-shrink-0 focus:opacity-100",
                        isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52 bg-card border-border">
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onClick={(e) => startRename(e as React.MouseEvent, chat.id, chat.title)}
                    >
                      <Edit2 className="w-4 h-4 text-muted-foreground" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onClick={(e) => handleAutoName(e as React.MouseEvent, chat.id)}
                    >
                      <Wand2 className="w-4 h-4 text-muted-foreground" /> Auto-name with AI
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onClick={(e) => handlePin(e as React.MouseEvent, chat.id, isPinned)}
                    >
                      {isPinned
                        ? <><PinOff className="w-4 h-4 text-muted-foreground" /> Unpin</>
                        : <><Pin className="w-4 h-4 text-muted-foreground" /> Pin to top</>
                      }
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onClick={(e) => handleDuplicate(e as React.MouseEvent, chat.id)}
                    >
                      <Copy className="w-4 h-4 text-muted-foreground" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onClick={(e) => handleExport(e as React.MouseEvent, chat.id, "json")}
                    >
                      <Download className="w-4 h-4 text-muted-foreground" /> Export as JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onClick={(e) => handleExport(e as React.MouseEvent, chat.id, "markdown")}
                    >
                      <Download className="w-4 h-4 text-muted-foreground" /> Export as Markdown
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem 
                      onClick={(e) => handleDelete(e as React.MouseEvent, chat.id)}
                      className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
          {!isEditing && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-mono">
                {format(new Date(chat.createdAt), "MMM d, h:mm a")}
              </span>
              {(chat.messageCount ?? 0) > 0 && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {chat.messageCount} msg{chat.messageCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </Link>
      </motion.div>
    );
  };

  return (
    <div className="w-72 h-screen flex flex-col bg-sidebar border-r border-sidebar-border relative z-20">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-display font-bold text-foreground tracking-tight">
          <Terminal className="w-5 h-5 text-primary" />
          <span>Agent Tool Chat</span>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-4 pb-4">
        <button
          onClick={handleNewChat}
          disabled={createMutation.isPending}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-primary-foreground rounded-xl font-medium text-sm transition-all hover:bg-primary/90 glow-effect disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          {createMutation.isPending ? "Creating..." : "New Chat"}
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history..." 
            className="pl-9 bg-background/50 border-sidebar-border h-9 rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar pb-4">
        {isLoading ? (
          <div className="space-y-2 px-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground mt-8 px-4">
            {search ? "No matches found" : "No conversations yet. Start a new chat!"}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {/* Pinned section */}
            {pinned.length > 0 && (
              <>
                <div className="px-3 pt-1 pb-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Pin className="w-3 h-3" /> Pinned
                  </span>
                </div>
                {pinned.map(renderConversation)}
                {unpinned.length > 0 && (
                  <div className="px-3 pt-2 pb-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Recent
                    </span>
                  </div>
                )}
              </>
            )}
            {unpinned.map(renderConversation)}
          </AnimatePresence>
        )}
      </div>

      {/* Footer: MCP server status + navigation */}
      <div className="border-t border-sidebar-border bg-sidebar/50">
        {/* Per-server status — always visible */}
        {mcpServers && mcpServers.length > 0 && (
          <div className="px-4 py-2 space-y-1">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              MCP Servers
            </div>
            {mcpServers.map((srv) => {
              const isConnected = srv.status === "connected";
              const isChecking = srv.status === "checking";
              return (
                <div key={srv.id} className="flex items-center gap-2 text-xs">
                  <Circle className={cn(
                    "w-2 h-2 flex-shrink-0 fill-current",
                    isConnected ? "text-green-500" : isChecking ? "text-yellow-500" : "text-red-500"
                  )} />
                  <span className={cn(
                    "truncate",
                    isConnected ? "text-muted-foreground" : isChecking ? "text-yellow-400/70" : "text-red-400/70"
                  )}>
                    {srv.name}
                  </span>
                  <span className={cn(
                    "ml-auto text-[10px] shrink-0",
                    isConnected ? "text-green-500/70" : isChecking ? "text-yellow-500/70" : "text-red-500/70"
                  )}>
                    {isConnected ? "ok" : isChecking ? "…" : "err"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {/* Navigation links */}
        <div className="p-3 space-y-1">
          <Link href="/servers" className={cn(
            "flex items-center gap-3 px-3 py-3 min-h-[44px] rounded-lg text-sm transition-colors",
            location === "/servers" ? "bg-white/10 text-white" : "text-muted-foreground hover:bg-white/5 hover:text-white"
          )}>
            <Server className="w-4 h-4 flex-shrink-0" />
            <span>MCP Servers</span>
          </Link>
          <Link href="/terminal" className={cn(
            "flex items-center gap-3 px-3 py-3 min-h-[44px] rounded-lg text-sm transition-colors",
            location === "/terminal" ? "bg-white/10 text-white" : "text-muted-foreground hover:bg-white/5 hover:text-white"
          )}>
            <Terminal className="w-4 h-4 flex-shrink-0" />
            <span>Terminal</span>
          </Link>
          <Link href="/settings" className={cn(
            "flex items-center gap-3 px-3 py-3 min-h-[44px] rounded-lg text-sm transition-colors",
            location === "/settings" ? "bg-white/10 text-white" : "text-muted-foreground hover:bg-white/5 hover:text-white"
          )}>
            <Settings className="w-4 h-4 flex-shrink-0" />
            <span>Settings</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
