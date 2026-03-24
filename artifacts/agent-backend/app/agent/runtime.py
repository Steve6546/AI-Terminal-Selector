import json
import uuid
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

import structlog

from ..config import settings
from ..models.agent_types import AgentMode, RunStatus
from ..models.events import EventType, RunEvent
from ..models.requests import ChatRequest, ServerInfo, ToolDefinition
from ..providers.base import StreamChunk
from ..providers.router import ProviderRouter
from ..services import db_client
from .tool_executor import ToolExecutor

logger = structlog.get_logger()

AGENT_SYSTEM_PROMPT = """You are an expert AI agent with access to MCP (Model Context Protocol) tools and servers.

## Your capabilities
- Discover and execute tools across all connected MCP servers
- Chain multiple tools together to complete complex, multi-step workflows
- Analyze data, manage servers, automate tasks, and interact with external APIs

## How you work
1. **Understand** the user's intent completely. If ambiguous, ask one focused clarifying question.
2. **Plan** which servers and tools you will use, and in what order.
3. **Execute** tools systematically. Check each result before proceeding to the next step.
4. **Handle errors** gracefully — if a tool fails, explain why and try an alternative approach.
5. **Report** progress at each step with clear, concise summaries.

## Tool selection
- Tools are namespaced as `{serverId}__{toolName}`. Always use the full namespaced form.
- Prefer tools that match the user's intent most precisely.
- For destructive or irreversible operations, always confirm with the user before executing.

## Quality standards
- Never fabricate tool results. If a tool returns nothing useful, say so.
- Always provide a clear final summary of what was accomplished and any follow-up suggestions.
- Keep your reasoning transparent — briefly explain why you are choosing each tool."""


SUMMARY_THRESHOLD = 20
RECENT_MESSAGES_TO_KEEP = 8


