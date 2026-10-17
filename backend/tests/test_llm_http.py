"""Exercise the real HTTP path of llm.py against a fake Ollama/OpenAI-compatible server."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from app import llm


class Fake(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *a):
        pass

    def _send(self, obj):
        b = json.dumps(obj).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        self._send({"models": [{"name": "llama3.1:8b"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Fake.calls.append(body)
        if any(m["role"] == "tool" for m in body["messages"]):
            msg = {"role": "assistant", "content": "Diwali Footwear Fest is at risk."}
        else:
            msg = {"role": "assistant", "content": "", "tool_calls": [{"id": "a", "type": "function", "function": {"name": "get_plan", "arguments": "{}"}}]}
        self._send({"choices": [{"message": msg}]})


def test_ollama_http_roundtrip(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("OLLAMA_BASE_URL", f"http://127.0.0.1:{srv.server_port}/v1")
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    llm._cache["key"] = None
    from app.store import Workspace, set_ws
    set_ws(Workspace(":memory:"))
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    assert c.get("/api/llm").json() == {"available": True, "provider": "ollama", "model": "llama3.1:8b", "setting": "ollama"}
    r = c.post("/api/copilot/chat", json={"message": "how is my plan?"}).json()
    srv.shutdown()
    assert r["mode"] == "llm" and r["tool_calls"][0]["name"] == "get_plan" and "at risk" in r["reply"]
    assert Fake.calls[0]["tools"] and Fake.calls[0]["model"] == "llama3.1:8b"
    llm._cache["key"] = None
