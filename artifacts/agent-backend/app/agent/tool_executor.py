import json
import time
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

import structlog

from ..config import settings
from ..mcp.gateway import execute_tool as mcp_execute_tool
from ..models.events import EventType, RunEvent
from ..models.requests import McpServerConfig, ServerInfo, ToolDefinition
from ..services import db_client
from .approval_manager import wait_for_approval

logger = structlog.get_logger()


class ToolExecutionResult:
    __slots__ = ("success", "content", "error", "duration_ms", "execution_id")

    def __init__(
        self,
        success: bool,
        content: Any = None,
        error: Optional[str] = None,
        duration_ms: int = 0,
        execution_id: Optional[int] = None,
    ):
        self.success = success
        self.content = content
        self.error = error
        self.duration_ms = duration_ms
        self.execution_id = execution_id


class ToolExecutor:
    def __init__(
        self,
        run_id: str,
        run_db_id: Optional[int],
        conversation_id: int,
        servers: List[ServerInfo],
        tools: List[ToolDefinition],
        emit: Callable[[RunEvent], None],
    ):
        self._run_id = run_id
        self._run_db_id = run_db_id
        self._conversation_id = conversation_id
        self._server_map: Dict[int, ServerInfo] = {s.id: s for s in servers}
        self._tool_map: Dict[str, ToolDefinition] = {}
        for t in tools:
            self._tool_map[t.name] = t
        self._emit = emit

    def _parse_tool_name(self, namespaced: str):
        idx = namespaced.index("__") if "__" in namespaced else -1
        if idx > 0:
            server_id = int(namespaced[:idx])
            tool_name = namespaced[idx + 2:]
            return server_id, tool_name
        return None, namespaced

    async def execute(
        self,
        tool_id: str,
        namespaced_name: str,
        arguments: Dict[str, Any],
    ) -> ToolExecutionResult:
        server_id, raw_tool_name = self._parse_tool_name(namespaced_name)
        server = self._server_map.get(server_id) if server_id else None
        tool_def = self._tool_map.get(namespaced_name)

        if not tool_def:
            error_msg = f"Tool '{namespaced_name}' is not in the allowed tool list"
            logger.warning("tool_not_allowed", tool=namespaced_name)
            self._emit(RunEvent(
                type=EventType.TOOL_COMPLETED,
                run_id=self._run_id,
                data={
                    "tool_id": tool_id,
                    "success": False,
                    "duration_ms": 0,
                    "error": error_msg,
                },
            ))
            return ToolExecutionResult(success=False, error=error_msg)

        if not server:
            error_msg = f"Server not found for tool '{namespaced_name}'"
            logger.warning("server_not_found_for_tool", tool=namespaced_name, server_id=server_id)
            self._emit(RunEvent(
                type=EventType.TOOL_COMPLETED,
                run_id=self._run_id,
                data={
                    "tool_id": tool_id,
                    "success": False,
                    "duration_ms": 0,
                    "error": error_msg,
                },
            ))
            return ToolExecutionResult(success=False, error=error_msg)

        requires_approval = tool_def.requires_approval

        tc_record = await db_client.persist_tool_call(
            run_db_id=self._run_db_id,
            server_id=server_id,
            tool_name=raw_tool_name,
            arguments=arguments,
            status="pending",
            requires_approval=requires_approval,
        )
        tc_id = tc_record.get("id") if tc_record else None

        if requires_approval:
            self._emit(RunEvent(
                type=EventType.TOOL_APPROVAL_REQUIRED,
                run_id=self._run_id,
                data={
                    "tool_id": tool_id,
                    "tool_name": raw_tool_name,
                    "server_name": server.name if server else None,
                    "inputs": arguments,
                },
            ))

            approved = await wait_for_approval(self._run_id, tool_id)

            decision = "approved" if approved else "rejected"
            await db_client.persist_approval_decision(
                run_db_id=self._run_db_id,
                tool_call_id=tc_id,
                tool_name=raw_tool_name,
                server_name=server.name if server else None,
                inputs=arguments,
                decision=decision,
            )

            if tc_id:
                await db_client.update_tool_call(tc_id, status=decision, approval_decision=decision)

            if not approved:
                exec_record = await db_client.persist_execution(
                    conversation_id=self._conversation_id,
                    server_id=server_id,
                    tool_name=raw_tool_name,
                    status="error",
                    arguments=arguments,
                    error_message="Rejected by user",
                    duration_ms=0,
                )
                exec_id = exec_record.get("id") if exec_record else None

                self._emit(RunEvent(
                    type=EventType.TOOL_COMPLETED,
                    run_id=self._run_id,
                    data={
                        "tool_id": tool_id,
                        "execution_id": exec_id,
                        "success": False,
                        "duration_ms": 0,
                        "error": "Rejected by user",
                    },
                ))
                return ToolExecutionResult(success=False, error="Rejected by user", execution_id=exec_id)

        self._emit(RunEvent(
            type=EventType.TOOL_STARTED,
            run_id=self._run_id,
            data={
                "tool_id": tool_id,
                "tool_name": raw_tool_name,
                "server_id": server_id,
                "server_name": server.name if server else None,
                "inputs": arguments,
            },
        ))

        if tc_id:
            await db_client.update_tool_call(tc_id, status="running")

        exec_record = await db_client.persist_execution(
            conversation_id=self._conversation_id,
            server_id=server_id,
            tool_name=raw_tool_name,
            status="running",
            arguments=arguments,
        )
        exec_id = exec_record.get("id") if exec_record else None

        start = time.monotonic()

        mcp_config = McpServerConfig(
            transport_type=server.transport_type,
            endpoint=server.endpoint,
            command=server.command,
            args=server.args or [],
            auth_type=server.auth_type,
            auth_secret=server.auth_secret,
            timeout=server.timeout,
            retry_count=server.retry_count,
        )

        result = await mcp_execute_tool(mcp_config, raw_tool_name, arguments)
        duration_ms = int((time.monotonic() - start) * 1000)

        if result.success and result.content:
            content_str = json.dumps(result.content, default=str) if not isinstance(result.content, str) else result.content
            self._emit(RunEvent(
                type=EventType.TOOL_STDOUT,
                run_id=self._run_id,
                data={"tool_id": tool_id, "content": content_str[:8192]},
            ))

            size_bytes = len(content_str.encode("utf-8"))
            if size_bytes > 512:
                is_json = not isinstance(result.content, str)
                artifact_type = "json" if is_json else "text"
                self._emit(RunEvent(
                    type=EventType.ARTIFACT_CREATED,
                    run_id=self._run_id,
                    data={
                        "tool_id": tool_id,
                        "tool_name": raw_tool_name,
                        "artifact_type": artifact_type,
                        "size_bytes": size_bytes,
                        "preview": content_str[:200],
                    },
                ))

        await self._finalize_execution(
            exec_id, tc_id, tool_id,
            result.success, result.content, result.error, duration_ms,
        )

        return ToolExecutionResult(
            success=result.success,
            content=result.content,
            error=result.error,
            duration_ms=duration_ms,
            execution_id=exec_id,
        )

    async def _finalize_execution(
        self,
        exec_id: Optional[int],
        tc_id: Optional[int],
        tool_id: str,
        success: bool,
        content: Any,
        error: Optional[str],
        duration_ms: int,
    ):
        result_text = ""
        if success:
            result_text = json.dumps(content, default=str) if content else ""
        else:
            result_text = f"Error: {error or 'Unknown error'}"

        if exec_id:
            await db_client.update_execution(
                execution_id=exec_id,
                status="success" if success else "error",
                result_summary=result_text[:500],
                raw_result=content if isinstance(content, dict) else None,
                error_message=error if not success else None,
                duration_ms=duration_ms,
            )

        if tc_id:
            await db_client.update_tool_call(
                tc_id,
                status="success" if success else "error",
                result=content if isinstance(content, dict) else None,
                result_summary=result_text[:500],
                error_message=error if not success else None,
                duration_ms=duration_ms,
            )

        self._emit(RunEvent(
            type=EventType.TOOL_COMPLETED,
            run_id=self._run_id,
            data={
                "tool_id": tool_id,
                "execution_id": exec_id,
                "success": success,
                "duration_ms": duration_ms,
                **({"error": error} if error else {}),
            },
        ))
