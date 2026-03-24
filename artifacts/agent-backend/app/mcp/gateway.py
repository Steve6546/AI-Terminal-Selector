import asyncio
import time
from typing import List

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

from ..models.requests import McpServerConfig
from ..models.responses import (
    McpCapabilityResult,
    McpDeepHealthResult,
    McpDiscoveredPrompt,
    McpDiscoveredResource,
    McpDiscoveredTool,
    McpDiscoveryResult,
    McpExecuteResult,
    McpTestResult,
)


def _build_http_headers(config: McpServerConfig) -> dict:
    headers = {}
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


async def test_with_retry(config: McpServerConfig, timeout_s: int) -> McpTestResult:
    max_attempts = max(1, (config.retry_count or 0) + 1)
    last_result = McpTestResult(success=False, message="No attempts", latency_ms=0)
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


async def discover_with_retry(config: McpServerConfig, timeout_s: int) -> McpDiscoveryResult:
    max_attempts = max(1, (config.retry_count or 0) + 1)
    last_exc: Exception = RuntimeError("No attempts")
    for attempt in range(max_attempts):
        if attempt > 0:
            delay = min(2 ** (attempt - 1), 10)
            await asyncio.sleep(delay)
        try:
            if config.transport_type == "streamable-http":
                return await asyncio.wait_for(_discover_http(config, timeout_s), timeout=timeout_s + 10)
            else:
                return await asyncio.wait_for(_discover_stdio(config, timeout_s), timeout=timeout_s + 10)
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
            tools.append(McpDiscoveredTool(name=t.name, description=getattr(t, "description", None), input_schema=schema))
    except Exception:
        pass

    try:
        resources_resp = await session.list_resources()
        for r in resources_resp.resources:
            resources.append(McpDiscoveredResource(
                uri=str(r.uri), name=r.name,
                description=getattr(r, "description", None),
                mime_type=getattr(r, "mimeType", None),
            ))
    except Exception:
        pass

    try:
        prompts_resp = await session.list_prompts()
        for p in prompts_resp.prompts:
            prompts.append(McpDiscoveredPrompt(name=p.name, description=getattr(p, "description", None)))
    except Exception:
        pass

    return McpDiscoveryResult(tools=tools, resources=resources, prompts=prompts)


async def _deep_health_session(session: ClientSession) -> McpDeepHealthResult:
    capabilities = {}
    tool_count = 0
    resource_count = 0
    prompt_count = 0
    has_failure = False

    t0 = time.monotonic()
    try:
        tools_resp = await session.list_tools()
        tool_count = len(tools_resp.tools)
        capabilities["tools"] = McpCapabilityResult(
            name="tools", available=True, count=tool_count,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
    except Exception as exc:
        has_failure = True
        capabilities["tools"] = McpCapabilityResult(
            name="tools", available=False, error=str(exc),
            latency_ms=int((time.monotonic() - t0) * 1000),
        )

    t1 = time.monotonic()
    try:
        resources_resp = await session.list_resources()
        resource_count = len(resources_resp.resources)
        capabilities["resources"] = McpCapabilityResult(
            name="resources", available=True, count=resource_count,
            latency_ms=int((time.monotonic() - t1) * 1000),
        )
    except Exception as exc:
        has_failure = True
        capabilities["resources"] = McpCapabilityResult(
            name="resources", available=False, error=str(exc),
            latency_ms=int((time.monotonic() - t1) * 1000),
        )

    t2 = time.monotonic()
    try:
        prompts_resp = await session.list_prompts()
        prompt_count = len(prompts_resp.prompts)
        capabilities["prompts"] = McpCapabilityResult(
            name="prompts", available=True, count=prompt_count,
            latency_ms=int((time.monotonic() - t2) * 1000),
        )
    except Exception as exc:
        has_failure = True
        capabilities["prompts"] = McpCapabilityResult(
            name="prompts", available=False, error=str(exc),
            latency_ms=int((time.monotonic() - t2) * 1000),
        )

    status = "degraded" if has_failure else "connected"
    message = "All capabilities available" if not has_failure else "Some capabilities unavailable"

    return McpDeepHealthResult(
        status=status, latency_ms=0, message=message,
        capabilities=capabilities,
        tool_count=tool_count, resource_count=resource_count, prompt_count=prompt_count,
    )


async def _deep_health_http(config: McpServerConfig, timeout_s: int) -> McpDeepHealthResult:
    headers = _build_http_headers(config)
    start = time.monotonic()
    async with streamablehttp_client(config.endpoint, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), timeout=timeout_s)
            result = await _deep_health_session(session)
            result.latency_ms = int((time.monotonic() - start) * 1000)
            return result


