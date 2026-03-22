import { useState } from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { 
  MessageSquare, Plus, Search, MoreHorizontal, 
  Settings, Server, Terminal, Pin, Trash2, Edit2, Copy
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  useListAnthropicConversations, 
  useCreateAnthropicConversation,
  useDeleteAnthropicConversation
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

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  
  const { data: conversations, isLoading } = useListAnthropicConversations();
  const createMutation = useCreateAnthropicConversation();
  const deleteMutation = useDeleteAnthropicConversation();

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
      }
    });
  };

  const filteredConversations = conversations?.filter(c => 
    c.title.toLowerCase().includes(search.toLowerCase())
  ) || [];

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
          <div className="text-center text-xs text-muted-foreground mt-8">
            No conversations found
          </div>
        ) : (
          filteredConversations.map((chat) => {
            const isActive = location === `/c/${chat.id}`;
            return (
              <Link key={chat.id} href={`/c/${chat.id}`} className={cn(
                "group flex flex-col gap-1 p-3 rounded-xl cursor-pointer transition-all duration-200",
                isActive 
                  ? "bg-primary/10 border border-primary/20" 
                  : "hover:bg-white/5 border border-transparent"
              )}>
                <div className="flex items-center justify-between w-full">
                  <span className={cn(
                    "font-medium text-sm truncate pr-2",
                    isActive ? "text-primary" : "text-sidebar-foreground/80 group-hover:text-sidebar-foreground"
                  )}>
                    {chat.title}
                  </span>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button 
                        onClick={e => e.preventDefault()}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded-md transition-all"
                      >
                        <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-card border-border">
                      <DropdownMenuItem className="gap-2 cursor-pointer">
                        <Edit2 className="w-4 h-4 text-muted-foreground" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2 cursor-pointer">
                        <Pin className="w-4 h-4 text-muted-foreground" /> Pin to top
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2 cursor-pointer">
                        <Copy className="w-4 h-4 text-muted-foreground" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-border" />
                      <DropdownMenuItem 
                        onClick={(e) => handleDelete(e as any, chat.id)}
                        className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {format(new Date(chat.createdAt), "MMM d, h:mm a")}
                </span>
              </Link>
            );
          })
        )}
      </div>

      {/* Footer Navigation */}
      <div className="p-3 border-t border-sidebar-border bg-sidebar/50 space-y-1">
        <Link href="/servers" className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
          location === "/servers" ? "bg-white/10 text-white" : "text-muted-foreground hover:bg-white/5 hover:text-white"
        )}>
          <Server className="w-4 h-4" />
          <span>MCP Servers</span>
        </Link>
        <Link href="/settings" className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
          location === "/settings" ? "bg-white/10 text-white" : "text-muted-foreground hover:bg-white/5 hover:text-white"
        )}>
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </Link>
      </div>
    </div>
  );
}
