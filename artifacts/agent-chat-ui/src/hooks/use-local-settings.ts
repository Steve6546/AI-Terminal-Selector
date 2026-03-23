import { useState, useEffect } from "react";
import { SettingsMapDefaultModel } from "@workspace/api-client-react";

const MODEL_KEY = "agent_chat_selected_model";
const MODE_KEY = "agent_chat_mode";

export const AVAILABLE_MODELS: { id: SettingsMapDefaultModel; label: string }[] = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
];

export type InteractionMode = "agent" | "tool";

export function useLocalSettings() {
  const [model, setModel] = useState<SettingsMapDefaultModel>(() => {
    const saved = localStorage.getItem(MODEL_KEY);
    if (saved === "claude-opus-4-6" || saved === "claude-sonnet-4-6") {
      return saved as SettingsMapDefaultModel;
    }
    return "claude-sonnet-4-6";
  });

  useEffect(() => {
    localStorage.setItem(MODEL_KEY, model);
  }, [model]);

  const [mode, setMode] = useState<InteractionMode>(() => {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "agent" || saved === "tool") return saved;
    // Migrate old capitalized values
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
