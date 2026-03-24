import asyncio
from typing import Any, Callable, Coroutine, Dict, Optional
from uuid import uuid4

import structlog

logger = structlog.get_logger()


class TaskInfo:
    __slots__ = ("task_id", "name", "status", "task", "result", "error")

    def __init__(self, task_id: str, name: str, task: asyncio.Task):
        self.task_id = task_id
        self.name = name
        self.status = "running"
        self.task = task
        self.result: Any = None
        self.error: Optional[str] = None


class TaskManager:
    def __init__(self):
        self._tasks: Dict[str, TaskInfo] = {}

    def submit(
        self,
        coro: Coroutine,
        name: str = "",
    ) -> str:
        task_id = uuid4().hex[:12]
        loop_task = asyncio.create_task(self._run_wrapper(task_id, coro))
        info = TaskInfo(task_id=task_id, name=name or task_id, task=loop_task)
        self._tasks[task_id] = info
        logger.info("task_submitted", task_id=task_id, name=name)
        return task_id

    async def _run_wrapper(self, task_id: str, coro: Coroutine) -> None:
        info = self._tasks.get(task_id)
        if not info:
            return
        try:
            info.result = await coro
            info.status = "completed"
            logger.info("task_completed", task_id=task_id, name=info.name)
        except asyncio.CancelledError:
            info.status = "cancelled"
            logger.info("task_cancelled", task_id=task_id, name=info.name)
        except Exception as exc:
            info.status = "failed"
            info.error = str(exc)
            logger.error("task_failed", task_id=task_id, name=info.name, error=str(exc))

    def cancel(self, task_id: str) -> bool:
        info = self._tasks.get(task_id)
        if info and info.status == "running":
            info.task.cancel()
            return True
        return False

    def get_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        info = self._tasks.get(task_id)
        if not info:
            return None
        return {
            "task_id": info.task_id,
            "name": info.name,
            "status": info.status,
            "error": info.error,
        }

    def cleanup_completed(self) -> int:
        to_remove = [tid for tid, info in self._tasks.items() if info.status in ("completed", "failed", "cancelled")]
        for tid in to_remove:
            del self._tasks[tid]
        return len(to_remove)


task_manager = TaskManager()
