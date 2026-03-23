/**
 * WebSocket terminal server using ws + node-pty.
 * Runs a bash shell and bridges stdin/stdout/resize over WebSocket.
 */
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import type { Server } from "http";

export function attachTerminalServer(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/terminal") {
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
      try {
        ptyProcess.kill();
      } catch {
        // Already dead
      }
    });

    ws.on("error", () => {
      try {
        ptyProcess.kill();
      } catch {
        // Already dead
      }
    });
  });
}
