import type { Response } from "express";
import { serverStatusEmitter, type ServerStatusEvent } from "../lib/server-status-emitter";

type StreamEventType = "server_status" | "system_status" | "agent_event" | "health";

interface StreamClient {
  id: string;
  res: Response;
  channels: Set<StreamEventType>;
}

class StreamManager {
  private clients = new Map<string, StreamClient>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    serverStatusEmitter.on("status", (event: ServerStatusEvent) => {
      this.broadcast("server_status", event);
    });

    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.res.write(": heartbeat\n\n");
        } catch {
          this.removeClient(client.id);
        }
      }
    }, 30_000);
  }

  addClient(
    clientId: string,
    res: Response,
    channels: StreamEventType[] = ["server_status", "system_status", "agent_event", "health"],
  ): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    this.clients.set(clientId, {
      id: clientId,
      res,
      channels: new Set(channels),
    });
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  broadcast(eventType: StreamEventType, data: unknown): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients.values()) {
      if (client.channels.has(eventType)) {
        try {
          client.res.write(payload);
        } catch {
          this.removeClient(client.id);
        }
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clients.clear();
  }
}

export const streamManager = new StreamManager();
