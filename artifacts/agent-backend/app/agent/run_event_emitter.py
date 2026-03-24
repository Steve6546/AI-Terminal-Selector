from typing import Any, Callable, Dict, Optional

from ..models.events import EventType, RunEvent
from ..services import db_client


class RunEventEmitter:
    def __init__(
        self,
        run_id: str,
        run_db_id: Optional[int],
        emit_callback: Callable[[RunEvent], None],
    ):
        self._run_id = run_id
        self._run_db_id = run_db_id
        self._emit = emit_callback

    def emit(self, event_type: EventType, data: Optional[Dict[str, Any]] = None):
        event = RunEvent(type=event_type, run_id=self._run_id, data=data)
        self._emit(event)

    async def emit_and_persist(self, event_type: EventType, data: Optional[Dict[str, Any]] = None):
        self.emit(event_type, data)
        await db_client.persist_run_event(
            self._run_db_id,
            event_type.value,
            data,
        )

    async def run_created(self, conversation_id: int, model: str, mode: str):
        await self.emit_and_persist(EventType.RUN_CREATED, {
            "conversation_id": conversation_id,
            "model": model,
            "mode": mode,
        })

    async def model_started(self):
        await self.emit_and_persist(EventType.MODEL_STARTED)

    def thinking_started(self, message: str = "Planning..."):
        self.emit(EventType.THINKING_STARTED, {"message": message})

    def thinking_delta(self, content: str):
        self.emit(EventType.THINKING_DELTA, {"content": content})

    def thinking_completed(self):
        self.emit(EventType.THINKING_COMPLETED)

    def text_delta(self, content: str):
        self.emit(EventType.TEXT_DELTA, {"content": content})

    async def run_completed(self):
        await self.emit_and_persist(EventType.RUN_COMPLETED)

    async def run_failed(self, error: str):
        await self.emit_and_persist(EventType.RUN_FAILED, {"error": error})
