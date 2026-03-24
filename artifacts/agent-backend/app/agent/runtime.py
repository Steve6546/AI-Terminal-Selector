import json
import uuid
from typing import Any, Callable, Dict, List, Optional

import structlog

from ..config import settings
from ..models.agent_types import AgentMode, RunStatus
from ..models.events import EventType, RunEvent
from ..models.requests import ChatRequest, ServerInfo, ToolDefinition
from ..providers.base import StreamChunk
from ..providers.router import ProviderRouter
from ..services import db_client
from .memory_manager import MemoryManager
from .result_formatter import ResultFormatter
from .run_event_emitter import RunEventEmitter
from .run_state import RunStateMachine
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


class AgentRuntime:
    def __init__(self, provider_router: ProviderRouter):
        self._router = provider_router
        self._memory = MemoryManager(provider_router)
        self._formatter = ResultFormatter()

    async def run(
        self,
        request: ChatRequest,
        emit: Callable[[RunEvent], None],
    ) -> str:
        run_id = str(uuid.uuid4())
        try:
            mode = AgentMode(request.mode) if request.mode else AgentMode.AGENT
        except ValueError:
            mode = AgentMode.AGENT
        model = request.model or settings.default_model

        run_record = await db_client.persist_run(
            run_id=run_id,
            conversation_id=request.conversation_id,
            model=model,
            mode=mode.value,
        )
        run_db_id = run_record.get("id") if run_record else None

        state = RunStateMachine(run_id, run_db_id)
        emitter = RunEventEmitter(run_id, run_db_id, emit)

        await emitter.run_created(request.conversation_id, model, mode.value)

        try:
            await state.transition(RunStatus.RUNNING)

            if mode == AgentMode.TOOL:
                full_response = await self._run_tool_mode(request, state, emitter)
            elif mode == AgentMode.AGENT:
                full_response = await self._run_agent_mode(request, state, emitter, model)
            else:
                full_response = await self._run_chat_mode(request, state, emitter, model)

            await state.transition(RunStatus.COMPLETED)
            await emitter.run_completed()
            return full_response

        except Exception as exc:
            error_msg = str(exc)
            logger.error("agent_run_failed", run_id=run_id, error=error_msg)
            await state.transition(RunStatus.FAILED, error_message=error_msg)
            await emitter.run_failed(error_msg)
            return ""

    async def _run_chat_mode(
        self,
        request: ChatRequest,
        state: RunStateMachine,
        emitter: RunEventEmitter,
        model: str,
    ) -> str:
        await emitter.model_started()

        provider = self._router.get_provider_for_model(model)
        if not provider:
            task_result = self._router.get_provider_for_task("general")
            if task_result:
                provider, model = task_result
            else:
                raise RuntimeError(f"No provider available for model {model}")

        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        messages = await self._memory.prepare_messages(messages)
        full_response = ""

        async for chunk in provider.stream_completion(model=model, messages=messages, max_tokens=8192):
            if chunk.chunk_type == "text":
                full_response += chunk.content
                emitter.text_delta(chunk.content)
            elif chunk.chunk_type == "error":
                raise RuntimeError(chunk.content)

        return full_response

    async def _run_tool_mode(
        self,
        request: ChatRequest,
        state: RunStateMachine,
        emitter: RunEventEmitter,
    ) -> str:
        await emitter.model_started()

        if not request.selected_server_id or not request.selected_tool_name:
            raise RuntimeError("Tool mode requires selected_server_id and selected_tool_name")

        namespaced = f"{request.selected_server_id}__{request.selected_tool_name}"
        allowed_names = {t.name for t in request.tools}
        if namespaced not in allowed_names:
            raise RuntimeError(
                f"Tool '{request.selected_tool_name}' on server {request.selected_server_id} "
                "is not enabled or does not exist"
            )

        tool_executor = ToolExecutor(
            run_id=state.run_id,
            run_db_id=state.run_db_id,
            conversation_id=request.conversation_id,
            servers=request.servers,
            tools=request.tools,
            emit=emitter._emit,
        )

        await state.transition(RunStatus.TOOL_CALLING)

        tool_id = f"tool_{uuid.uuid4().hex[:8]}"
        namespaced = f"{request.selected_server_id}__{request.selected_tool_name}"
        tool_args = request.tool_args or {}

        result = await tool_executor.execute(tool_id, namespaced, tool_args)

        await state.transition(RunStatus.RUNNING)

        full_response = self._formatter.format_tool_result(
            tool_name=request.selected_tool_name,
            success=result.success,
            content=result.content,
            error=result.error,
            duration_ms=result.duration_ms,
        )

        emitter.text_delta(full_response)
        return full_response

    async def _run_agent_mode(
        self,
        request: ChatRequest,
        state: RunStateMachine,
        emitter: RunEventEmitter,
        model: str,
    ) -> str:
        await emitter.model_started()

        provider = self._router.get_provider_for_model(model)
        if not provider:
            task_result = self._router.get_provider_for_task("tool_optimized")
            if task_result:
                provider, model = task_result
            else:
                raise RuntimeError(f"No provider available for model {model}")

        tool_executor = ToolExecutor(
            run_id=state.run_id,
            run_db_id=state.run_db_id,
            conversation_id=request.conversation_id,
            servers=request.servers,
            tools=request.tools,
            emit=emitter._emit,
        )

        provider_tools = [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema}
            for t in request.tools
        ]

        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        messages = await self._memory.prepare_messages(messages)

        system_prompt = request.system_prompt or AGENT_SYSTEM_PROMPT

        emitter.thinking_started("Planning...")

        if request.servers:
            server_names = [s.name for s in request.servers]
            emitter.thinking_delta(f"Connected servers: {', '.join(server_names)}")
        else:
            emitter.thinking_delta("No MCP servers connected — will respond from knowledge only")

        if provider_tools:
            tool_names = [t["name"].split("__")[-1] for t in provider_tools[:8]]
            extra = f" +{len(provider_tools) - 8} more" if len(provider_tools) > 8 else ""
            emitter.thinking_delta(f"Available tools: {', '.join(tool_names)}{extra}")

        loop_messages = list(messages)
        full_response = ""
        max_loops = settings.max_agent_loops

        for loop_count in range(1, max_loops + 1):
            if loop_count > 1:
                emitter.thinking_delta(f"Iteration {loop_count}: reviewing tool results and deciding next step...")

            current_text = ""
            tool_use_blocks: List[Dict[str, Any]] = []
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
                        emitter.thinking_completed()
                        thinking_completed = True
                    current_text += chunk.content
                    full_response += chunk.content
                    emitter.text_delta(chunk.content)

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
                        state.add_tokens(
                            tokens_in=usage_data.get("input_tokens", 0),
                            tokens_out=usage_data.get("output_tokens", usage_data.get("completion_tokens", 0)),
                        )
                    except (json.JSONDecodeError, TypeError):
                        pass

                elif chunk.chunk_type == "error":
                    raise RuntimeError(chunk.content)

            if not thinking_completed:
                emitter.thinking_completed()

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

            await state.transition(RunStatus.TOOL_CALLING)

            tool_results = []
            for block in tool_use_blocks:
                raw_name = block["name"].split("__")[-1] if "__" in block["name"] else block["name"]
                emitter.thinking_delta(f"Selecting tool: {raw_name}")

                result = await tool_executor.execute(block["id"], block["name"], block["input"])

                result_text = self._formatter.format_tool_content_for_model(
                    success=result.success,
                    content=result.content,
                    error=result.error,
                )

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

            await state.transition(RunStatus.RUNNING)

        return full_response
