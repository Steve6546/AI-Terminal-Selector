import { useEffect, useRef, useState, useCallback } from "react";
import { subscribeToStream } from "./use-shared-stream";

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
let _unsub: (() => void) | null = null;
let _refCount = 0;

function startSharedStream() {
  if (_unsub) return;
  _unsub = subscribeToStream("server_status", (raw) => {
    const data = raw as McpServerLiveHealth;
    _sharedMap = { ..._sharedMap, [data.serverId]: data };
    _listeners.forEach((fn) => fn(_sharedMap));
  });
}

function stopSharedStream() {
  if (_unsub) {
    _unsub();
    _unsub = null;
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
