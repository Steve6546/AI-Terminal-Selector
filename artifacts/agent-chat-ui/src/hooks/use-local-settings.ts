import { useState, useEffect } from "react";
import { SettingsMapDefaultModel } from "@workspace/api-client-react";

const MODEL_KEY = "agent_chat_selected_model";
const MODE_KEY = "agent_chat_mode";

export type InteractionMode = "Agent" | "Tool";

export function useLocalSettings() {
  // Model Selection
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

  // Mode Selection (Agent vs Tool)
  const [mode, setMode] = useState<InteractionMode>(() => {
    const saved = localStorage.getItem(MODE_KEY);
    return (saved as InteractionMode) || "Agent";
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
