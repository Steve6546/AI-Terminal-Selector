from typing import Any, Dict, List, Optional

from pydantic import BaseModel


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


class McpExecuteRequest(BaseModel):
    server: McpServerConfig
    tool_name: str
    arguments: Optional[Dict[str, Any]] = {}


class MessageItem(BaseModel):
    role: str
    content: Any


class ToolDefinition(BaseModel):
    name: str
    description: str
    input_schema: Dict[str, Any]
    _tool_id: Optional[int] = None
    _server_id: Optional[int] = None
    requires_approval: bool = False


class ServerInfo(BaseModel):
    id: int
    name: str
    transport_type: str
    endpoint: Optional[str] = None
    command: Optional[str] = None
    args: Optional[List[str]] = []
    auth_type: Optional[str] = "none"
    auth_secret: Optional[str] = None
    timeout: Optional[int] = 30
    retry_count: Optional[int] = 0


class ChatRequest(BaseModel):
    conversation_id: int
    messages: List[MessageItem]
    model: str = "claude-sonnet-4-6"
    mode: str = "agent"
    tools: List[ToolDefinition] = []
    servers: List[ServerInfo] = []
    system_prompt: Optional[str] = None
    attachment_blocks: Optional[List[Dict[str, Any]]] = None
    selected_server_id: Optional[int] = None
    selected_tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None


class ApprovalRequest(BaseModel):
    run_id: str
    tool_id: str
    approved: bool
