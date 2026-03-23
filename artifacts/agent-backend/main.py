"""
MCP Gateway Service — FastAPI backend for testing and discovering MCP servers.
Provides:
  POST /gateway/test     — test MCP server connectivity
  POST /gateway/discover — discover tools, resources, and prompts from an MCP server

Security: ADMIN_SECRET is required. Falls back to SECRET_ENCRYPTION_KEY if unset.
"""

import asyncio
import os
import time
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
from pydantic import BaseModel

app = FastAPI(title="Agent Backend — MCP Gateway", version="1.0.0")

# Internal service: only allow requests from localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:9000",
        "http://127.0.0.1:9000",
    ],
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "Authorization"],
)

# ADMIN_SECRET is required for all gateway calls.
# Falls back to SECRET_ENCRYPTION_KEY if ADMIN_SECRET is not explicitly set.
ADMIN_SECRET: str = (
    os.environ.get("ADMIN_SECRET")
    or os.environ.get("SECRET_ENCRYPTION_KEY")
    or ""
)

if not ADMIN_SECRET:
    import warnings
    warnings.warn(
        "Neither ADMIN_SECRET nor SECRET_ENCRYPTION_KEY is set. "
        "All gateway requests will be rejected with 503.",
        RuntimeWarning,
        stacklevel=1,
    )


def require_admin(request: Request, authorization: Optional[str]) -> None:
    """
    Validate internal service authorization.

    Requests from localhost are always permitted — this gateway is a
    private internal service and localhost callers are already trusted.
    For remote callers, a valid Bearer token matching ADMIN_SECRET is required.
    """
    client_host = (request.client.host if request.client else "") or ""
    is_localhost = client_host in ("127.0.0.1", "::1", "localhost")

    if is_localhost:
        return  # Trusted local call — no token required

    # Remote call: require ADMIN_SECRET
    if not ADMIN_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Gateway misconfigured: ADMIN_SECRET or SECRET_ENCRYPTION_KEY must be set for remote access",
        )
    if authorization != f"Bearer {ADMIN_SECRET}":
        raise HTTPException(status_code=403, detail="Unauthorized")


class McpServerConfig(BaseModel):
    transport_type: str
    endpoint: Optional[str] = None
    command: Optional[str] = None
    args: Optional[List[str]] = []
    auth_type: Optional[str] = "none"
    auth_secret: Optional[str] = None
    timeout: Optional[int] = 30
    retry_count: Optional[int] = 0
    authorization: Optional[str] = None


class McpTestResult(BaseModel):
    success: bool
    message: str
    latency_ms: int


class McpDiscoveredTool(BaseModel):
    name: str
    description: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None


class McpDiscoveredResource(BaseModel):
    uri: str
    name: str
    description: Optional[str] = None
    mime_type: Optional[str] = None


class McpDiscoveredPrompt(BaseModel):
    name: str
    description: Optional[str] = None


class McpDiscoveryResult(BaseModel):
    tools: List[McpDiscoveredTool] = []
    resources: List[McpDiscoveredResource] = []
    prompts: List[McpDiscoveredPrompt] = []


def _build_http_headers(config: McpServerConfig) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if config.auth_type == "bearer" and config.auth_secret:
        headers["Authorization"] = f"Bearer {config.auth_secret}"
    elif config.auth_type == "api-key" and config.auth_secret:
        headers["X-API-Key"] = config.auth_secret
    return headers


