import json
from typing import Any, Optional


class ResultFormatter:
    @staticmethod
    def format_tool_result(
        tool_name: str,
        success: bool,
        content: Any = None,
        error: Optional[str] = None,
        duration_ms: int = 0,
    ) -> str:
        if success:
            content_str = json.dumps(content, default=str) if content else ""
            return (
                f"Executed **{tool_name}** in {duration_ms}ms.\n\n"
                f"**Result:**\n```json\n{content_str[:500]}\n```"
            )
        return f"Tool **{tool_name}** failed: {error or 'Unknown error'}"

    @staticmethod
    def format_tool_content_for_model(
        success: bool,
        content: Any = None,
        error: Optional[str] = None,
    ) -> str:
        if success:
            return json.dumps(content, default=str) if content else ""
        return f"Error: {error or 'Unknown error'}"
