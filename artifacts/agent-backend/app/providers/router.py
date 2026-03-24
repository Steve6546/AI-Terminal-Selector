from typing import Optional, Tuple

import structlog

from ..config import settings
from .base import BaseProvider
from .anthropic_provider import AnthropicProvider
from .openai_provider import OpenAIProvider

logger = structlog.get_logger()

TASK_TYPE_MODEL_MAP = {
    "fast": ["claude-haiku-4-5", "gpt-4o-mini"],
    "reasoning": ["claude-sonnet-4-6", "gpt-4o"],
    "tool_optimized": ["claude-sonnet-4-6", "gpt-4o"],
    "cheap": ["claude-haiku-4-5", "gpt-4o-mini"],
    "general": ["claude-sonnet-4-6", "gpt-4o"],
}


class ProviderRouter:
    def __init__(self):
        self._providers: dict[str, BaseProvider] = {}
        self._init_providers()

    def _init_providers(self):
        anthropic_config = settings.get_anthropic_config()
        if anthropic_config.get("api_key"):
            self._providers["anthropic"] = AnthropicProvider(
                api_key=anthropic_config["api_key"],
                base_url=anthropic_config.get("base_url", "https://api.anthropic.com"),
            )
            logger.info("provider_initialized", provider="anthropic")

        openai_config = settings.get_openai_config()
        if openai_config.get("api_key"):
            self._providers["openai"] = OpenAIProvider(
                api_key=openai_config["api_key"],
                base_url=openai_config.get("base_url", "https://api.openai.com"),
            )
            logger.info("provider_initialized", provider="openai")

    def get_provider_for_model(self, model: str) -> Optional[BaseProvider]:
        if AnthropicProvider.supports_model(model):
            provider = self._providers.get("anthropic")
            if provider and provider.is_available():
                return provider
        if OpenAIProvider.supports_model(model):
            provider = self._providers.get("openai")
            if provider and provider.is_available():
                return provider

        return None

    def select_model_for_task(self, task_type: str = "general") -> Optional[str]:
        candidates = TASK_TYPE_MODEL_MAP.get(task_type, TASK_TYPE_MODEL_MAP["general"])
        for model in candidates:
            provider = self.get_provider_for_model(model)
            if provider:
                return model
        return None

    def get_provider_for_task(self, task_type: str = "general") -> Optional[Tuple[BaseProvider, str]]:
        model = self.select_model_for_task(task_type)
        if not model:
            return None
        provider = self.get_provider_for_model(model)
        if not provider:
            return None
        return (provider, model)

    def get_available_providers(self) -> list[str]:
        return [name for name, p in self._providers.items() if p.is_available()]
