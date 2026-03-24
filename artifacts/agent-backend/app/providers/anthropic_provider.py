import json
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
import structlog

from .base import BaseProvider, CompletionResult, StreamChunk

logger = structlog.get_logger()

ANTHROPIC_MODELS = {
    "claude-sonnet-4-6",
    "claude-sonnet-4-5-20250514",
    "claude-haiku-4-5",
    "claude-opus-4",
}


class AnthropicProvider(BaseProvider):
    provider_name = "anthropic"

    def __init__(self, api_key: str, base_url: str):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def is_available(self) -> bool:
        return bool(self._api_key)

    def _headers(self) -> dict:
        return {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    async def stream_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        max_tokens: int = 8192,
    ) -> AsyncIterator[StreamChunk]:
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": messages,
            "stream": True,
        }
        if system:
            body["system"] = system
        if tools:
            body["tools"] = tools

        url = f"{self._base_url}/v1/messages"

        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
            async with client.stream("POST", url, json=body, headers=self._headers()) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    logger.error("anthropic_stream_error", status=response.status_code, body=error_body.decode())
                    yield StreamChunk(chunk_type="error", content=f"Anthropic API error {response.status_code}: {error_body.decode()[:500]}")
                    return

                buffer = ""
                async for raw_chunk in response.aiter_text():
                    buffer += raw_chunk
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line or line.startswith(":"):
                            continue
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                return
                            try:
                                event = json.loads(data_str)
                            except json.JSONDecodeError:
                                continue

                            for chunk in self._parse_event(event):
                                yield chunk

    def _parse_event(self, event: dict) -> list[StreamChunk]:
        chunks = []
        evt_type = event.get("type", "")

        if evt_type == "content_block_start":
            block = event.get("content_block", {})
            if block.get("type") == "tool_use":
                chunks.append(StreamChunk(
                    chunk_type="tool_start",
                    tool_id=block.get("id", ""),
                    tool_name=block.get("name", ""),
                ))
        elif evt_type == "content_block_delta":
            delta = event.get("delta", {})
            if delta.get("type") == "text_delta":
                chunks.append(StreamChunk(chunk_type="text", content=delta.get("text", "")))
            elif delta.get("type") == "input_json_delta":
                chunks.append(StreamChunk(chunk_type="tool_input", tool_input_json=delta.get("partial_json", "")))
        elif evt_type == "message_delta":
            delta = event.get("delta", {})
            stop = delta.get("stop_reason")
            usage = event.get("usage", {})
            if stop:
                chunks.append(StreamChunk(chunk_type="stop", stop_reason=stop))
        elif evt_type == "message_start":
            usage = event.get("message", {}).get("usage", {})
            if usage:
                chunks.append(StreamChunk(
                    chunk_type="usage",
                    content=json.dumps({"input_tokens": usage.get("input_tokens", 0)}),
                ))

        return chunks

    async def complete(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[str] = None,
        max_tokens: int = 512,
    ) -> CompletionResult:
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system:
            body["system"] = system

        url = f"{self._base_url}/v1/messages"

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
            resp = await client.post(url, json=body, headers=self._headers())
            resp.raise_for_status()
            data = resp.json()

        text = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")

        usage = data.get("usage", {})
        return CompletionResult(
            text=text,
            stop_reason=data.get("stop_reason", "end_turn"),
            tokens_in=usage.get("input_tokens", 0),
            tokens_out=usage.get("output_tokens", 0),
        )

    @staticmethod
    def supports_model(model: str) -> bool:
        return model.startswith("claude-") or model in ANTHROPIC_MODELS
