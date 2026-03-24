import { useState, useEffect } from "react";

const MODEL_KEY = "agent_chat_selected_model";
const MODE_KEY = "agent_chat_mode";

export type ModelId = "claude-sonnet-4-6" | "claude-opus-4-6";

export const AVAILABLE_MODELS: { id: ModelId; label: string }[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
];

export type InteractionMode = "agent" | "tool";

function safeGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key);
}

export function useLocalSettings() {
  const [model, setModel] = useState<ModelId>(() => {
    const saved = safeGetItem(MODEL_KEY);
    if (saved === "claude-opus-4-6" || saved === "claude-sonnet-4-6") {
      return saved as ModelId;
    }
    return "claude-sonnet-4-6";
  });

  useEffect(() => {
    localStorage.setItem(MODEL_KEY, model);
  }, [model]);

  const [mode, setMode] = useState<InteractionMode>(() => {
    const saved = safeGetItem(MODE_KEY);
    if (saved === "agent" || saved === "tool") return saved;
    if (saved === "Agent") return "agent";
    if (saved === "Tool") return "tool";
    return "agent";
  });

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  return {
    model,
    setModel,
    mode,
    setMode
  };
}
