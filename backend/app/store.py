"""Workspace state: one JSON document persisted in SQLite, plus an append-only audit table."""
import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager

from .config import settings
from .data import clone, initial_state


class Workspace:
    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL)")
        self.db.execute("""CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, who TEXT NOT NULL, action TEXT NOT NULL,
            detail TEXT NOT NULL, src TEXT NOT NULL, model TEXT, data_version TEXT)""")
        self.db.commit()
        row = self.db.execute("SELECT doc FROM state WHERE id = 1").fetchone()
        self.st = json.loads(row[0]) if row else initial_state()
        if not row:
            self.save()
            self.audit("System", "Plan loaded", "Diwali 2026 plan v1 · synthetic data · model v0.3")

    def save(self):
        with self.lock:
            self.db.execute("INSERT INTO state (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc",
                            (json.dumps(self.st),))
            self.db.commit()

    @contextmanager
    def mutate(self):
        """Hold the lock, yield state, persist afterwards."""
        with self.lock:
            yield self.st
            self.save()

    def audit(self, who, action, detail="", src="human", model=None):
        with self.lock:
            self.db.execute("INSERT INTO audit (ts, who, action, detail, src, model, data_version) VALUES (?,?,?,?,?,?,?)",
                            (time.time(), who, action, detail, src, model, self.st.get("model_version", "v0.3")))
            self.db.commit()

    def audit_log(self, limit=200):
        with self.lock:
            rows = self.db.execute("SELECT ts, who, action, detail, src, model, data_version FROM audit ORDER BY id DESC LIMIT ?",
                                   (limit,)).fetchall()
        return [{"ts": r[0], "who": r[1], "action": r[2], "detail": r[3], "src": r[4], "model": r[5], "data_version": r[6]} for r in rows]

    def reset(self):
        with self.lock:
            self.st = initial_state()
            self.db.execute("DELETE FROM audit")
            self.save()
            self.audit("System", "Demo reset", "State reset to seeded scenario")

    def nid(self, prefix):
        self.st["seq"] += 1
        return f"{prefix}{self.st['seq']}"

    def push_undo(self):
        self.st["undo"].append(clone(self.st["plan"]))
        if len(self.st["undo"]) > 60:
            self.st["undo"].pop(0)
        self.st["redo"] = []


_ws = None


def get_ws() -> Workspace:
    global _ws
    if _ws is None:
        _ws = Workspace(settings.db_path)
    return _ws


def set_ws(ws):
    global _ws
    _ws = ws
