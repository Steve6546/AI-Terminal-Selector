import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import {
  useListMcpServers,
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
} from "@workspace/api-client-react";
import type { McpServer } from "@workspace/api-client-react";
import { useMcpHealth, type McpLiveStatus } from "@/hooks/use-mcp-health";
import {
  Server,
  Plus,
  Trash2,
  Settings2,
  X,
  Zap,
  Wrench,
  Loader2,
  Eye,
  EyeOff,
  ArrowLeft,
  Key,
  Lock,
  Globe,
  Sparkles,
} from "lucide-react";
import McpAgentSidebar from "@/components/mcp/mcp-agent-sidebar";
import { PageLoader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListMcpServersQueryKey,
} from "@workspace/api-client-react";

// ─── Zod schema for Add / Edit form ────────────────────────────────────────

const serverFormSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100),
    description: z.string().max(500).optional(),
    transportType: z.enum(["streamable-http", "stdio"]),
    endpoint: z.string().max(2048).optional(),
    command: z.string().max(1024).optional(),
    args: z.string().max(2048).optional(),
    authType: z.enum(["none", "bearer", "api-key", "oauth"]),
    authSecret: z.string().max(2048).optional(),
    timeout: z.coerce.number().min(5, "Min 5s").max(300, "Max 300s"),
    retryCount: z.coerce.number().min(0, "Min 0").max(10, "Max 10"),
    enabled: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.transportType === "streamable-http" && !data.endpoint?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Endpoint URL is required for HTTP transport",
        path: ["endpoint"],
      });
    }
    if (data.transportType === "stdio" && !data.command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Command is required for stdio transport",
        path: ["command"],
      });
    }
  });

type ServerFormValues = z.infer<typeof serverFormSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────

function StatusDot({ status, latencyMs }: { status: string; latencyMs?: number }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-green-400 text-xs font-mono">
        <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
        CONNECTED{latencyMs != null ? ` · ${latencyMs}ms` : ""}
      </span>
    );
  }
  if (status === "degraded") {
    return (
      <span className="flex items-center gap-1.5 text-orange-400 text-xs font-mono">
        <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        DEGRADED
      </span>
    );
  }
  if (status === "auth_required") {
    return (
      <span className="flex items-center gap-1.5 text-yellow-400 text-xs font-mono">
        <Lock className="w-3 h-3" />
        AUTH REQUIRED
      </span>
    );
  }
  if (status === "error" || status === "disconnected") {
    return (
      <span className="flex items-center gap-1.5 text-red-400 text-xs font-mono">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        {status === "disconnected" ? "DISCONNECTED" : "ERROR"}
      </span>
    );
  }
  if (status === "checking") {
    return (
      <span className="flex items-center gap-1.5 text-yellow-400 text-xs font-mono">
        <Loader2 className="w-3 h-3 animate-spin" />
        CHECKING
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-mono">
      <span className="w-2 h-2 rounded-full bg-gray-500" />
      {status.toUpperCase()}
    </span>
  );
}

// ─── Input helpers ─────────────────────────────────────────────────────────

function inputCls(extra?: string) {
  return cn(
    "w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors",
    extra
  );
}

function numberInputCls(extra?: string) {
  return cn(
    inputCls(extra),
    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
  );
}

function errorCls(extra?: string) {
  return cn("text-xs text-destructive mt-1", extra);
}

// ─── Server Form Dialog (React Hook Form + Zod) ────────────────────────────

