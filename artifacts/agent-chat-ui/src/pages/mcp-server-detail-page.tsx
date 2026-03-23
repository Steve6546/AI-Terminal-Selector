import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useListMcpServers,
  useDeleteMcpServer,
  useTestMcpServerConnection,
  useDiscoverMcpTools,
  useUpdateMcpServer,
  useListMcpTools,
  useListMcpResources,
  useListMcpPrompts,
  useUpdateMcpTool,
} from "@workspace/api-client-react";
import type { McpServer, McpTool, McpResource, McpPrompt } from "@workspace/api-client-react";
import {
  getListMcpServersQueryKey,
  getListMcpToolsQueryKey,
  getListMcpResourcesQueryKey,
  getListMcpPromptsQueryKey,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Server,
  RefreshCcw,
  Zap,
  Trash2,
  Settings2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Wrench,
  Database,
  MessageSquare,
  Shield,
  ShieldAlert,
  ChevronDown,
  Code2,
  X,
  Power,
  PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { PageLoader } from "@/components/ui/loader";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Globe, Key, Lock } from "lucide-react";

// ─── Helpers ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-green-400 text-sm font-mono">
        <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
        Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1.5 text-red-400 text-sm font-mono">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
        Error
      </span>
    );
  }
  if (status === "checking") {
    return (
      <span className="flex items-center gap-1.5 text-yellow-400 text-sm font-mono">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-sm font-mono">
      <span className="w-2.5 h-2.5 rounded-full bg-gray-500" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
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
  type RunResult = { success: boolean; output?: unknown; error?: string; durationMs?: number | null };
  const [result, setResult] = useState<RunResult | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsJson) as Record<string, unknown>; } catch { /* bad json */ }
      const resp = await fetch(`/api/mcp-tools/${tool.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ arguments: args }),
      });
      if (!resp.ok) {
        const err = await resp.json() as { error?: string };
        setResult({ success: false, error: err.error ?? `HTTP ${resp.status}` });
        return;
      }
      const data = await resp.json() as {
        status: string;
        rawResult?: unknown;
        errorMessage?: string;
        resultSummary?: string;
        durationMs?: number | null;
      };
      const succeeded = data.status === "success";
      setResult({
        success: succeeded,
        output: data.rawResult ?? data.resultSummary,
        error: data.errorMessage ?? undefined,
        durationMs: data.durationMs,
      });
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
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold">{result.success ? "Success" : "Error"}</p>
                {result.durationMs != null && (
                  <span className="text-[10px] opacity-60">{result.durationMs}ms</span>
                )}
              </div>
              <pre className="whitespace-pre-wrap break-all text-[11px] max-h-48 overflow-y-auto">
                {result.error ?? (typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2))}
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

// ─── Edit Server Dialog ────────────────────────────────────────────────────

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

function inputCls(extra?: string) {
  return cn(
    "w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors",
    extra
  );
}

function errorCls(extra?: string) {
  return cn("text-xs text-destructive mt-1", extra);
}

function EditServerDialog({ server, onClose }: { server: McpServer; onClose: () => void }) {
  const queryClient = useQueryClient();
  const updateMutation = useUpdateMcpServer();
  const [showSecret, setShowSecret] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ServerFormValues>({
    resolver: zodResolver(serverFormSchema),
    defaultValues: {
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
    },
  });

  const transportType = watch("transportType");
  const authType = watch("authType");
  const enabled = watch("enabled");

  const onSubmit = (values: ServerFormValues) => {
    const backendAuthType = values.authType === "oauth" ? "none" : values.authType;
    updateMutation.mutate(
      {
        id: server.id,
        data: {
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
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
          onClose();
        },
      }
    );
  };

  const authOptions = [
    { value: "none" as const, label: "No Auth", icon: Globe, description: "Public endpoint" },
    { value: "bearer" as const, label: "Bearer Token", icon: Key, description: "Authorization header" },
    { value: "api-key" as const, label: "API Key", icon: Lock, description: "Custom key" },
    { value: "oauth" as const, label: "OAuth", icon: Zap, description: "Authorize next step" },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar border border-white/10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-white">Edit Server Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Server Name <span className="text-destructive">*</span>
            </label>
            <input
              {...register("name")}
              type="text"
              className={cn(inputCls("mt-1"), errors.name && "border-destructive")}
            />
            {errors.name && <p className={errorCls()}>{errors.name.message}</p>}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</label>
            <input {...register("description")} type="text" className={inputCls("mt-1")} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Connection Type</label>
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

          {transportType === "streamable-http" ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                URL <span className="text-destructive">*</span>
              </label>
              <input
                {...register("endpoint")}
                type="url"
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
                  className={cn(inputCls("mt-1 font-mono"), errors.command && "border-destructive")}
                />
                {errors.command && <p className={errorCls()}>{errors.command.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Additional Args</label>
                <input {...register("args")} type="text" className={inputCls("mt-1 font-mono")} />
              </div>
            </>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Authentication</label>
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
                  <opt.icon className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", authType === opt.value ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <p className={cn("text-xs font-medium leading-tight", authType === opt.value ? "text-primary" : "text-white")}>{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {(authType === "bearer" || authType === "api-key") && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {authType === "bearer" ? "Bearer Token" : "API Key"}
              </label>
              <p className="text-xs text-muted-foreground mb-1">Leave blank to keep existing secret</p>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Timeout (s)</label>
              <input {...register("timeout")} type="number" min={5} max={300} className={cn(inputCls("mt-1"), errors.timeout && "border-destructive")} />
              {errors.timeout && <p className={errorCls()}>{errors.timeout.message}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Retries</label>
              <input {...register("retryCount")} type="number" min={0} max={10} className={cn(inputCls("mt-1"), errors.retryCount && "border-destructive")} />
              {errors.retryCount && <p className={errorCls()}>{errors.retryCount.message}</p>}
            </div>
          </div>

          <div className="flex items-center justify-between py-2 px-3 bg-secondary/30 rounded-xl border border-white/5">
            <div>
              <p className="text-sm font-medium text-white">Enabled</p>
              <p className="text-xs text-muted-foreground">Allow agent to use this server</p>
            </div>
            <button
              type="button"
              onClick={() => setValue("enabled", !enabled, { shouldValidate: true })}
              className={cn("relative w-11 h-6 rounded-full transition-colors", enabled ? "bg-primary" : "bg-secondary")}
            >
              <span className={cn("absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform", enabled ? "translate-x-6" : "translate-x-1")} />
            </button>
          </div>

          {updateMutation.isError && (
            <p className="text-sm text-destructive">Failed to update server. Please check the details and try again.</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-white/5 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-all glow-effect disabled:opacity-50 flex items-center gap-2"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Detail content for a single server ────────────────────────────────────

function ServerDetail({ server }: { server: McpServer }) {
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteMcpServer();
  const testMutation = useTestMcpServerConnection();
  const discoverMutation = useDiscoverMcpTools();
  const updateMutation = useUpdateMcpServer();
  const [, setLocation] = useLocation();

  const { data: tools, isLoading: toolsLoading } = useListMcpTools(server.id);
  const { data: resources, isLoading: resourcesLoading } = useListMcpResources(server.id);
  const { data: prompts, isLoading: promptsLoading } = useListMcpPrompts(server.id);

  const [activeTab, setActiveTab] = useState<"tools" | "resources" | "prompts">("tools");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs: number;
  } | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMcpToolsQueryKey(server.id) });
    queryClient.invalidateQueries({ queryKey: getListMcpResourcesQueryKey(server.id) });
    queryClient.invalidateQueries({ queryKey: getListMcpPromptsQueryKey(server.id) });
  };

  const handleTest = () => {
    setTestResult(null);
    testMutation.mutate(
      { id: server.id },
      {
        onSuccess: (data) => {
          setTestResult({ success: data.success, message: data.message, latencyMs: data.latencyMs ?? 0 });
          queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
        },
      }
    );
  };

  const handleRediscover = () => {
    discoverMutation.mutate({ id: server.id }, { onSuccess: invalidateAll });
  };

  const handleToggleEnabled = () => {
    updateMutation.mutate(
      { id: server.id, data: { enabled: !server.enabled } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() }) }
    );
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${server.name}"? This will also remove all its tools and resources.`)) return;
    deleteMutation.mutate(
      { id: server.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMcpServersQueryKey() });
          setLocation("/servers");
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
    <>
      {showEditDialog && (
        <EditServerDialog server={server} onClose={() => setShowEditDialog(false)} />
      )}

      <div className="space-y-6">
        {/* Header card */}
        <div className="glass-panel rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center flex-shrink-0">
                <Server className="w-7 h-7 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-bold text-white">{server.name}</h2>
                <StatusDot status={server.status} />
                {server.description && (
                  <p className="text-sm text-muted-foreground mt-1">{server.description}</p>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleTest}
                disabled={testMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 bg-secondary hover:bg-secondary/80 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
              >
                {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                Re-test
              </button>
              <button
                onClick={handleRediscover}
                disabled={discoverMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
              >
                {discoverMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Re-discover
              </button>
              <button
                onClick={() => setShowEditDialog(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-secondary hover:bg-secondary/80 text-white rounded-xl text-xs font-medium transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Edit
              </button>
              <button
                onClick={handleToggleEnabled}
                disabled={updateMutation.isPending}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors disabled:opacity-50",
                  server.enabled
                    ? "bg-orange-500/10 text-orange-400 hover:bg-orange-500/20"
                    : "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                )}
              >
                {server.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                {server.enabled ? "Disable" : "Enable"}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={cn(
              "flex items-start gap-2 text-xs p-3 rounded-xl mt-4",
              testResult.success
                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            )}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
              <div>
                <p className="font-medium">{testResult.success ? "Connected successfully" : "Connection failed"}</p>
                <p className="opacity-80 mt-0.5">{testResult.message}</p>
                {testResult.latencyMs > 0 && <p className="opacity-60 mt-0.5">{testResult.latencyMs}ms latency</p>}
              </div>
            </div>
          )}

          {testMutation.isError && !testResult && (
            <div className="flex items-center gap-2 text-xs p-3 rounded-xl mt-4 bg-red-500/10 text-red-400 border border-red-500/20">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Test request failed. Check the server address and your network.
            </div>
          )}

          {discoverMutation.isError && (
            <div className="flex items-center gap-2 text-xs p-3 rounded-xl mt-4 bg-red-500/10 text-red-400 border border-red-500/20">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Discovery failed: {String(discoverMutation.error)}
            </div>
          )}
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Connection Type", value: server.transportType, mono: true },
            { label: "Address", value: server.endpoint ?? server.command ?? "—", mono: true, truncate: true },
            { label: "Authentication", value: server.authType ?? "none", mono: true },
            { label: "Status", value: server.enabled ? "Enabled" : "Disabled", colored: server.enabled ? "text-green-400" : "text-orange-400" },
          ].map((item) => (
            <div key={item.label} className="glass-panel rounded-xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{item.label}</p>
              <p className={cn(
                "text-sm font-medium text-white",
                item.mono && "font-mono",
                item.truncate && "truncate",
                item.colored
              )}>
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {/* Last Error */}
        <div className="glass-panel rounded-2xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Last Error</p>
          {server.status === "error" ? (
            <p className="text-sm text-red-400 font-mono break-all">
              Connection failed — check server address, auth credentials, and network connectivity.
              {server.lastCheckedAt && (
                <span className="block text-xs text-muted-foreground mt-1">
                  Last checked: {new Date(server.lastCheckedAt).toLocaleString()}
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              None
              {server.lastCheckedAt && (
                <span className="ml-2 text-xs text-muted-foreground font-mono">
                  (last checked {new Date(server.lastCheckedAt).toLocaleString()})
                </span>
              )}
            </p>
          )}
        </div>

        {/* Capabilities tabs */}
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="flex border-b border-white/5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "text-primary border-b-2 border-primary bg-primary/5"
                    : "text-muted-foreground hover:text-white"
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                <span className="text-xs bg-secondary rounded-full px-2 py-0.5">{tab.count}</span>
              </button>
            ))}
          </div>

          <div className="p-5">
            {activeTab === "tools" && (
              <div className="space-y-2">
                {toolsLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : !tools?.length ? (
                  <EmptyTab icon={Wrench} label="No tools discovered" hint="Click Re-discover to fetch tools from this server" />
                ) : (
                  tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)
                )}
              </div>
            )}
            {activeTab === "resources" && (
              <div className="space-y-2">
                {resourcesLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : !resources?.length ? (
                  <EmptyTab icon={Database} label="No resources discovered" hint="Click Re-discover to fetch resources from this server" />
                ) : (
                  resources.map((r) => <ResourceCard key={r.id} resource={r} />)
                )}
              </div>
            )}
            {activeTab === "prompts" && (
              <div className="space-y-2">
                {promptsLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : !prompts?.length ? (
                  <EmptyTab icon={MessageSquare} label="No prompts discovered" hint="Click Re-discover to fetch prompts from this server" />
                ) : (
                  prompts.map((p) => <PromptCard key={p.id} prompt={p} />)
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function McpServerDetailPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const serverId = parseInt(params.id ?? "", 10);

  const { data: servers, isLoading } = useListMcpServers();
  const server = servers?.find((s) => s.id === serverId) ?? null;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-4xl mx-auto">
          {/* Back button */}
          <button
            onClick={() => setLocation("/servers")}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors mb-6 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back to MCP Servers
          </button>

          {isLoading ? (
            <PageLoader />
          ) : !server ? (
            <div className="glass-panel rounded-2xl p-12 flex flex-col items-center text-center">
              <Server className="w-12 h-12 text-muted-foreground mb-4 opacity-40" />
              <h3 className="text-lg font-semibold text-white mb-2">Server not found</h3>
              <p className="text-muted-foreground text-sm mb-4">This server may have been deleted.</p>
              <button
                onClick={() => setLocation("/servers")}
                className="px-4 py-2 bg-secondary text-white rounded-xl text-sm hover:bg-secondary/80 transition-colors"
              >
                View all servers
              </button>
            </div>
          ) : (
            <ServerDetail server={server} />
          )}
        </div>
      </main>
    </div>
  );
}
