import json
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
import structlog

from .base import BaseProvider, CompletionResult, StreamChunk

logger = structlog.get_logger()

OPENAI_MODELS = {
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
    "o1",
    "o1-mini",
    "o3-mini",
}


class OpenAIProvider(BaseProvider):
    provider_name = "openai"

    def __init__(self, api_key: str, base_url: str):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def is_available(self) -> bool:
        return bool(self._api_key)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _convert_tools(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
                },
            }
            for t in tools
        ]

    def _convert_messages(self, messages: List[Dict[str, Any]], system: Optional[str]) -> List[Dict[str, Any]]:
        result = []
        if system:
            result.append({"role": "system", "content": system})
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                text_parts = []
                tool_calls_out = []
                tool_results_out = []

                for block in content:
                    if isinstance(block, dict):
                        btype = block.get("type", "")
                        if btype == "text":
                            text_parts.append({"type": "text", "text": block.get("text", "")})
                        elif btype == "tool_use":
                            tool_calls_out.append({
                                "id": block.get("id", ""),
                                "type": "function",
                                "function": {
                                    "name": block.get("name", ""),
                                    "arguments": json.dumps(block.get("input", {})),
                                },
                            })
                        elif btype == "tool_result":
                            tool_results_out.append({
                                "role": "tool",
                                "tool_call_id": block.get("tool_use_id", ""),
                                "content": block.get("content", ""),
                            })
                    elif isinstance(block, str):
                        text_parts.append({"type": "text", "text": block})

                if tool_calls_out:
                    assistant_msg: Dict[str, Any] = {"role": "assistant"}
                    if text_parts:
                        combined = " ".join(p.get("text", "") for p in text_parts)
                        if combined.strip():
                            assistant_msg["content"] = combined
                    assistant_msg["tool_calls"] = tool_calls_out
                    result.append(assistant_msg)
                elif tool_results_out:
                    for tr in tool_results_out:
                        result.append(tr)
                elif text_parts:
                    result.append({"role": msg["role"], "content": text_parts})
            else:
                result.append({"role": msg["role"], "content": str(content)})
        return result

    async def stream_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        max_tokens: int = 8192,
    ) -> AsyncIterator[StreamChunk]:
        converted_messages = self._convert_messages(messages, system)
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": converted_messages,
            "stream": True,
        }
        if tools:
            body["tools"] = self._convert_tools(tools)

        url = f"{self._base_url}/v1/chat/completions"

        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
            async with client.stream("POST", url, json=body, headers=self._headers()) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    logger.error("openai_stream_error", status=response.status_code, body=error_body.decode())
                    yield StreamChunk(chunk_type="error", content=f"OpenAI API error {response.status_code}: {error_body.decode()[:500]}")
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
        for choice in event.get("choices", []):
            delta = choice.get("delta", {})
            finish = choice.get("finish_reason")

            if "content" in delta and delta["content"]:
                chunks.append(StreamChunk(chunk_type="text", content=delta["content"]))

            for tc in delta.get("tool_calls", []):
                if "id" in tc:
                    chunks.append(StreamChunk(
                        chunk_type="tool_start",
                        tool_id=tc["id"],
                        tool_name=tc.get("function", {}).get("name", ""),
                    ))
                if tc.get("function", {}).get("arguments"):
                    chunks.append(StreamChunk(
                        chunk_type="tool_input",
                        tool_input_json=tc["function"]["arguments"],
                    ))

            if finish:
                chunks.append(StreamChunk(chunk_type="stop", stop_reason=finish))

        return chunks

    async def complete(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[str] = None,
        max_tokens: int = 512,
    ) -> CompletionResult:
        converted_messages = self._convert_messages(messages, system)
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": converted_messages,
        }

        url = f"{self._base_url}/v1/chat/completions"

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
            resp = await client.post(url, json=body, headers=self._headers())
            resp.raise_for_status()
            data = resp.json()

        text = ""
        for choice in data.get("choices", []):
            msg = choice.get("message", {})
            text += msg.get("content", "") or ""

        usage = data.get("usage", {})
        return CompletionResult(
            text=text,
            stop_reason=data.get("choices", [{}])[0].get("finish_reason", "stop") if data.get("choices") else "stop",
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
        )

    @staticmethod
    def supports_model(model: str) -> bool:
        return model.startswith("gpt-") or model.startswith("o1") or model.startswith("o3") or model in OPENAI_MODELS