function ServerFormDialog({
  server,
  onClose,
}: {
  server: McpServer | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const createMutation = useCreateMcpServer();
  const updateMutation = useUpdateMcpServer();
  const [showSecret, setShowSecret] = useState(false);
  const isEditing = server !== null;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ServerFormValues>({
    resolver: zodResolver(serverFormSchema),
    defaultValues: server
      ? {
          name: server.name,
          description: server.description ?? "",
          transportType: server.transportType as "streamable-http" | "stdio",
          endpoint: server.endpoint ?? "",
          command: server.command ?? "",
          args: (server.args ?? []).join(" "),
          authType: (server.authType as "none" | "bearer" | "api-key" | "oauth") ?? "none",
          authSecret: "",
          timeout: server.timeout ?? 30,
          retryCount: server.retryCount ?? 3,
          enabled: server.enabled,
        }
      : {
          name: "",
          description: "",
          transportType: "streamable-http",
          endpoint: "",
          command: "",
          args: "",
          authType: "none",
          authSecret: "",
          timeout: 30,
          retryCount: 3,
          enabled: true,
        },
  });

  const transportType = watch("transportType");
  const authType = watch("authType");
  const enabled = watch("enabled");

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isError = createMutation.isError || updateMutation.isError;

  const onSubmit = (values: ServerFormValues) => {
    const backendAuthType = values.authType === "oauth" ? "none" : values.authType;
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      transportType: values.transportType,
      endpoint: values.transportType === "streamable-http" ? values.endpoint?.trim() : undefined,
      command: values.transportType === "stdio" ? values.command?.trim() : undefined,
      args: values.args?.trim() ? values.args.trim().split(/\s+/) : [],
      authType: backendAuthType,
      authSecret: values.authSecret?.trim() || undefined,
      timeout: values.timeout,
      retryCount: values.retryCount,
      enabled: values.enabled,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: server.id, data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
            onClose();
          },
        }
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
            onClose();
          },
        }
      );
    }
  };

  const authOptions = [
    { value: "none" as const, label: "No Auth", icon: Globe, description: "Open or internally trusted endpoint" },
    { value: "bearer" as const, label: "Bearer Token", icon: Key, description: "RFC 6750 — Authorization: Bearer" },
    { value: "api-key" as const, label: "API Key", icon: Lock, description: "Custom header or query parameter" },
    { value: "oauth" as const, label: "OAuth 2.0", icon: Zap, description: "MCP-compliant OAuth flow" },
  ];

  const primaryLabel = () => {
    if (isPending) return isEditing ? "Saving…" : "Adding…";
    if (isEditing) return "Save Changes";
    if (authType === "oauth") return "Add & Authorize";
    return "Save & Continue";
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar border border-white/10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-white">
            {isEditing ? "Edit Server" : "Add MCP Server"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Server Name <span className="text-destructive">*</span>
            </label>
            <input
              {...register("name")}
              type="text"
              placeholder="My MCP Server"
              className={cn(inputCls("mt-1"), errors.name && "border-destructive")}
            />
            {errors.name && <p className={errorCls()}>{errors.name.message}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </label>
            <input
              {...register("description")}
              type="text"
              placeholder="Optional description"
              className={inputCls("mt-1")}
            />
          </div>

          {/* Transport */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Transport
            </label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {([
                { value: "streamable-http" as const, label: "HTTP (Remote)", sub: "Streamable HTTP · MCP spec" },
                { value: "stdio" as const, label: "stdio (Local)", sub: "Process · stdin/stdout" },
              ]).map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setValue("transportType", t.value, { shouldValidate: true })}
                  className={cn(
                    "py-2.5 px-3 rounded-xl text-left transition-colors border",
                    transportType === t.value
                      ? "bg-primary/20 border-primary"
                      : "bg-secondary border-border hover:border-white/20"
                  )}
                >
                  <p className={cn("text-sm font-medium leading-tight", transportType === t.value ? "text-primary" : "text-white")}>{t.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{t.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Endpoint or Command */}
          {transportType === "streamable-http" ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Endpoint URL <span className="text-destructive">*</span>
              </label>
              <input
                {...register("endpoint")}
                type="url"
                placeholder="https://example.com/mcp"
                autoComplete="off"
                className={cn(inputCls("mt-1 font-mono"), errors.endpoint && "border-destructive")}
              />
              {errors.endpoint && <p className={errorCls()}>{errors.endpoint.message}</p>}
              <p className="text-xs text-muted-foreground mt-1">The MCP server's HTTP endpoint (e.g. <span className="font-mono">/mcp</span> path)</p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Command <span className="text-destructive">*</span>
                </label>
                <input
                  {...register("command")}
                  type="text"
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  autoComplete="off"
                  className={cn(inputCls("mt-1 font-mono"), errors.command && "border-destructive")}
                />
                {errors.command && <p className={errorCls()}>{errors.command.message}</p>}
                <p className="text-xs text-muted-foreground mt-1">Executable or <span className="font-mono">npx</span> package — launched as a child process via stdio</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Arguments
                </label>
                <input
                  {...register("args")}
                  type="text"
                  placeholder="/home/user/docs --read-only"
                  autoComplete="off"
                  className={inputCls("mt-1 font-mono")}
                />
                <p className="text-xs text-muted-foreground mt-1">Space-separated arguments passed after the command</p>
              </div>
            </>
          )}

          {/* Authentication */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Authentication
            </label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {authOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setValue("authType", opt.value, { shouldValidate: true })}
                  className={cn(
                    "flex items-start gap-2 p-3 rounded-xl text-left transition-colors border",
                    authType === opt.value
                      ? "bg-primary/20 border-primary"
                      : "bg-secondary border-border hover:border-white/20"
                  )}
                >
                  <opt.icon className={cn(
                    "w-3.5 h-3.5 mt-0.5 flex-shrink-0",
                    authType === opt.value ? "text-primary" : "text-muted-foreground"
                  )} />
                  <div>
                    <p className={cn(
                      "text-xs font-medium leading-tight",
                      authType === opt.value ? "text-primary" : "text-white"
                    )}>{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* OAuth info banner */}
          {authType === "oauth" && (
            <div className="flex items-start gap-2.5 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
              <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>OAuth 2.0 with PKCE — after saving, the agent will initiate the authorization code flow with the server's <span className="font-mono">/authorize</span> endpoint.</p>
            </div>
          )}

          {/* Auth Secret for bearer/api-key */}
          {(authType === "bearer" || authType === "api-key") && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {authType === "bearer" ? "Bearer Token" : "API Key"}
              </label>
              {isEditing && (
                <p className="text-xs text-muted-foreground mb-1">Leave blank to keep existing secret</p>
              )}
              <div className="relative mt-1">
                <input
                  {...register("authSecret")}
                  type={showSecret ? "text" : "password"}
                  placeholder={authType === "bearer" ? "your-bearer-token" : "your-api-key"}
                  className={inputCls("pr-10")}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Timeout + Retries */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Timeout (s)
              </label>
              <input
                {...register("timeout")}
                type="number"
                min={5}
                max={300}
                autoComplete="off"
                className={cn(numberInputCls("mt-1"), errors.timeout && "border-destructive")}
              />
              {errors.timeout && <p className={errorCls()}>{errors.timeout.message}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Retries
              </label>
              <input
                {...register("retryCount")}
                type="number"
                min={0}
                max={10}
                autoComplete="off"
                className={cn(numberInputCls("mt-1"), errors.retryCount && "border-destructive")}
              />
              {errors.retryCount && <p className={errorCls()}>{errors.retryCount.message}</p>}
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between py-2 px-3 bg-secondary/30 rounded-xl border border-white/5">
            <div>
              <p className="text-sm font-medium text-white">Enabled</p>
              <p className="text-xs text-muted-foreground">Allow agent to use this server</p>
            </div>
            <button
              type="button"
              onClick={() => setValue("enabled", !enabled, { shouldValidate: true })}
              aria-checked={enabled}
              role="switch"
              className={cn(
                "relative w-11 h-6 rounded-full transition-colors overflow-hidden flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                enabled ? "bg-primary" : "bg-secondary"
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-0 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-200",
                  enabled ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {isError && (
            <p className="text-sm text-destructive">
              Failed to {isEditing ? "update" : "add"} server. Please check the details and try again.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-all glow-effect disabled:opacity-50 flex items-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {primaryLabel()}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Server card ───────────────────────────────────────────────────────────

function ServerCard({
  server,
  liveStatus,
  onEdit,
  onDelete,
  onClick,
}: {
  server: McpServer;
  liveStatus?: { status: McpLiveStatus; latencyMs?: number } | null;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const displayStatus = liveStatus?.status ?? server.status;
  const latencyMs = liveStatus?.latencyMs;

  return (
    <div
      onClick={onClick}
      className="glass-panel p-5 rounded-2xl flex flex-col group hover:border-white/15 transition-all cursor-pointer"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/5 flex items-center justify-center flex-shrink-0">
            <Server className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white leading-tight">{server.name}</h3>
            <StatusDot status={displayStatus} latencyMs={latencyMs} />
          </div>
        </div>

        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            className="p-1.5 bg-secondary rounded-lg text-muted-foreground hover:text-white transition-colors"
            title="Edit server"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 bg-destructive/10 rounded-lg text-destructive hover:bg-destructive hover:text-white transition-colors"
            title="Delete server"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {server.description && (
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{server.description}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs bg-secondary rounded-lg px-2 py-0.5 text-muted-foreground font-mono">
          {server.transportType}
        </span>
        <span className="text-xs bg-secondary rounded-lg px-2 py-0.5 text-muted-foreground flex items-center gap-1">
          <Wrench className="w-3 h-3" />
          {server.toolCount ?? 0} tools
        </span>
        {!server.enabled && (
          <span className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-lg px-2 py-0.5">
            disabled
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function McpServersPage() {
  const { data: servers, isLoading } = useListMcpServers();
  const deleteMutation = useDeleteMcpServer();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { getLiveStatus } = useMcpHealth();

  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [showAgentSidebar, setShowAgentSidebar] = useState(false);

  const handleDelete = (e: React.MouseEvent, server: McpServer) => {
    e.stopPropagation();
    if (!confirm(`Delete "${server.name}"? This will also remove all its tools and resources.`)) return;
    deleteMutation.mutate(
      { id: server.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
        },
      }
    );
  };

  const handleCloseForm = () => {
    setShowFormDialog(false);
    setEditingServer(null);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <McpAgentSidebar
        open={showAgentSidebar}
        onClose={() => setShowAgentSidebar(false)}
        servers={servers ?? []}
      />

      {/* Full-width management layout — no sidebar */}
      <main
        className={cn(
          "flex-1 overflow-y-auto p-8 custom-scrollbar transition-all duration-300",
          showAgentSidebar && "lg:pr-[396px]"
        )}
      >
        <div className="max-w-5xl mx-auto">
          {/* Back button */}
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors mb-6 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back to Chat
          </button>

          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-display font-bold text-white">MCP Servers</h1>
              <p className="text-muted-foreground mt-1.5">
                Connect tools and data sources via Model Context Protocol.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAgentSidebar((v) => !v)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all",
                  showAgentSidebar
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30"
                    : "bg-secondary/60 text-muted-foreground border border-white/8 hover:text-white hover:bg-secondary"
                )}
                title="Open AI Assistant"
              >
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">AI Assistant</span>
              </button>
              <button
                onClick={() => {
                  setEditingServer(null);
                  setShowFormDialog(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl font-medium shadow-lg glow-effect transition-transform hover:-translate-y-0.5"
              >
                <Plus className="w-4 h-4" /> Add Server
              </button>
            </div>
          </div>

          {isLoading ? (
            <PageLoader />
          ) : !servers?.length ? (
            <div className="glass-panel rounded-3xl p-12 flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-secondary rounded-2xl flex items-center justify-center mb-6 shadow-xl">
                <Server className="w-10 h-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">No servers connected</h3>
              <p className="text-muted-foreground max-w-sm mb-6">
                Connect your first MCP server to give the agent access to databases, APIs, and file systems.
              </p>
              <button
                onClick={() => setShowFormDialog(true)}
                className="px-6 py-3 bg-secondary text-white rounded-xl hover:bg-secondary/80 transition-colors border border-border"
              >
                Add Your First Server
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  liveStatus={getLiveStatus(server.id)}
                  onClick={() => setLocation(`/servers/${server.id}`)}
                  onEdit={(e) => {
                    e.stopPropagation();
                    setEditingServer(server);
                    setShowFormDialog(true);
                  }}
                  onDelete={(e) => handleDelete(e, server)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {showFormDialog && (
        <ServerFormDialog server={editingServer} onClose={handleCloseForm} />
      )}
    </div>
  );
}
