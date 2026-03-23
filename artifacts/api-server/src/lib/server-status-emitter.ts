import { EventEmitter } from "events";

export type McpServerStatus = "connected" | "checking" | "degraded" | "auth_required" | "error" | "disconnected";

export interface ServerStatusEvent {
  serverId: number;
  name: string;
  status: McpServerStatus;
  lastCheckedAt: string;
  latencyMs?: number;
  errorMessage?: string;
}

class ServerStatusEmitter extends EventEmitter {
  broadcast(event: ServerStatusEvent) {
    this.emit("status", event);
  }
}

export const serverStatusEmitter = new ServerStatusEmitter();
serverStatusEmitter.setMaxListeners(200);
