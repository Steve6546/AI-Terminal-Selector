from typing import Any, Dict, Optional

import httpx
import structlog

from ..config import settings

logger = structlog.get_logger()

API_BASE = settings.api_server_url


async def persist_run(
    run_id: str,
    conversation_id: int,
    model: str,
    mode: str,
    status: str = "running",
) -> Optional[Dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{API_BASE}/api/internal/runs",
                json={
                    "runId": run_id,
                    "conversationId": conversation_id,
                    "model": model,
                    "mode": mode,
                    "status": status,
                },
            )
            if resp.status_code < 300:
                return resp.json()
    except Exception as exc:
        logger.warning("persist_run_failed", run_id=run_id, error=str(exc))
    return None


async def update_run(
    run_id: str,
    status: str,
    tokens_in: Optional[int] = None,
    tokens_out: Optional[int] = None,
    error_message: Optional[str] = None,
) -> None:
    try:
        body: Dict[str, Any] = {"status": status}
        if tokens_in is not None:
            body["tokensIn"] = tokens_in
        if tokens_out is not None:
            body["tokensOut"] = tokens_out
        if error_message:
            body["errorMessage"] = error_message
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.patch(f"{API_BASE}/api/internal/runs/{run_id}", json=body)
    except Exception as exc:
        logger.warning("update_run_failed", run_id=run_id, error=str(exc))


async def persist_run_event(
    run_db_id: Optional[int],
    event_type: str,
    data: Optional[Dict[str, Any]] = None,
) -> None:
    if not run_db_id:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{API_BASE}/api/internal/run-events",
                json={
                    "runId": run_db_id,
                    "eventType": event_type,
                    "data": data,
                },
            )
    except Exception as exc:
        logger.warning("persist_run_event_failed", event_type=event_type, error=str(exc))


async def persist_tool_call(
    run_db_id: Optional[int],
    server_id: Optional[int],
    tool_name: str,
    arguments: dict,
    status: str = "pending",
    requires_approval: bool = False,
) -> Optional[Dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{API_BASE}/api/internal/tool-calls",
                json={
                    "runId": run_db_id,
                    "serverId": server_id,
                    "toolName": tool_name,
                    "arguments": arguments,
                    "status": status,
                    "requiresApproval": requires_approval,
                },
            )
            if resp.status_code < 300:
                return resp.json()
    except Exception as exc:
        logger.warning("persist_tool_call_failed", tool_name=tool_name, error=str(exc))
    return None


async def update_tool_call(
    tool_call_id: int,
    status: str,
    result: Optional[dict] = None,
    result_summary: Optional[str] = None,
    error_message: Optional[str] = None,
    approval_decision: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> None:
    try:
        body: Dict[str, Any] = {"status": status}
        if result is not None:
            body["result"] = result
        if result_summary:
            body["resultSummary"] = result_summary
        if error_message:
            body["errorMessage"] = error_message
        if approval_decision:
            body["approvalDecision"] = approval_decision
        if duration_ms is not None:
            body["durationMs"] = duration_ms
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.patch(f"{API_BASE}/api/internal/tool-calls/{tool_call_id}", json=body)
    except Exception as exc:
        logger.warning("update_tool_call_failed", tool_call_id=tool_call_id, error=str(exc))


async def persist_approval_decision(
    run_db_id: Optional[int],
    tool_call_id: Optional[int],
    tool_name: str,
    server_name: Optional[str],
    inputs: dict,
    decision: str,
    reason: Optional[str] = None,
) -> None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{API_BASE}/api/internal/approvals",
                json={
                    "runId": run_db_id,
                    "toolCallId": tool_call_id,
                    "toolName": tool_name,
                    "serverName": server_name,
                    "inputs": inputs,
                    "decision": decision,
                    "reason": reason,
                },
            )
    except Exception as exc:
        logger.warning("persist_approval_failed", tool_name=tool_name, error=str(exc))


async def persist_execution(
    conversation_id: int,
    server_id: Optional[int],
    tool_name: str,
    status: str,
    arguments: dict,
    result_summary: Optional[str] = None,
    raw_result: Optional[Any] = None,
    error_message: Optional[str] = None,
    duration_ms: int = 0,
) -> Optional[Dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{API_BASE}/api/internal/executions",
                json={
                    "conversationId": conversation_id,
                    "serverId": server_id,
                    "toolName": tool_name,
                    "status": status,
                    "arguments": arguments,
                    "resultSummary": result_summary,
                    "rawResult": raw_result,
                    "errorMessage": error_message,
                    "durationMs": duration_ms,
                },
            )
            if resp.status_code < 300:
                return resp.json()
    except Exception as exc:
        logger.warning("persist_execution_failed", tool_name=tool_name, error=str(exc))
    return None


async def update_execution(
    execution_id: int,
    status: str,
    result_summary: Optional[str] = None,
    raw_result: Optional[Any] = None,
    error_message: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> None:
    try:
        body: Dict[str, Any] = {"status": status}
        if result_summary is not None:
            body["resultSummary"] = result_summary
        if raw_result is not None:
            body["rawResult"] = raw_result
        if error_message is not None:
            body["errorMessage"] = error_message
        if duration_ms is not None:
            body["durationMs"] = duration_ms
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.patch(f"{API_BASE}/api/internal/executions/{execution_id}", json=body)
    except Exception as exc:
        logger.warning("update_execution_failed", execution_id=execution_id, error=str(exc))
