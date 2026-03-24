import abc
from typing import Any, AsyncIterator, Dict, List, Optional


class StreamChunk:
    __slots__ = ("chunk_type", "content", "tool_id", "tool_name", "tool_input_json", "stop_reason")

    def __init__(
        self,
        chunk_type: str,
        content: str = "",
        tool_id: str = "",
        tool_name: str = "",
        tool_input_json: str = "",
        stop_reason: Optional[str] = None,
    ):
        self.chunk_type = chunk_type
        self.content = content
        self.tool_id = tool_id
        self.tool_name = tool_name
        self.tool_input_json = tool_input_json
        self.stop_reason = stop_reason


class CompletionResult:
    __slots__ = ("text", "tool_calls", "stop_reason", "tokens_in", "tokens_out")

    def __init__(
        self,
        text: str = "",
        tool_calls: Optional[List[Dict[str, Any]]] = None,
        stop_reason: str = "end_turn",
        tokens_in: int = 0,
        tokens_out: int = 0,
    ):
        self.text = text
        self.tool_calls = tool_calls or []
        self.stop_reason = stop_reason
        self.tokens_in = tokens_in
        self.tokens_out = tokens_out


class BaseProvider(abc.ABC):
    provider_name: str = ""

    @abc.abstractmethod
    async def stream_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        max_tokens: int = 8192,
    ) -> AsyncIterator[StreamChunk]:
        ...

    @abc.abstractmethod
    async def complete(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[str] = None,
        max_tokens: int = 512,
    ) -> CompletionResult:
        ...

    @abc.abstractmethod
    def is_available(self) -> bool:
        ...
