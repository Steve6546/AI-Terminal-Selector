/**
 * WebSocket terminal server using ws + node-pty.
 * Runs a bash shell and bridges stdin/stdout/resize over WebSocket.
 * Auth: caller must present a one-time token obtained from GET /api/terminal/token.
 */
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import type { Server } from "http";
import { randomUUID } from "crypto";

const TOKEN_TTL_MS = 60_000;
const pendingTokens = new Map<string, number>(); // token → expiry timestamp

/** Generate a one-time terminal auth token (valid for 60 s). */
export function issueTerminalToken(): string {
  const token = randomUUID();
  pendingTokens.set(token, Date.now() + TOKEN_TTL_MS);
  // Prune stale tokens
  for (const [t, exp] of pendingTokens) {
    if (exp < Date.now()) pendingTokens.delete(t);
  }
  return token;
}

function consumeToken(token: string | null): boolean {
  if (!token) return false;
  const exp = pendingTokens.get(token);
  if (!exp || exp < Date.now()) return false;
  pendingTokens.delete(token);
  return true;
}

export function attachTerminalServer(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/terminal") {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    if (!consumeToken(token)) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
      );
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket as never, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    const shell = process.env.SHELL ?? "/bin/bash";
    const cols = 120;
    const rows = 30;

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.env.HOME ?? "/",
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: "Failed to start shell: " + String(err) }));
      ws.close();
      return;
    }

    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit" }));
        ws.close();
      }
    });

    ws.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: "input" | "resize";
          data?: string;
          cols?: number;
          rows?: number;
        };

        if (msg.type === "input" && msg.data !== undefined) {
          ptyProcess.write(msg.data);
        } else if (msg.type === "resize" && msg.cols && msg.rows) {
          ptyProcess.resize(msg.cols, msg.rows);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      try { ptyProcess.kill(); } catch { /* Already dead */ }
    });

    ws.on("error", () => {
      try { ptyProcess.kill(); } catch { /* Already dead */ }
    });
  });
}
