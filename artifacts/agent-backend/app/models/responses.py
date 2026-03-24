from typing import Any, Dict, List, Optional

from pydantic import BaseModel


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


class McpCapabilityResult(BaseModel):
    name: str
    available: bool
    count: int = 0
    error: Optional[str] = None
    latency_ms: int = 0


class McpDeepHealthResult(BaseModel):
    status: str
    latency_ms: int
    message: str
    capabilities: Dict[str, McpCapabilityResult] = {}
    tool_count: int = 0
    resource_count: int = 0
    prompt_count: int = 0
    auth_ok: bool = True
    error: Optional[str] = None


class McpExecuteResult(BaseModel):
    success: bool
    content: Optional[Any] = None
    error: Optional[str] = None
    latency_ms: int
