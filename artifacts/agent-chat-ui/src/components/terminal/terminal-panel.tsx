import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { X, Maximize2, Minimize2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  onClose: () => void;
}

export function TerminalPanel({ onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  const connect = useCallback(async () => {
    if (!containerRef.current) return;

    // Cleanup existing terminal
    if (terminalRef.current) {
      terminalRef.current.dispose();
    }
    if (wsRef.current) {
      wsRef.current.close();
    }

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

    // Fetch one-time auth token then connect WebSocket
    let token: string | null = null;
    try {
      const resp = await fetch("/api/terminal/token");
      const data = await resp.json() as { token: string };
      token = data.token;
    } catch {
      term.write("\r\n\x1b[31m[Could not obtain terminal token — is the API server running?]\x1b[0m\r\n");
      setStatus("disconnected");
      return;
    }

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/terminal?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: "output" | "exit" | "error";
          data?: string;
          message?: string;
        };
        if (msg.type === "output" && msg.data) {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.write("\r\n\x1b[33m[Terminal session ended. Reconnecting...]\x1b[0m\r\n");
          setStatus("disconnected");
          setTimeout(connect, 2000);
        } else if (msg.type === "error") {
          term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
          setStatus("disconnected");
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[WebSocket error — is the server running?]\x1b[0m\r\n");
      setStatus("disconnected");
    };

    ws.onclose = () => {
      setStatus("disconnected");
    };

    // Forward keyboard input to shell
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
  }, []);

  // Initial connection
  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      terminalRef.current?.dispose();
    };
  }, [connect]);

  // Handle container resize via ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`flex flex-col bg-[#0a0a0f] border-t border-border/80 transition-all duration-200 ${
        isMaximized ? "fixed inset-0 z-50" : "h-80"
      }`}
    >
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-card/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-xs font-mono text-muted-foreground">bash</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === "connected"
                ? "bg-green-500"
                : status === "connecting"
                ? "bg-yellow-500 animate-pulse"
                : "bg-red-500"
            }`}
          />
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

      {/* xterm.js mount point */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden p-2"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
