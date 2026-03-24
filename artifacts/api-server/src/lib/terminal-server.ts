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
 * - Each session has a unique ID and idle timeout (default 30 min).
 * - Session open/close/idle events are logged to the audit_events table.
 */
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import type { Server } from "http";
import { randomUUID } from "crypto";
import { db, auditEvents } from "@workspace/db";

const TOKEN_TTL_MS = 60_000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface TokenRecord {
  expiry: number;
  ip: string;
  origin: string;
}

interface SessionRecord {
  sessionId: string;
  ip: string;
  startedAt: number;
  lastActivityAt: number;
  idleTimer: ReturnType<typeof setTimeout>;
}

const pendingTokens = new Map<string, TokenRecord>();
const activeSessions = new Map<WebSocket, SessionRecord>();

function parseOrigin(raw: string): string | null {
  try { return new URL(raw).origin; } catch { return null; }
}

function allowedOrigin(origin: string): boolean {
  if (!origin) return true;

  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;

    const devDomain = process.env["REPLIT_DEV_DOMAIN"];
    if (devDomain && url.origin === new URL(`https://${devDomain}`).origin) return true;

    const appsDomain = process.env["REPLIT_DEPLOYMENT_URL"];
    if (appsDomain) {
      try {
        if (url.origin === new URL(appsDomain).origin) return true;
      } catch { /* invalid env var */ }
    }

    return false;
  } catch {
    return false;
  }
}

function logAudit(eventType: string, details: Record<string, unknown>) {
  db.insert(auditEvents)
    .values({ eventType, entityType: "terminal", actor: "user", details })
    .catch(() => {});
}

/** Generate a one-time terminal auth token bound to the caller's IP and origin. */
export function issueTerminalToken(ip: string, origin: string): string {
  const token = randomUUID();
  const expiry = Date.now() + TOKEN_TTL_MS;
  pendingTokens.set(token, { expiry, ip, origin });
  for (const [t, rec] of pendingTokens) {
    if (rec.expiry < Date.now()) pendingTokens.delete(t);
  }
  return token;
}

/** Validate and consume a one-time terminal token. Validates IP and origin (parsed equality). */
function consumeToken(token: string | null, ip: string, wsOrigin: string): boolean {
  if (!token) return false;
  const rec = pendingTokens.get(token);
  if (!rec) return false;
  if (rec.expiry < Date.now()) {
    pendingTokens.delete(token);
    return false;
  }
  if (rec.ip !== ip) return false;
  if (rec.origin !== "" && wsOrigin) {
    const reqOrigin = parseOrigin(wsOrigin);
    const recOrigin = parseOrigin(rec.origin) ?? rec.origin;
    if (reqOrigin !== recOrigin) return false;
  }
  pendingTokens.delete(token);
  return true;
}

function resetIdleTimer(ws: WebSocket, session: SessionRecord, ptyProcess: pty.IPty) {
  clearTimeout(session.idleTimer);
  session.lastActivityAt = Date.now();
  session.idleTimer = setTimeout(() => {
    logAudit("terminal.idle_timeout", {
      sessionId: session.sessionId,
      ip: session.ip,
      idleMs: IDLE_TIMEOUT_MS,
    });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: "Session timed out due to inactivity" }));
      ws.close();
    }
    try { ptyProcess.kill(); } catch { /* already dead */ }
  }, IDLE_TIMEOUT_MS);
}

export function attachTerminalServer(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/terminal") {
      socket.destroy();
      return;
    }

    const wsOrigin = req.headers.origin ?? "";
    if (wsOrigin && !allowedOrigin(wsOrigin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    const ip = (req.socket.remoteAddress ?? "").split(",")[0]?.trim() ?? "";
    if (!consumeToken(token, ip, wsOrigin)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket as never, head, (ws) => {
      wss.emit("connection", ws, req, ip);
    });
  });

  wss.on("connection", (ws: WebSocket, _req: unknown, ip: string) => {
    const sessionId = randomUUID();
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

    const session: SessionRecord = {
      sessionId,
      ip: ip ?? "",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      idleTimer: setTimeout(() => {}, 0),
    };
    activeSessions.set(ws, session);
    resetIdleTimer(ws, session, ptyProcess);

    logAudit("terminal.session_start", { sessionId, ip, pid: ptyProcess.pid });

    ws.send(JSON.stringify({ type: "session", sessionId }));

    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "output", data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      logAudit("terminal.session_end", {
        sessionId,
        ip,
        exitCode,
        durationMs: Date.now() - session.startedAt,
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", exitCode }));
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
          resetIdleTimer(ws, session, ptyProcess);
          ptyProcess.write(msg.data);
        } else if (msg.type === "resize" && msg.cols && msg.rows) {
          ptyProcess.resize(msg.cols, msg.rows);
        }
      } catch { /* Ignore malformed messages */ }
    });

    const cleanup = () => {
      clearTimeout(session.idleTimer);
      activeSessions.delete(ws);
      try { ptyProcess.kill(); } catch { /* Already dead */ }
    };

    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });
}
