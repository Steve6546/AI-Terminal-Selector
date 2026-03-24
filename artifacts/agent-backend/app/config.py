import os
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    agent_backend_port: int = 9000
    api_server_url: str = "http://localhost:8080"
    admin_secret: str = ""
    secret_encryption_key: str = ""

    anthropic_api_key: str = ""
    anthropic_base_url: str = ""
    openai_api_key: str = ""
    openai_base_url: str = ""

    default_model: str = "claude-sonnet-4-6"
    max_agent_loops: int = 10
    approval_timeout_seconds: int = 300
    summary_threshold: int = 20
    recent_messages_to_keep: int = 8

    log_level: str = "INFO"

    model_config = {"env_prefix": "", "case_sensitive": False}

    @property
    def effective_admin_secret(self) -> str:
        return self.admin_secret or self.secret_encryption_key

    def get_anthropic_config(self) -> dict:
        key = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_API_KEY", self.anthropic_api_key)
        base = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_BASE_URL", self.anthropic_base_url)
        return {"api_key": key, "base_url": base} if key else {}

    def get_openai_config(self) -> dict:
        key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY", self.openai_api_key)
        base = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL", self.openai_base_url)
        return {"api_key": key, "base_url": base} if key else {}


settings = Settings()
