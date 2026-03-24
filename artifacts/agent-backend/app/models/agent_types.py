from enum import Enum


class AgentMode(str, Enum):
    CHAT = "chat"
    AGENT = "agent"
    TOOL = "tool"


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    TOOL_CALLING = "tool_calling"
    COMPLETED = "completed"
    FAILED = "failed"


class ToolCallStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    TIMEOUT = "timeout"
