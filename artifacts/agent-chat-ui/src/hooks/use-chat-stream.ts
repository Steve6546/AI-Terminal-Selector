import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAnthropicMessagesQueryKey } from "@workspace/api-client-react";

interface StreamOptions {
  conversationId: number;
  model: string;
  onFinish?: () => void;
  onError?: (err: Error) => void;
}

export function useChatStream({ conversationId, model, onFinish, onError }: StreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const sendMessage = useCallback(async (content: string) => {
    setIsStreaming(true);
    setStreamedText("");
    
    abortControllerRef.current = new AbortController();

    try {
      // Optimistically clear the stream text and prepare UI
      const response = await fetch(`/api/anthropic/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, model }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Parse SSE chunks
        const lines = buffer.split('\n');
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr.trim() === '') continue;
            
            try {
              const data = JSON.parse(dataStr);
              if (data.done) {
                // End of stream
                break;
              } else if (data.content) {
                setStreamedText(prev => prev + data.content);
              }
            } catch (e) {
              console.warn("Failed to parse SSE chunk:", dataStr);
            }
          }
        }
      }
      
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('Stream aborted');
      } else {
        console.error("Stream error:", err);
        onError?.(err);
      }
    } finally {
      setIsStreaming(false);
      // Invalidate the messages query to fetch the final persisted message
      queryClient.invalidateQueries({
        queryKey: getListAnthropicMessagesQueryKey(conversationId)
      });
      onFinish?.();
    }
  }, [conversationId, model, queryClient, onFinish, onError]);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  return {
    sendMessage,
    stopStream,
    isStreaming,
    streamedText
  };
}