async def _deep_health_stdio(config: McpServerConfig, timeout_s: int) -> McpDeepHealthResult:
    parts = (config.command or "").split()
    if not parts:
        return McpDeepHealthResult(
            status="error", latency_ms=0, message="No command specified",
            error="No command specified",
        )
    cmd, *cmd_args = parts
    all_args = cmd_args + (config.args or [])
    server_params = StdioServerParameters(command=cmd, args=all_args)
    start = time.monotonic()
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), timeout=timeout_s)
            result = await _deep_health_session(session)
            result.latency_ms = int((time.monotonic() - start) * 1000)
            return result


async def deep_health_check(config: McpServerConfig, timeout_s: int) -> McpDeepHealthResult:
    start = time.monotonic()
    try:
        if config.transport_type == "streamable-http":
            result = await asyncio.wait_for(_deep_health_http(config, timeout_s), timeout=timeout_s + 10)
        else:
            result = await asyncio.wait_for(_deep_health_stdio(config, timeout_s), timeout=timeout_s + 10)
        if result.latency_ms > 5000:
            result.status = "degraded"
            result.message = f"High latency: {result.latency_ms}ms"
        return result
    except asyncio.TimeoutError:
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpDeepHealthResult(
            status="disconnected", latency_ms=latency_ms,
            message="Connection timed out", error="Connection timed out",
        )
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        msg = str(exc)
        status = "error"
        if "401" in msg or "403" in msg or "auth" in msg.lower() or "unauthorized" in msg.lower():
            status = "auth_required"
        return McpDeepHealthResult(
            status=status, latency_ms=latency_ms,
            message=msg, error=msg, auth_ok=(status != "auth_required"),
        )


async def execute_tool(config: McpServerConfig, tool_name: str, arguments: dict) -> McpExecuteResult:
    timeout_s = config.timeout or 30
    start = time.monotonic()
    try:
        if config.transport_type == "streamable-http":
            if not config.endpoint:
                raise ValueError("endpoint required for streamable-http transport")
            headers = _build_http_headers(config)
            async with streamablehttp_client(config.endpoint, headers=headers) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await asyncio.wait_for(session.initialize(), timeout=timeout_s)
                    result = await asyncio.wait_for(session.call_tool(tool_name, arguments), timeout=timeout_s)
        else:
            parts = (config.command or "").split()
            if not parts:
                raise ValueError("No command specified for stdio transport")
            cmd, *cmd_args = parts
            all_args = cmd_args + (config.args or [])
            server_params = StdioServerParameters(command=cmd, args=all_args)
            async with stdio_client(server_params) as (read, write):
                async with ClientSession(read, write) as session:
                    await asyncio.wait_for(session.initialize(), timeout=timeout_s)
                    result = await asyncio.wait_for(session.call_tool(tool_name, arguments), timeout=timeout_s)

        latency_ms = int((time.monotonic() - start) * 1000)
        content = [c.model_dump() if hasattr(c, "model_dump") else str(c) for c in result.content]
        return McpExecuteResult(success=True, content=content, latency_ms=latency_ms)

    except asyncio.TimeoutError:
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpExecuteResult(success=False, error="Tool execution timed out", latency_ms=latency_ms)
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        return McpExecuteResult(success=False, error=str(exc), latency_ms=latency_ms)
