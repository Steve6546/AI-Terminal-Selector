import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Sidebar } from "@/components/layout/sidebar";
import {
  useListMcpServers,
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
  useTestMcpServerConnection,
  useDiscoverMcpTools,
  useListMcpTools,
  useListMcpResources,
  useListMcpPrompts,
  useUpdateMcpTool,
} from "@workspace/api-client-react";
import type { McpServer, McpTool, McpResource, McpPrompt } from "@workspace/api-client-react";
import {
  Server,
  Plus,
  Trash2,
  Settings2,
  X,
  RefreshCcw,
  Zap,
  ChevronRight,
  ChevronDown,
  Wrench,
  Database,
  MessageSquare,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Shield,
  ShieldAlert,
  Code2,
} from "lucide-react";
import { PageLoader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListMcpServersQueryKey,
  getListMcpToolsQueryKey,
  getListMcpResourcesQueryKey,
  getListMcpPromptsQueryKey,
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
    authType: z.enum(["none", "bearer", "api-key"]),
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

function StatusDot({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-green-400 text-xs font-mono">
        <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
        CONNECTED
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1.5 text-red-400 text-xs font-mono">
        <span className="w-2 h-2 rounded-full bg-red-500" />
        ERROR
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

function CollapsibleJson({ schema }: { schema: Record<string, unknown> | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!schema || Object.keys(schema).length === 0) return null;
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white transition-colors"
      >
        <Code2 className="w-3 h-3" />
        <span>{open ? "Hide" : "View"} schema</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="mt-1.5 text-xs bg-black/40 rounded-lg p-2 overflow-x-auto text-muted-foreground border border-white/5 max-h-48">
          {JSON.stringify(schema, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Tool / Resource / Prompt cards ────────────────────────────────────────

function ToolRunDialog({ tool, onClose }: { tool: McpTool; onClose: () => void }) {
  const schema = tool.inputSchema as Record<string, unknown> | null;
  const schemaProps = (schema?.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const [argsJson, setArgsJson] = useState(
    Object.keys(schemaProps).length > 0
      ? JSON.stringify(Object.fromEntries(Object.keys(schemaProps).map((k) => [k, ""])), null, 2)
      : "{}"
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; content?: unknown; error?: string } | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsJson) as Record<string, unknown>; } catch { /* bad json */ }
      const resp = await fetch(`/api/mcp-tools/${tool.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arguments: args }),
      });
      const data = await resp.json() as { success: boolean; content?: unknown; error?: string };
      setResult(data);
    } catch (e) {
      setResult({ success: false, error: String(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel rounded-2xl p-6 w-full max-w-lg border border-white/10 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white font-mono">{tool.toolName}</h2>
            {tool.description && <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Arguments (JSON)</label>
            <textarea
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              rows={8}
              className="w-full mt-1 bg-background/60 border border-white/10 rounded-xl p-3 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            {Object.keys(schemaProps).length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(schemaProps).map(([key, info]) => (
                  <p key={key} className="text-[10px] text-muted-foreground font-mono">
                    <span className="text-primary">{key}</span>
                    {info.type ? ` (${info.type})` : ""}
                    {info.description ? ` — ${info.description}` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>

          {result && (
            <div className={cn(
              "rounded-xl p-3 text-xs font-mono border",
              result.success
                ? "bg-green-500/10 border-green-500/20 text-green-300"
                : "bg-red-500/10 border-red-500/20 text-red-300"
            )}>
              <p className="font-semibold mb-1">{result.success ? "Success" : "Error"}</p>
              <pre className="whitespace-pre-wrap break-all text-[11px]">
                {result.error ?? JSON.stringify(result.content, null, 2)}
              </pre>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleRun}
              disabled={running}
              className="flex-1 py-2.5 bg-primary text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Running...</> : <><Zap className="w-4 h-4" /> Execute Tool</>}
            </button>
            <button onClick={onClose} className="px-4 py-2.5 bg-secondary text-muted-foreground rounded-xl text-sm hover:text-white transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: McpTool }) {
  const updateTool = useUpdateMcpTool();
  const queryClient = useQueryClient();
  const [showRunDialog, setShowRunDialog] = useState(false);

  const toggle = (field: "enabled" | "requiresApproval", current: boolean) => {
    updateTool.mutate(
      { toolId: tool.id, data: { [field]: !current } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMcpToolsQueryKey(tool.serverId) });
        },
      }
    );
  };

  return (
    <>
      {showRunDialog && <ToolRunDialog tool={tool} onClose={() => setShowRunDialog(false)} />}
      <div className="p-3 rounded-xl bg-secondary/30 border border-white/5 hover:border-white/10 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white font-mono truncate">{tool.toolName}</p>
            {tool.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tool.description}</p>
            )}
            <CollapsibleJson schema={tool.inputSchema as Record<string, unknown> | null} />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowRunDialog(true)}
              title="Execute this tool directly"
              className="p-1.5 rounded-lg transition-colors text-muted-foreground hover:bg-primary/20 hover:text-primary"
            >
              <Zap className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => toggle("requiresApproval", tool.requiresApproval)}
              title={tool.requiresApproval ? "Requires approval" : "Auto-execute"}
              className={cn(
                "p-1.5 rounded-lg transition-colors",
                tool.requiresApproval
                  ? "text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20"
                  : "text-muted-foreground hover:bg-white/5"
              )}
            >
              {tool.requiresApproval ? <ShieldAlert className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => toggle("enabled", tool.enabled)}
              className={cn(
                "relative w-9 h-5 rounded-full transition-colors",
                tool.enabled ? "bg-primary" : "bg-secondary"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                  tool.enabled ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ResourceCard({ resource }: { resource: McpResource }) {
  return (
    <div className="p-3 rounded-xl bg-secondary/30 border border-white/5">
      <div className="flex items-start gap-2">
        <Database className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{resource.resourceName}</p>
          {resource.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{resource.description}</p>
          )}
          <p className="text-xs font-mono text-muted-foreground mt-1">{resource.resourceType}</p>
        </div>
      </div>
    </div>
  );
}

function PromptCard({ prompt }: { prompt: McpPrompt }) {
  return (
    <div className="p-3 rounded-xl bg-secondary/30 border border-white/5">
      <div className="flex items-start gap-2">
        <MessageSquare className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white font-mono truncate">{prompt.promptName}</p>
          {prompt.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{prompt.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Capabilities drawer ───────────────────────────────────────────────────

function CapabilitiesDrawer({ server, onClose }: { server: McpServer; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"tools" | "resources" | "prompts">("tools");
  const { data: tools, isLoading: toolsLoading } = useListMcpTools(server.id);
  const { data: resources, isLoading: resourcesLoading } = useListMcpResources(server.id);
  const { data: prompts, isLoading: promptsLoading } = useListMcpPrompts(server.id);
  const discoverMutation = useDiscoverMcpTools();
  const queryClient = useQueryClient();

  const handleRediscover = () => {
    discoverMutation.mutate(
      { id: server.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMcpToolsQueryKey(server.id) });
          queryClient.invalidateQueries({ queryKey: getListMcpResourcesQueryKey(server.id) });
          queryClient.invalidateQueries({ queryKey: getListMcpPromptsQueryKey(server.id) });
        },
      }
    );
  };

  const tabs = [
    { key: "tools" as const, label: "Tools", icon: Wrench, count: tools?.length ?? 0 },
    { key: "resources" as const, label: "Resources", icon: Database, count: resources?.length ?? 0 },
    { key: "prompts" as const, label: "Prompts", icon: MessageSquare, count: prompts?.length ?? 0 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-md glass-panel flex flex-col border-l border-white/10 animate-slide-left">
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div>
            <h2 className="text-base font-bold text-white">{server.name}</h2>
            <StatusDot status={server.status} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRediscover}
              disabled={discoverMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {discoverMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
              {discoverMutation.isPending ? "Discovering…" : "Rediscover"}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-white/5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors",
                activeTab === tab.key
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-white"
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              <span className="text-xs bg-secondary rounded-full px-1.5">{tab.count}</span>
            </button>
          ))}
        </div>

        {discoverMutation.isError && (
          <div className="mx-4 mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive">
            Discovery failed: {String(discoverMutation.error)}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {activeTab === "tools" && (
            <div className="space-y-2">
              {toolsLoading ? (
                <EmptyLoading />
              ) : !tools?.length ? (
                <EmptyTab icon={Wrench} label="No tools discovered" hint="Click Rediscover to fetch tools" />
              ) : (
                tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)
              )}
            </div>
          )}
          {activeTab === "resources" && (
            <div className="space-y-2">
              {resourcesLoading ? (
                <EmptyLoading />
              ) : !resources?.length ? (
                <EmptyTab icon={Database} label="No resources discovered" hint="Click Rediscover to fetch resources" />
              ) : (
                resources.map((r) => <ResourceCard key={r.id} resource={r} />)
              )}
            </div>
          )}
          {activeTab === "prompts" && (
            <div className="space-y-2">
              {promptsLoading ? (
                <EmptyLoading />
              ) : !prompts?.length ? (
                <EmptyTab icon={MessageSquare} label="No prompts discovered" hint="Click Rediscover to fetch prompts" />
              ) : (
                prompts.map((p) => <PromptCard key={p.id} prompt={p} />)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyLoading() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyTab({
  icon: Icon,
  label,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <div className="text-center py-8 text-muted-foreground text-sm">
      <Icon className="w-8 h-8 mx-auto mb-2 opacity-30" />
      <p>{label}</p>
      <p className="text-xs mt-1">{hint}</p>
    </div>
  );
}

// ─── Input helpers ─────────────────────────────────────────────────────────

function inputCls(extra?: string) {
  return cn(
    "w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors",
    extra
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
    formState: { errors, isValid, isDirty },
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
          authType: (server.authType as "none" | "bearer" | "api-key") ?? "none",
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
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      transportType: values.transportType,
      endpoint: values.transportType === "streamable-http" ? values.endpoint?.trim() : undefined,
      command: values.transportType === "stdio" ? values.command?.trim() : undefined,
      args: values.args?.trim() ? values.args.trim().split(/\s+/) : [],
      authType: values.authType,
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
              Name <span className="text-destructive">*</span>
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
              {(["streamable-http", "stdio"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setValue("transportType", t, { shouldValidate: true })}
                  className={cn(
                    "py-2.5 px-3 rounded-xl text-sm font-medium transition-colors border",
                    transportType === t
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-secondary border-border text-muted-foreground hover:text-white"
                  )}
                >
                  {t === "streamable-http" ? "HTTP (Remote)" : "stdio (Local)"}
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
                placeholder="https://my-mcp-server.example.com/mcp"
                className={cn(inputCls("mt-1"), errors.endpoint && "border-destructive")}
              />
              {errors.endpoint && <p className={errorCls()}>{errors.endpoint.message}</p>}
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
                  placeholder="npx @modelcontextprotocol/server-filesystem"
                  className={cn(inputCls("mt-1 font-mono"), errors.command && "border-destructive")}
                />
                {errors.command && <p className={errorCls()}>{errors.command.message}</p>}
                <p className="text-xs text-muted-foreground mt-1">Full shell command to launch the MCP server</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Additional Args
                </label>
                <input
                  {...register("args")}
                  type="text"
                  placeholder="/path/to/files --flag"
                  className={inputCls("mt-1 font-mono")}
                />
                <p className="text-xs text-muted-foreground mt-1">Space-separated extra arguments</p>
              </div>
            </>
          )}

          {/* Auth Type + Timeout + Retries */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Auth
              </label>
              <select {...register("authType")} className={inputCls("mt-1")}>
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="api-key">API Key</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Timeout (s)
              </label>
              <input
                {...register("timeout")}
                type="number"
                min={5}
                max={300}
                className={cn(inputCls("mt-1"), errors.timeout && "border-destructive")}
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
                className={cn(inputCls("mt-1"), errors.retryCount && "border-destructive")}
              />
              {errors.retryCount && <p className={errorCls()}>{errors.retryCount.message}</p>}
            </div>
          </div>

          {/* Auth Secret */}
          {authType !== "none" && (
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

          {/* Enabled toggle */}
          <div className="flex items-center justify-between py-2 px-3 bg-secondary/30 rounded-xl border border-white/5">
            <div>
              <p className="text-sm font-medium text-white">Enabled</p>
              <p className="text-xs text-muted-foreground">Allow agent to use this server</p>
            </div>
            <button
              type="button"
              onClick={() => setValue("enabled", !enabled, { shouldValidate: true })}
              className={cn(
                "relative w-11 h-6 rounded-full transition-colors",
                enabled ? "bg-primary" : "bg-secondary"
              )}
            >
              <span
                className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
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
              className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-all glow-effect disabled:opacity-50"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isEditing ? "Saving…" : "Adding…"}
                </span>
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Add Server"
              )}
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
  onOpenCapabilities,
  onEdit,
  onDelete,
}: {
  server: McpServer;
  onOpenCapabilities: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const testMutation = useTestMcpServerConnection();
  const discoverMutation = useDiscoverMcpTools();
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs: number;
  } | null>(null);

  const handleTest = () => {
    setTestResult(null);
    testMutation.mutate(
      { id: server.id },
      {
        onSuccess: (data) => {
          setTestResult({
            success: data.success,
            message: data.message,
            latencyMs: data.latencyMs ?? 0,
          });
          queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
        },
      }
    );
  };

  const handleDiscover = () => {
    discoverMutation.mutate(
      { id: server.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMcpToolsQueryKey(server.id) });
          queryClient.invalidateQueries({ queryKey: getListMcpResourcesQueryKey(server.id) });
          queryClient.invalidateQueries({ queryKey: getListMcpPromptsQueryKey(server.id) });
        },
      }
    );
  };

  return (
    <div className="glass-panel p-5 rounded-2xl flex flex-col group hover:border-white/10 transition-all">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/5 flex items-center justify-center flex-shrink-0">
            <Server className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white leading-tight">{server.name}</h3>
            <StatusDot status={server.status} />
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

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs bg-secondary rounded-lg px-2 py-0.5 text-muted-foreground font-mono">
          {server.transportType}
        </span>
        <span className="text-xs bg-secondary rounded-lg px-2 py-0.5 text-muted-foreground">
          {server.toolCount ?? 0} tools
        </span>
        {!server.enabled && (
          <span className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-lg px-2 py-0.5">
            disabled
          </span>
        )}
        {server.endpoint && (
          <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
            {server.endpoint}
          </span>
        )}
        {server.command && (
          <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
            {server.command}
          </span>
        )}
      </div>

      {testResult && (
        <div
          className={cn(
            "flex items-start gap-2 text-xs p-2.5 rounded-xl mb-3",
            testResult.success
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          )}
        >
          {testResult.success ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-medium">{testResult.success ? "Connected" : "Failed"}</p>
            <p className="opacity-80">{testResult.message}</p>
            {testResult.latencyMs > 0 && (
              <p className="opacity-60">{testResult.latencyMs}ms</p>
            )}
          </div>
        </div>
      )}

      {testMutation.isError && !testResult && (
        <div className="flex items-center gap-2 text-xs p-2.5 rounded-xl mb-3 bg-red-500/10 text-red-400 border border-red-500/20">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Test request failed
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto pt-3 border-t border-white/5">
        <button
          onClick={handleTest}
          disabled={testMutation.isPending}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium bg-secondary hover:bg-secondary/80 text-white rounded-xl transition-colors disabled:opacity-50"
        >
          {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
          {testMutation.isPending ? "Testing…" : "Test"}
        </button>
        <button
          onClick={handleDiscover}
          disabled={discoverMutation.isPending}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium bg-primary/20 hover:bg-primary/30 text-primary rounded-xl transition-colors disabled:opacity-50"
        >
          {discoverMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {discoverMutation.isPending ? "Discovering…" : "Discover"}
        </button>
        <button
          onClick={onOpenCapabilities}
          className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium bg-secondary hover:bg-secondary/80 text-white rounded-xl transition-colors"
          title="View tools, resources & prompts"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function McpServersPage() {
  const { data: servers, isLoading } = useListMcpServers();
  const deleteMutation = useDeleteMcpServer();
  const queryClient = useQueryClient();

  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [capabilitiesServer, setCapabilitiesServer] = useState<McpServer | null>(null);

  const handleDelete = (server: McpServer) => {
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
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-display font-bold text-white">MCP Servers</h1>
              <p className="text-muted-foreground mt-1.5">
                Connect tools and data sources via Model Context Protocol.
              </p>
            </div>
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
                  onOpenCapabilities={() => setCapabilitiesServer(server)}
                  onEdit={() => {
                    setEditingServer(server);
                    setShowFormDialog(true);
                  }}
                  onDelete={() => handleDelete(server)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {showFormDialog && (
        <ServerFormDialog server={editingServer} onClose={handleCloseForm} />
      )}

      {capabilitiesServer && (
        <CapabilitiesDrawer
          server={capabilitiesServer}
          onClose={() => setCapabilitiesServer(null)}
        />
      )}
    </div>
  );
}
