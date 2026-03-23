import { EventEmitter } from "events";

export interface ServerStatusEvent {
  serverId: number;
  name: string;
  status: "connected" | "error";
  lastCheckedAt: string;
}

class ServerStatusEmitter extends EventEmitter {
  broadcast(event: ServerStatusEvent) {
    this.emit("status", event);
  }
}

export const serverStatusEmitter = new ServerStatusEmitter();
serverStatusEmitter.setMaxListeners(200);
