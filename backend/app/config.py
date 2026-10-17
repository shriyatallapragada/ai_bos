"""Runtime configuration, read from environment variables (or backend/.env)."""
import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv():
    f = _ROOT / ".env"
    if not f.exists():
        return
    for line in f.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


class Settings:
    # LLM provider: auto | ollama | groq | none   (auto = groq if key set, else ollama if reachable, else rules)
    llm_provider = property(lambda s: os.getenv("LLM_PROVIDER", "auto").lower())
    groq_api_key = property(lambda s: os.getenv("GROQ_API_KEY", ""))
    groq_model = property(lambda s: os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"))
    groq_base_url = property(lambda s: os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1"))
    ollama_model = property(lambda s: os.getenv("OLLAMA_MODEL", "llama3.1:8b"))
    ollama_base_url = property(lambda s: os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"))
    llm_timeout = property(lambda s: float(os.getenv("LLM_TIMEOUT", "90")))
    max_tool_rounds = property(lambda s: int(os.getenv("MAX_TOOL_ROUNDS", "6")))
    db_path = property(lambda s: os.getenv("DB_PATH", str(_ROOT / "data" / "aibos.db")))
    cors_origins = property(lambda s: [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")])


settings = Settings()
