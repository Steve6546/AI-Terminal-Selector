type StreamEventHandler = (data: unknown) => void;
type StreamEventType = "server_status" | "system_status" | "agent_event" | "health";

interface StreamSubscription {
  eventType: StreamEventType;
  handler: StreamEventHandler;
}

let _eventSource: EventSource | null = null;
let _subscriptions = new Set<StreamSubscription>();
let _refCount = 0;

function ensureStream() {
  if (_eventSource) return;
  _eventSource = new EventSource(`/api/system/status/events`);

  const eventTypes: StreamEventType[] = ["server_status", "system_status", "agent_event", "health"];
  for (const et of eventTypes) {
    _eventSource.addEventListener(et, (e: MessageEvent<string>) => {
      let data: unknown;
      try { data = JSON.parse(e.data); } catch { return; }
      for (const sub of _subscriptions) {
        if (sub.eventType === et) sub.handler(data);
      }
    });
  }

  _eventSource.onerror = () => {};
}

function teardownStream() {
  if (_eventSource) {
    _eventSource.close();
    _eventSource = null;
  }
}

export function subscribeToStream(eventType: StreamEventType, handler: StreamEventHandler): () => void {
  const sub: StreamSubscription = { eventType, handler };
  _subscriptions.add(sub);
  _refCount++;
  if (_refCount === 1) ensureStream();

  return () => {
    _subscriptions.delete(sub);
    _refCount--;
    if (_refCount === 0) teardownStream();
  };
}
