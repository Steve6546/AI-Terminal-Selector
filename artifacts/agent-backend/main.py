"""
MCP Gateway Service — FastAPI backend for testing and discovering MCP servers.
Provides:
  POST /gateway/test     — test MCP server connectivity
  POST /gateway/discover — discover tools, resources, and prompts from an MCP server
"""

import asyncio
import os
import time
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
from pydantic import BaseModel

app = FastAPI(title="Agent Backend — MCP Gateway", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")


def require_admin(authorization: Optional[str] = None):
    """Validate internal service authorization header."""
    if not ADMIN_SECRET:
        return
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


async def _test_http(config: McpServerConfig, timeout_s: int) -> McpTestResult:
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


async def _test_stdio(config: McpServerConfig, timeout_s: int) -> McpTestResult:
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
async def gateway_test(config: McpServerConfig):
    require_admin(config.authorization)
    timeout_s = config.timeout or 30

    if config.transport_type == "streamable-http":
        if not config.endpoint:
            raise HTTPException(status_code=400, detail="endpoint required for streamable-http transport")
        return await _test_http(config, timeout_s)
    elif config.transport_type == "stdio":
        if not config.command:
            raise HTTPException(status_code=400, detail="command required for stdio transport")
        return await _test_stdio(config, timeout_s)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported transport_type: {config.transport_type}")


@app.post("/gateway/discover", response_model=McpDiscoveryResult)
async def gateway_discover(config: McpServerConfig):
    require_admin(config.authorization)
    timeout_s = config.timeout or 30

    try:
        if config.transport_type == "streamable-http":
            if not config.endpoint:
                raise HTTPException(status_code=400, detail="endpoint required for streamable-http transport")
            return await asyncio.wait_for(_discover_http(config, timeout_s), timeout=timeout_s + 10)
        elif config.transport_type == "stdio":
            if not config.command:
                raise HTTPException(status_code=400, detail="command required for stdio transport")
            return await asyncio.wait_for(_discover_stdio(config, timeout_s), timeout=timeout_s + 10)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported transport_type: {config.transport_type}")
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Discovery timed out")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


if __name__ == "__main__":
    port = int(os.environ.get("AGENT_BACKEND_PORT", "9000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
