import asyncio
from typing import Dict, Optional, Tuple

import structlog

from ..config import settings

logger = structlog.get_logger()

_pending_approvals: Dict[str, asyncio.Future] = {}


def make_approval_key(run_id: str, tool_id: str) -> str:
    return f"{run_id}:{tool_id}"


async def wait_for_approval(
    run_id: str,
    tool_id: str,
    timeout_seconds: Optional[int] = None,
) -> bool:
    key = make_approval_key(run_id, tool_id)
    loop = asyncio.get_running_loop()
    future: asyncio.Future[bool] = loop.create_future()
    _pending_approvals[key] = future

    timeout = timeout_seconds or settings.approval_timeout_seconds
    logger.info("approval_waiting", run_id=run_id, tool_id=tool_id, timeout=timeout)

    try:
        result = await asyncio.wait_for(future, timeout=timeout)
        return result
    except asyncio.TimeoutError:
        logger.warning("approval_timeout", run_id=run_id, tool_id=tool_id)
        return False
    finally:
        _pending_approvals.pop(key, None)


def resolve_approval(run_id: str, tool_id: str, approved: bool) -> bool:
    key = make_approval_key(run_id, tool_id)
    future = _pending_approvals.get(key)
    if future and not future.done():
        future.set_result(approved)
        logger.info("approval_resolved", run_id=run_id, tool_id=tool_id, approved=approved)
        return True
    return False


def has_pending_approval(run_id: str, tool_id: str) -> bool:
    key = make_approval_key(run_id, tool_id)
    future = _pending_approvals.get(key)
    return future is not None and not future.done()
