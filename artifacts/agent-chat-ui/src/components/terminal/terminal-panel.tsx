import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { X, Maximize2, Minimize2, Terminal as TerminalIcon, FileOutput, AlertCircle, Trash2, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "shell" | "output" | "errors";

interface TerminalPanelProps {
  onClose: () => void;
  toolOutputLines?: string[];
  errorLines?: string[];
}

export function TerminalPanel({ onClose, toolOutputLines = [], errorLines = [] }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [shellStatus, setShellStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [activeTab, setActiveTab] = useState<Tab>("shell");
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [copiedErrors, setCopiedErrors] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const errorsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll output and errors on new content
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [toolOutputLines]);

  useEffect(() => {
    if (errorsRef.current) {
      errorsRef.current.scrollTop = errorsRef.current.scrollHeight;
    }
    if (errorLines.length > 0 && activeTab !== "errors") {
      // Badge is shown via errorLines.length check in tabs
    }
  }, [errorLines, activeTab]);

  // Fit terminal when tab switches to shell
  useEffect(() => {
    if (activeTab === "shell") {
      setTimeout(() => fitAddonRef.current?.fit(), 50);
    }
  }, [activeTab, isMaximized]);

  const connect = useCallback(async () => {
    if (!containerRef.current) return;

    if (terminalRef.current) terminalRef.current.dispose();
    if (wsRef.current) wsRef.current.close();

    const term = new Terminal({
      theme: {
        background: "#0a0a0f",
        foreground: "#e8e8f0",
        cursor: "#6366f1",
        cursorAccent: "#0a0a0f",
        selectionBackground: "rgba(99, 102, 241, 0.3)",
        black: "#1a1a2e",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e8e8f0",
        brightBlack: "#374151",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#f59e0b",
        brightBlue: "#3b82f6",
        brightMagenta: "#a855f7",
        brightCyan: "#06b6d4",
        brightWhite: "#f9fafb",
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    let token: string | null = null;
    try {
      const resp = await fetch("/api/terminal/token", {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      const data = await resp.json() as { token: string };
      token = data.token;
    } catch {
      term.write("\r\n\x1b[31m[Could not obtain terminal token — is the API server running?]\x1b[0m\r\n");
      setShellStatus("disconnected");
      return;
    }

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/terminal?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setShellStatus("connected");
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as { type: "output" | "exit" | "error" | "session"; data?: string; message?: string; sessionId?: string; exitCode?: number };
        if (msg.type === "session") {
          // session established
        } else if (msg.type === "output" && msg.data) {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.write(`\r\n\x1b[33m[Session ended (exit ${msg.exitCode ?? "?"}). Reconnecting...]\x1b[0m\r\n`);
          setShellStatus("disconnected");
          setTimeout(connect, 2000);
        } else if (msg.type === "error") {
          term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
          setShellStatus("disconnected");
          if (msg.message?.includes("timed out")) {
            setTimeout(connect, 1000);
          }
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[WebSocket error — is the server running?]\x1b[0m\r\n");
      setShellStatus("disconnected");
    };

    ws.onclose = () => setShellStatus("disconnected");

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      terminalRef.current?.dispose();
    };
  }, [connect]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => fitAddonRef.current?.fit());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const copyText = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: "shell",
      label: "Shell",
      icon: <TerminalIcon className="w-3.5 h-3.5" />,
    },
    {
      id: "output",
      label: "Tool Output",
      icon: <FileOutput className="w-3.5 h-3.5" />,
      badge: toolOutputLines.length,
    },
    {
      id: "errors",
      label: "Errors",
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      badge: errorLines.length,
    },
  ];

  return (
    <div
      className={cn(
        "flex flex-col bg-[#0a0a0f] border-t border-border/80 transition-all duration-200",
        isMaximized ? "fixed inset-0 z-50" : "h-80"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/60 bg-card/50 shrink-0">
        {/* macOS dots */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 pl-1">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-0.5 ml-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all relative",
                  activeTab === tab.id
                    ? "bg-white/10 text-white"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                )}
              >
                {tab.icon}
                {tab.label}
                {tab.id === "shell" && (
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full ml-0.5",
                      shellStatus === "connected" ? "bg-green-500" :
                      shellStatus === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-red-500"
                    )}
                  />
                )}
                {tab.badge != null && tab.badge > 0 && (
                  <span className={cn(
                    "absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center",
                    tab.id === "errors" ? "bg-red-500 text-white" : "bg-primary text-white"
                  )}>
                    {tab.badge > 9 ? "9+" : tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMaximized((p) => !p)}
            className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {/* Shell — always mounted, hidden when not active so xterm state is preserved */}
        <div
          ref={containerRef}
          className={cn("h-full p-2", activeTab !== "shell" && "hidden")}
        />

        {/* Tool Output */}
        {activeTab === "output" && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/5 bg-black/20 shrink-0">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {toolOutputLines.length} output block{toolOutputLines.length !== 1 ? "s" : ""} from current run
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => copyText(toolOutputLines.join("\n\n"), setCopiedOutput)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                >
                  {copiedOutput ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copiedOutput ? "Copied" : "Copy all"}
                </button>
              </div>
            </div>
            <div
              ref={outputRef}
              className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3"
            >
              {toolOutputLines.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40">
                  <FileOutput className="w-8 h-8 mb-2" />
                  <p className="text-sm">No tool output yet</p>
                  <p className="text-xs mt-1">Tool results will appear here when the agent runs tools</p>
                </div>
              ) : (
                toolOutputLines.map((line, i) => (
                  <pre key={i} className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all bg-black/30 rounded-lg px-3 py-2 border border-white/5">
                    {line}
                  </pre>
                ))
              )}
            </div>
          </div>
        )}

        {/* Errors */}
        {activeTab === "errors" && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/5 bg-black/20 shrink-0">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {errorLines.length} error{errorLines.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => copyText(errorLines.join("\n"), setCopiedErrors)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                >
                  {copiedErrors ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copiedErrors ? "Copied" : "Copy all"}
                </button>
              </div>
            </div>
            <div
              ref={errorsRef}
              className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2"
            >
              {errorLines.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <p className="text-sm">No errors</p>
                  <p className="text-xs mt-1">Stream and tool errors will appear here</p>
                </div>
              ) : (
                errorLines.map((line, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs font-mono text-red-400 bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/20">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span className="break-all whitespace-pre-wrap">{line}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
