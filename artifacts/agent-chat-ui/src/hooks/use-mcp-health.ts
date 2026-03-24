import { useEffect, useRef, useState, useCallback } from "react";

export type McpLiveStatus =
  | "checking"
  | "connected"
  | "degraded"
  | "auth_required"
  | "disconnected"
  | "error";

export interface McpServerLiveHealth {
  serverId: number;
  name: string;
  status: McpLiveStatus;
  lastCheckedAt?: string;
  latencyMs?: number;
  errorMessage?: string;
}

type HealthMap = Record<number, McpServerLiveHealth>;

let _sharedMap: HealthMap = {};
const _listeners = new Set<(map: HealthMap) => void>();
let _eventSource: EventSource | null = null;
let _refCount = 0;

function startSharedStream() {
  if (_eventSource) return;
  _eventSource = new EventSource("/api/system/status/events");

  _eventSource.addEventListener("server_status", (e: MessageEvent<string>) => {
    try {
      const data = JSON.parse(e.data) as McpServerLiveHealth;
      _sharedMap = { ..._sharedMap, [data.serverId]: data };
      _listeners.forEach((fn) => fn(_sharedMap));
    } catch {
      // ignore parse errors
    }
  });

  _eventSource.onerror = () => {
    // SSE auto-reconnects; nothing to do
  };
}

function stopSharedStream() {
  if (_eventSource) {
    _eventSource.close();
    _eventSource = null;
  }
  _sharedMap = {};
}

export function useMcpHealth() {
  const [healthMap, setHealthMap] = useState<HealthMap>(_sharedMap);
  const listenRef = useRef<(map: HealthMap) => void>((m) => setHealthMap({ ...m }));

  useEffect(() => {
    const listener = listenRef.current;
    _listeners.add(listener);
    _refCount++;

    if (_refCount === 1) startSharedStream();
    // Sync initial state
    setHealthMap({ ..._sharedMap });

    return () => {
      _listeners.delete(listener);
      _refCount--;
      if (_refCount === 0) stopSharedStream();
    };
  }, []);

  const getLiveStatus = useCallback(
    (serverId: number): McpServerLiveHealth | null => healthMap[serverId] ?? null,
    [healthMap]
  );

  return { healthMap, getLiveStatus };
}
