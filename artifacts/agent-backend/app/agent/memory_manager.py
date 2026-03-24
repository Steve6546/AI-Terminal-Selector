from typing import Any, Dict, List, Optional

import structlog

from ..providers.router import ProviderRouter

logger = structlog.get_logger()

SUMMARY_THRESHOLD = 20
RECENT_MESSAGES_TO_KEEP = 8


class MemoryManager:
    def __init__(self, provider_router: ProviderRouter):
        self._router = provider_router

    async def prepare_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if len(messages) <= SUMMARY_THRESHOLD:
            return messages
        return await self._summarize_older(messages)

    async def _summarize_older(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        older = messages[:-RECENT_MESSAGES_TO_KEEP]
        recent = messages[-RECENT_MESSAGES_TO_KEEP:]

        transcript_parts = []
        for m in older:
            role_label = "User" if m.get("role") == "user" else "Assistant"
            content = m.get("content", "")
            if isinstance(content, str):
                text = content[:500]
            elif isinstance(content, list):
                text = " ".join(
                    b.get("text", "")[:200]
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            else:
                text = str(content)[:500]
            transcript_parts.append(f"{role_label}: {text}")

        transcript = "\n\n".join(transcript_parts)

        try:
            provider_info = self._router.get_provider_for_task("fast")
            if not provider_info:
                return messages
            provider, summary_model = provider_info
            result = await provider.complete(
                model=summary_model,
                messages=[{
                    "role": "user",
                    "content": (
                        "Summarize the following conversation history into a concise paragraph "
                        "(max 300 words) that captures the key topics, decisions, and context "
                        f"needed to continue the conversation:\n\n{transcript}\n\nSummary:"
                    ),
                }],
                max_tokens=512,
            )
            if result.text.strip():
                return [
                    {"role": "user", "content": f"[Earlier conversation summary: {result.text.strip()}]"},
                    {"role": "assistant", "content": "Understood, I'll keep that context in mind."},
                    *recent,
                ]
        except Exception as exc:
            logger.warning("summarization_failed", error=str(exc))

        return messages
