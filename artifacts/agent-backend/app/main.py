import asyncio
import json
import os
from typing import Optional

import structlog
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agent.approval_manager import resolve_approval
from .agent.runtime import AgentRuntime
from .config import settings
from .mcp.gateway import deep_health_check, discover_with_retry, execute_tool, test_with_retry
from .models.events import RunEvent
from .models.requests import (
    ApprovalRequest,
    ChatRequest,
    McpExecuteRequest,
    McpServerConfig,
)
from .models.responses import McpDeepHealthResult, McpDiscoveryResult, McpExecuteResult, McpTestResult
from .providers.router import ProviderRouter
from .services.task_manager import task_manager

import logging

_LOG_LEVEL_MAP = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
}

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        _LOG_LEVEL_MAP.get(settings.log_level.lower(), logging.INFO)
    ),
)

logger = structlog.get_logger()

app = FastAPI(title="Agent Backend — MCP Gateway & Agent Core", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:9000",
        "http://127.0.0.1:9000",
    ],
    allow_credentials=True,
    allow_methods=["POST", "GET", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

ADMIN_SECRET: str = settings.effective_admin_secret

if not ADMIN_SECRET:
    import warnings
    warnings.warn(
        "Neither ADMIN_SECRET nor SECRET_ENCRYPTION_KEY is set. "
        "All gateway requests will be rejected with 503.",
        RuntimeWarning,
        stacklevel=1,
    )

provider_router = ProviderRouter()
agent_runtime = AgentRuntime(provider_router)


def require_admin(request: Request, authorization: Optional[str] = None) -> None:
    client_host = (request.client.host if request.client else "") or ""
    is_localhost = client_host in ("127.0.0.1", "::1", "localhost")
    if is_localhost:
        return
    if not ADMIN_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Gateway misconfigured: ADMIN_SECRET or SECRET_ENCRYPTION_KEY must be set for remote access",
        )
    if authorization != f"Bearer {ADMIN_SECRET}":
        raise HTTPException(status_code=403, detail="Unauthorized")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "providers": provider_router.get_available_providers(),
    }


@app.post("/gateway/test", response_model=McpTestResult)
async def gateway_test(request: Request, config: McpServerConfig):
    require_admin(request, config.authorization)
    timeout_s = config.timeout or 30
    if config.transport_type not in ("streamable-http", "stdio"):
        raise HTTPException(status_code=400, detail=f"Unsupported transport_type: {config.transport_type}")
    if config.transport_type == "streamable-http" and not config.endpoint:
        raise HTTPException(status_code=400, detail="endpoint required for streamable-http transport")
    if config.transport_type == "stdio" and not config.command:
        raise HTTPException(status_code=400, detail="command required for stdio transport")
    return await test_with_retry(config, timeout_s)


@app.post("/gateway/execute", response_model=McpExecuteResult)
async def gateway_execute(request: Request, body: McpExecuteRequest):
    require_admin(request, body.server.authorization)
    config = body.server
    timeout_s = config.timeout or 30
    if config.transport_type not in ("streamable-http", "stdio"):
        raise HTTPException(status_code=400, detail=f"Unsupported transport_type: {config.transport_type}")
    return await execute_tool(config, body.tool_name, body.arguments or {})


@app.post("/gateway/discover", response_model=McpDiscoveryResult)
async def gateway_discover(request: Request, config: McpServerConfig):
    require_admin(request, config.authorization)
    timeout_s = config.timeout or 30
    if config.transport_type not in ("streamable-http", "stdio"):
        raise HTTPException(status_code=400, detail=f"Unsupported transport_type: {config.transport_type}")
    if config.transport_type == "streamable-http" and not config.endpoint:
        raise HTTPException(status_code=400, detail="endpoint required for streamable-http transport")
    if config.transport_type == "stdio" and not config.command:
        raise HTTPException(status_code=400, detail="command required for stdio transport")
    try:
        return await discover_with_retry(config, timeout_s)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Discovery timed out")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/gateway/deep-health", response_model=McpDeepHealthResult)
async def gateway_deep_health(request: Request, config: McpServerConfig):
    require_admin(request, config.authorization)
    timeout_s = config.timeout or 30
    if config.transport_type not in ("streamable-http", "stdio"):
        raise HTTPException(status_code=400, detail=f"Unsupported transport_type: {config.transport_type}")
    if config.transport_type == "streamable-http" and not config.endpoint:
        raise HTTPException(status_code=400, detail="endpoint required for streamable-http transport")
    if config.transport_type == "stdio" and not config.command:
        raise HTTPException(status_code=400, detail="command required for stdio transport")
    return await deep_health_check(config, timeout_s)


@app.post("/agent/chat")
async def agent_chat(request: Request, chat_request: ChatRequest):
    require_admin(request)

    events = []

    def collect_event(event: RunEvent):
        events.append(event)

    async def stream_response():
        nonlocal events

        event_queue: asyncio.Queue[Optional[RunEvent]] = asyncio.Queue()

        def emit_event(event: RunEvent):
            event_queue.put_nowait(event)

        async def run_agent():
            try:
                await agent_runtime.run(chat_request, emit_event)
            finally:
                await event_queue.put(None)

        task = asyncio.create_task(run_agent())

        try:
            while True:
                event = await event_queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event.to_sse())}\n\n"
        except asyncio.CancelledError:
            task.cancel()
            raise

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/agent/approve")
async def agent_approve(request: Request, body: ApprovalRequest):
    require_admin(request)
    success = resolve_approval(body.run_id, body.tool_id, body.approved)
    if not success:
        raise HTTPException(status_code=404, detail="No pending approval for this tool")
    return {"ok": True}


@app.get("/agent/providers")
async def list_providers(request: Request):
    require_admin(request)
    return {
        "providers": provider_router.get_available_providers(),
        "models": {
            "fast": provider_router.select_model_for_task("fast"),
            "reasoning": provider_router.select_model_for_task("reasoning"),
            "tool_optimized": provider_router.select_model_for_task("tool_optimized"),
            "cheap": provider_router.select_model_for_task("cheap"),
            "general": provider_router.select_model_for_task("general"),
        },
    }


@app.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    status = task_manager.get_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return status