class AgentRuntime:
    def __init__(self, provider_router: ProviderRouter):
        self._router = provider_router

    async def run(
        self,
        request: ChatRequest,
        emit: Callable[[RunEvent], None],
    ) -> str:
        run_id = str(uuid.uuid4())
        mode = AgentMode(request.mode) if request.mode in AgentMode.__members__.values() else AgentMode.AGENT
        model = request.model or settings.default_model

        emit(RunEvent(
            type=EventType.RUN_CREATED,
            run_id=run_id,
            data={
                "conversation_id": request.conversation_id,
                "model": model,
                "mode": mode.value,
            },
        ))

        run_record = await db_client.persist_run(
            run_id=run_id,
            conversation_id=request.conversation_id,
            model=model,
            mode=mode.value,
        )
        run_db_id = run_record.get("id") if run_record else None

        await db_client.persist_run_event(run_db_id, "run.created", {
            "conversation_id": request.conversation_id,
            "model": model,
            "mode": mode.value,
        })

        try:
            if mode == AgentMode.TOOL:
                full_response = await self._run_tool_mode(request, run_id, run_db_id, emit)
            elif mode == AgentMode.AGENT:
                full_response = await self._run_agent_mode(request, run_id, run_db_id, model, emit)
            else:
                full_response = await self._run_chat_mode(request, run_id, run_db_id, model, emit)

            await db_client.update_run(run_id, status=RunStatus.COMPLETED.value)
            await db_client.persist_run_event(run_db_id, "run.completed")
            emit(RunEvent(type=EventType.RUN_COMPLETED, run_id=run_id))
            return full_response

        except Exception as exc:
            error_msg = str(exc)
            logger.error("agent_run_failed", run_id=run_id, error=error_msg)
            await db_client.update_run(run_id, status=RunStatus.FAILED.value, error_message=error_msg)
            await db_client.persist_run_event(run_db_id, "run.failed", {"error": error_msg})
            emit(RunEvent(type=EventType.RUN_FAILED, run_id=run_id, data={"error": error_msg}))
            return ""

    async def _summarize_history(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if len(messages) <= SUMMARY_THRESHOLD:
            return messages

        older = messages[:-RECENT_MESSAGES_TO_KEEP]
        recent = messages[-RECENT_MESSAGES_TO_KEEP:]

        transcript_parts = []
        for m in older:
            role_label = "User" if m.get("role") == "user" else "Assistant"
            content = m.get("content", "")
            if isinstance(content, str):
                text = content[:500]
            elif isinstance(content, list):
                text = " ".join(
                    b.get("text", "")[:200]
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            else:
                text = str(content)[:500]
            transcript_parts.append(f"{role_label}: {text}")

        transcript = "\n\n".join(transcript_parts)

        try:
            summary_provider = self._router.get_provider_for_task("fast")
            if not summary_provider:
                return messages
            provider, summary_model = summary_provider
            result = await provider.complete(
                model=summary_model,
                messages=[{
                    "role": "user",
                    "content": (
                        "Summarize the following conversation history into a concise paragraph "
                        "(max 300 words) that captures the key topics, decisions, and context "
                        f"needed to continue the conversation:\n\n{transcript}\n\nSummary:"
                    ),
                }],
                max_tokens=512,
            )
            if result.text.strip():
                return [
                    {"role": "user", "content": f"[Earlier conversation summary: {result.text.strip()}]"},
                    {"role": "assistant", "content": "Understood, I'll keep that context in mind."},
                    *recent,
                ]
        except Exception as exc:
            logger.warning("summarization_failed", error=str(exc))

        return messages

    async def _run_chat_mode(
        self,
        request: ChatRequest,
        run_id: str,
        run_db_id: Optional[int],
        model: str,
        emit: Callable[[RunEvent], None],
    ) -> str:
        emit(RunEvent(type=EventType.MODEL_STARTED, run_id=run_id))
        await db_client.persist_run_event(run_db_id, "model.started")

        provider = self._router.get_provider_for_model(model)
        if not provider:
            raise RuntimeError(f"No provider available for model {model}")

        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        messages = await self._summarize_history(messages)
        full_response = ""

        async for chunk in provider.stream_completion(model=model, messages=messages, max_tokens=8192):
            if chunk.chunk_type == "text":
                full_response += chunk.content
                emit(RunEvent(type=EventType.TEXT_DELTA, run_id=run_id, data={"content": chunk.content}))
            elif chunk.chunk_type == "error":
                raise RuntimeError(chunk.content)

        await db_client.persist_run_event(run_db_id, "text.completed", {"length": len(full_response)})
        return full_response

    async def _run_tool_mode(
        self,
        request: ChatRequest,
        run_id: str,
        run_db_id: Optional[int],
        emit: Callable[[RunEvent], None],
    ) -> str:
        emit(RunEvent(type=EventType.MODEL_STARTED, run_id=run_id))
        await db_client.persist_run_event(run_db_id, "model.started")

        if not request.selected_server_id or not request.selected_tool_name:
            raise RuntimeError("Tool mode requires selected_server_id and selected_tool_name")

        tool_executor = ToolExecutor(
            run_id=run_id,
            run_db_id=run_db_id,
            conversation_id=request.conversation_id,
            servers=request.servers,
            tools=request.tools,
            emit=emit,
        )

        tool_id = f"tool_{uuid.uuid4().hex[:8]}"
        namespaced = f"{request.selected_server_id}__{request.selected_tool_name}"
        tool_args = request.tool_args or {}

        result = await tool_executor.execute(tool_id, namespaced, tool_args)

        if result.success:
            content_str = json.dumps(result.content, default=str) if result.content else ""
            full_response = (
                f"Executed **{request.selected_tool_name}** in {result.duration_ms}ms.\n\n"
                f"**Result:**\n```json\n{content_str[:500]}\n```"
            )
        else:
            full_response = f"Tool **{request.selected_tool_name}** failed: {result.error or 'Unknown error'}"

        emit(RunEvent(type=EventType.TEXT_DELTA, run_id=run_id, data={"content": full_response}))
        return full_response

    async def _run_agent_mode(
        self,
        request: ChatRequest,
        run_id: str,
        run_db_id: Optional[int],
        model: str,
        emit: Callable[[RunEvent], None],
    ) -> str:
        emit(RunEvent(type=EventType.MODEL_STARTED, run_id=run_id))
        await db_client.persist_run_event(run_db_id, "model.started")

        provider = self._router.get_provider_for_model(model)
        if not provider:
            raise RuntimeError(f"No provider available for model {model}")

        tool_executor = ToolExecutor(
            run_id=run_id,
            run_db_id=run_db_id,
            conversation_id=request.conversation_id,
            servers=request.servers,
            tools=request.tools,
            emit=emit,
        )

        provider_tools = [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema}
            for t in request.tools
        ]

        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        messages = await self._summarize_history(messages)

        system_prompt = request.system_prompt or AGENT_SYSTEM_PROMPT

        emit(RunEvent(type=EventType.THINKING_STARTED, run_id=run_id, data={"message": "Planning..."}))

        if request.servers:
            server_names = [s.name for s in request.servers]
            emit(RunEvent(type=EventType.THINKING_DELTA, run_id=run_id, data={"content": f"Connected servers: {', '.join(server_names)}"}))
        else:
            emit(RunEvent(type=EventType.THINKING_DELTA, run_id=run_id, data={"content": "No MCP servers connected — will respond from knowledge only"}))

        if provider_tools:
            tool_names = [t["name"].split("__")[-1] for t in provider_tools[:8]]
            extra = f" +{len(provider_tools) - 8} more" if len(provider_tools) > 8 else ""
            emit(RunEvent(type=EventType.THINKING_DELTA, run_id=run_id, data={"content": f"Available tools: {', '.join(tool_names)}{extra}"}))

        loop_messages = list(messages)
        full_response = ""
        total_tokens_in = 0
        total_tokens_out = 0
        max_loops = settings.max_agent_loops

        for loop_count in range(1, max_loops + 1):
            if loop_count > 1:
                emit(RunEvent(type=EventType.THINKING_DELTA, run_id=run_id, data={"content": f"Iteration {loop_count}: reviewing tool results and deciding next step..."}))

            current_text = ""
            tool_use_blocks = []
            stop_reason = None
            thinking_completed = False

            async for chunk in provider.stream_completion(
                model=model,
                messages=loop_messages,
                system=system_prompt,
                tools=provider_tools if provider_tools else None,
                max_tokens=8192,
            ):
                if chunk.chunk_type == "text":
                    if not thinking_completed:
                        emit(RunEvent(type=EventType.THINKING_COMPLETED, run_id=run_id))
                        thinking_completed = True
                    current_text += chunk.content
                    full_response += chunk.content
                    emit(RunEvent(type=EventType.TEXT_DELTA, run_id=run_id, data={"content": chunk.content}))

                elif chunk.chunk_type == "tool_start":
                    tool_use_blocks.append({
                        "id": chunk.tool_id,
                        "name": chunk.tool_name,
                        "input": {},
                        "_raw_input": "",
                    })

                elif chunk.chunk_type == "tool_input":
                    if tool_use_blocks:
                        tool_use_blocks[-1]["_raw_input"] += chunk.tool_input_json

                elif chunk.chunk_type == "stop":
                    stop_reason = chunk.stop_reason

                elif chunk.chunk_type == "usage":
                    try:
                        usage_data = json.loads(chunk.content)
                        total_tokens_in += usage_data.get("input_tokens", 0)
                    except (json.JSONDecodeError, TypeError):
                        pass

                elif chunk.chunk_type == "error":
                    raise RuntimeError(chunk.content)

            if not thinking_completed:
                emit(RunEvent(type=EventType.THINKING_COMPLETED, run_id=run_id))

            for block in tool_use_blocks:
                if block["_raw_input"]:
                    try:
                        block["input"] = json.loads(block["_raw_input"])
                    except json.JSONDecodeError:
                        block["input"] = {}

            if current_text:
                loop_messages.append({"role": "assistant", "content": current_text})

            if not tool_use_blocks or stop_reason == "end_turn":
                break

            tool_results = []
            for block in tool_use_blocks:
                emit(RunEvent(type=EventType.THINKING_DELTA, run_id=run_id, data={"content": f"Selecting tool: {block['name'].split('__')[-1] if '__' in block['name'] else block['name']}"}))

                result = await tool_executor.execute(block["id"], block["name"], block["input"])

                result_text = ""
                if result.success:
                    result_text = json.dumps(result.content, default=str) if result.content else ""
                else:
                    result_text = f"Error: {result.error or 'Unknown error'}"

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block["id"],
                    "content": result_text,
                })

            if tool_use_blocks:
                loop_messages.append({
                    "role": "assistant",
                    "content": [
                        {"type": "tool_use", "id": b["id"], "name": b["name"], "input": b["input"]}
                        for b in tool_use_blocks
                    ],
                })
                loop_messages.append({
                    "role": "user",
                    "content": tool_results,
                })

        await db_client.update_run(
            run_id,
            status=RunStatus.COMPLETED.value,
            tokens_in=total_tokens_in if total_tokens_in else None,
            tokens_out=total_tokens_out if total_tokens_out else None,
        )

        return full_response