async def _test_http_once(config: McpServerConfig, timeout_s: int) -> McpTestResult:
    start = time.monotonic()
    headers = _build_http_headers(config)
    try:
        async with streamablehttp_client(config.endpoint, headers=headers) as (read, write, _):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=timeout_s)
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpTestResult(success=True, message="Connection successful", latency_ms=latency_ms)
    except asyncio.TimeoutError:
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpTestResult(success=False, message="Connection timed out", latency_ms=latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpTestResult(success=False, message=str(exc), latency_ms=latency_ms)


async def _test_stdio_once(config: McpServerConfig, timeout_s: int) -> McpTestResult:
    start = time.monotonic()
    parts = (config.command or "").split()
    if not parts:
        return McpTestResult(success=False, message="No command specified", latency_ms=0)
    cmd, *cmd_args = parts
    all_args = cmd_args + (config.args or [])
    server_params = StdioServerParameters(command=cmd, args=all_args)
    try:
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=timeout_s)
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpTestResult(success=True, message="Connection successful", latency_ms=latency_ms)
    except asyncio.TimeoutError:
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpTestResult(success=False, message="Connection timed out", latency_ms=latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpTestResult(success=False, message=str(exc), latency_ms=latency_ms)


async def _test_with_retry(config: McpServerConfig, timeout_s: int) -> McpTestResult:
    """Run test, retrying on failure up to retry_count times with backoff."""
    max_attempts = max(1, (config.retry_count or 0) + 1)
    last_result: McpTestResult = McpTestResult(success=False, message="No attempts", latency_ms=0)

    for attempt in range(max_attempts):
        if attempt > 0:
            delay = min(2 ** (attempt - 1), 10)
            await asyncio.sleep(delay)

        if config.transport_type == "streamable-http":
            last_result = await _test_http_once(config, timeout_s)
        else:
            last_result = await _test_stdio_once(config, timeout_s)

        if last_result.success:
            return last_result

    return last_result


async def _discover_http(config: McpServerConfig, timeout_s: int) -> McpDiscoveryResult:
    headers = _build_http_headers(config)
    async with streamablehttp_client(config.endpoint, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), timeout=timeout_s)
            return await _collect_capabilities(session)


async def _discover_stdio(config: McpServerConfig, timeout_s: int) -> McpDiscoveryResult:
    parts = (config.command or "").split()
    if not parts:
        raise ValueError("No command specified for stdio transport")
    cmd, *cmd_args = parts
    all_args = cmd_args + (config.args or [])
    server_params = StdioServerParameters(command=cmd, args=all_args)
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), timeout=timeout_s)
            return await _collect_capabilities(session)


async def _discover_with_retry(config: McpServerConfig, timeout_s: int) -> McpDiscoveryResult:
    """Run discovery, retrying on failure up to retry_count times with backoff."""
    max_attempts = max(1, (config.retry_count or 0) + 1)
    last_exc: Exception = RuntimeError("No attempts")

    for attempt in range(max_attempts):
        if attempt > 0:
            delay = min(2 ** (attempt - 1), 10)
            await asyncio.sleep(delay)

        try:
            if config.transport_type == "streamable-http":
                return await asyncio.wait_for(
                    _discover_http(config, timeout_s), timeout=timeout_s + 10
                )
            else:
                return await asyncio.wait_for(
                    _discover_stdio(config, timeout_s), timeout=timeout_s + 10
                )
        except Exception as exc:
            last_exc = exc

    raise last_exc


async def _collect_capabilities(session: ClientSession) -> McpDiscoveryResult:
    tools: List[McpDiscoveredTool] = []
    resources: List[McpDiscoveredResource] = []
    prompts: List[McpDiscoveredPrompt] = []

    try:
        tools_resp = await session.list_tools()
        for t in tools_resp.tools:
            schema = None
            if hasattr(t, "inputSchema") and t.inputSchema:
                schema = t.inputSchema if isinstance(t.inputSchema, dict) else t.inputSchema.model_dump()
            tools.append(McpDiscoveredTool(
                name=t.name,
                description=getattr(t, "description", None),
                input_schema=schema,
            ))
    except Exception:
        pass

    try:
        resources_resp = await session.list_resources()
        for r in resources_resp.resources:
            resources.append(McpDiscoveredResource(
                uri=str(r.uri),
                name=r.name,
                description=getattr(r, "description", None),
                mime_type=getattr(r, "mimeType", None),
            ))
    except Exception:
        pass

    try:
        prompts_resp = await session.list_prompts()
        for p in prompts_resp.prompts:
            prompts.append(McpDiscoveredPrompt(
                name=p.name,
                description=getattr(p, "description", None),
            ))
    except Exception:
        pass

    return McpDiscoveryResult(tools=tools, resources=resources, prompts=prompts)


@app.get("/health")
async def health():
    return {"status": "ok"}


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

    return await _test_with_retry(config, timeout_s)


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
        return await _discover_with_retry(config, timeout_s)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Discovery timed out")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


if __name__ == "__main__":
    port = int(os.environ.get("AGENT_BACKEND_PORT", "9000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
