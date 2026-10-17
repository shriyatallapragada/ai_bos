"""Thin OpenAI-compatible chat client for open-source LLMs: Ollama (local) or Groq (hosted).

Both expose /chat/completions with tool calling, so one code path serves both.
"""
import time
from typing import Optional

import httpx

from .config import settings


class LLMUnavailable(Exception):
    pass


_cache = {"t": 0.0, "val": None, "key": None}


def _ollama_root():
    return settings.ollama_base_url.rstrip("/").removesuffix("/v1")


def _ollama_models():
    r = httpx.get(_ollama_root() + "/api/tags", timeout=1.5)
    r.raise_for_status()
    return [m["name"] for m in r.json().get("models", [])]


def resolve_provider(force=False) -> Optional[dict]:
    """Pick the provider per LLM_PROVIDER. Cached for 15s so the status endpoint stays cheap."""
    key = (settings.llm_provider, settings.groq_api_key, settings.ollama_model, settings.ollama_base_url)
    if not force and _cache["key"] == key and time.time() - _cache["t"] < 15:
        return _cache["val"]
    want, val = settings.llm_provider, None
    if want in ("auto", "groq") and settings.groq_api_key:
        val = {"name": "groq", "base_url": settings.groq_base_url.rstrip("/"), "model": settings.groq_model,
               "headers": {"Authorization": f"Bearer {settings.groq_api_key}"}}
    elif want in ("auto", "ollama"):
        try:
            models = _ollama_models()
            if models:
                m = settings.ollama_model if settings.ollama_model in models or any(x.startswith(settings.ollama_model) for x in models) else models[0]
                val = {"name": "ollama", "base_url": settings.ollama_base_url.rstrip("/"), "model": m, "headers": {}}
        except Exception:
            val = None
    _cache.update(t=time.time(), val=val, key=key)
    return val


def status() -> dict:
    p = resolve_provider(force=True)
    if not p:
        return {"available": False, "provider": None, "model": None, "setting": settings.llm_provider,
                "hint": "Set GROQ_API_KEY, or run `ollama serve` and `ollama pull llama3.1:8b`. Copilot falls back to the deterministic rules engine."}
    return {"available": True, "provider": p["name"], "model": p["model"], "setting": settings.llm_provider}


def chat(messages, tools=None, temperature=0.1) -> dict:
    p = resolve_provider()
    if not p:
        raise LLMUnavailable("No LLM provider configured or reachable")
    body = {"model": p["model"], "messages": messages, "temperature": temperature}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    try:
        r = httpx.post(p["base_url"] + "/chat/completions", json=body, headers=p["headers"], timeout=settings.llm_timeout)
        if r.status_code >= 400:
            raise LLMUnavailable(f"{p['name']} returned {r.status_code}: {r.text[:300]}")
        return r.json()["choices"][0]["message"]
    except httpx.HTTPError as e:
        _cache["t"] = 0  # re-probe next time
        raise LLMUnavailable(f"{p['name']} request failed: {e}")
