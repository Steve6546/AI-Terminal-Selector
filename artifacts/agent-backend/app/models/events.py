from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel


class EventType(str, Enum):
    RUN_CREATED = "run.created"
    MODEL_STARTED = "model.started"
    THINKING_STARTED = "thinking.started"
    THINKING_DELTA = "thinking.delta"
    THINKING_COMPLETED = "thinking.completed"
    TEXT_DELTA = "text.delta"
    TOOL_STARTED = "tool.started"
    TOOL_STDOUT = "tool.stdout"
    TOOL_COMPLETED = "tool.completed"
    TOOL_APPROVAL_REQUIRED = "tool.approval_required"
    ARTIFACT_CREATED = "artifact.created"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"


class RunEvent(BaseModel):
    type: EventType
    run_id: str
    data: Dict[str, Any] = {}

    def to_sse(self) -> dict:
        result = {"type": self.type.value, "run_id": self.run_id}
        result.update(self.data)
        return result
