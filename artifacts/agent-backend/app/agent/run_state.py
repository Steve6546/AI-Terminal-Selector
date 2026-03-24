from enum import Enum
from typing import Optional

import structlog

from ..models.agent_types import RunStatus
from ..services import db_client

logger = structlog.get_logger()


class RunStateMachine:
    def __init__(self, run_id: str, run_db_id: Optional[int]):
        self._run_id = run_id
        self._run_db_id = run_db_id
        self._status = RunStatus.PENDING
        self._tokens_in = 0
        self._tokens_out = 0

    @property
    def status(self) -> RunStatus:
        return self._status

    @property
    def run_id(self) -> str:
        return self._run_id

    @property
    def run_db_id(self) -> Optional[int]:
        return self._run_db_id

    VALID_TRANSITIONS = {
        RunStatus.PENDING: {RunStatus.RUNNING, RunStatus.FAILED},
        RunStatus.RUNNING: {RunStatus.TOOL_CALLING, RunStatus.COMPLETED, RunStatus.FAILED},
        RunStatus.TOOL_CALLING: {RunStatus.RUNNING, RunStatus.COMPLETED, RunStatus.FAILED},
        RunStatus.COMPLETED: set(),
        RunStatus.FAILED: set(),
    }

    async def transition(self, new_status: RunStatus, error_message: Optional[str] = None) -> bool:
        valid = self.VALID_TRANSITIONS.get(self._status, set())
        if new_status not in valid:
            logger.warning(
                "invalid_state_transition",
                run_id=self._run_id,
                from_status=self._status.value,
                to_status=new_status.value,
            )
            return False

        old = self._status
        self._status = new_status

        await db_client.update_run(
            self._run_id,
            status=new_status.value,
            tokens_in=self._tokens_in if self._tokens_in else None,
            tokens_out=self._tokens_out if self._tokens_out else None,
            error_message=error_message,
        )
        await db_client.persist_run_event(
            self._run_db_id,
            f"state.{new_status.value}",
            {"from": old.value, "to": new_status.value},
        )

        logger.info(
            "run_state_transition",
            run_id=self._run_id,
            from_status=old.value,
            to_status=new_status.value,
        )
        return True

    def add_tokens(self, tokens_in: int = 0, tokens_out: int = 0):
        self._tokens_in += tokens_in
        self._tokens_out += tokens_out
