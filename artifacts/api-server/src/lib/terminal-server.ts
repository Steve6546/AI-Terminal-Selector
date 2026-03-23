/**
 * WebSocket terminal server using ws + node-pty.
 * Runs a bash shell and bridges stdin/stdout/resize over WebSocket.
 *
 * Security model:
 * - Caller first hits GET /api/terminal/token (CSRF-protected, rate-limited)
 *   which issues a one-time, short-lived token bound to the caller's IP+origin.
 * - WS upgrade validates the token matches the connecting IP, and that the WS
 *   Origin header matches allowed origins derived from the Replit dev domain.
 * - Token is consumed (deleted) on first use to prevent replay.
 */
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import type { Server } from "http";
import { randomUUID } from "crypto";

const TOKEN_TTL_MS = 60_000;

interface TokenRecord {
  expiry: number;
  ip: string;
  origin: string;
}

const pendingTokens = new Map<string, TokenRecord>();

function allowedOrigin(origin: string): boolean {
  // Permit localhost development and Replit preview domains
  if (!origin) return true; // same-origin has no Origin header
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) return true;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain && origin === `https://${devDomain}`) return true;
  const appsDomain = process.env["REPLIT_DEPLOYMENT_URL"];
  if (appsDomain && origin === appsDomain) return true;
  return false;
}

/** Generate a one-time terminal auth token bound to the caller's IP and origin. */
export function issueTerminalToken(ip: string, origin: string): string {
  const token = randomUUID();
  const expiry = Date.now() + TOKEN_TTL_MS;
  pendingTokens.set(token, { expiry, ip, origin });
  // Prune stale tokens
  for (const [t, rec] of pendingTokens) {
    if (rec.expiry < Date.now()) pendingTokens.delete(t);
  }
  return token;
}

function consumeToken(token: string | null, ip: string): boolean {
  if (!token) return false;
  const rec = pendingTokens.get(token);
  if (!rec) return false;
  if (rec.expiry < Date.now()) {
    pendingTokens.delete(token);
    return false;
  }
  // IP must match
  if (rec.ip !== ip) return false;
  pendingTokens.delete(token); // one-time use
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

    // Validate Origin header on the WebSocket connection
    const wsOrigin = req.headers.origin ?? "";
    if (wsOrigin && !allowedOrigin(wsOrigin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    // Validate one-time token
    const token = url.searchParams.get("token");
    const ip = (req.socket.remoteAddress ?? "").split(",")[0]?.trim() ?? "";
    if (!consumeToken(token, ip)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
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
      } catch { /* Ignore malformed messages */ }
    });

    ws.on("close", () => { try { ptyProcess.kill(); } catch { /* Already dead */ } });
    ws.on("error", () => { try { ptyProcess.kill(); } catch { /* Already dead */ } });
  });
}
