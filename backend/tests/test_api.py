import json

import pytest
from fastapi.testclient import TestClient

from app import copilot, llm
from app.store import Workspace, set_ws


@pytest.fixture()
def client(monkeypatch):
    set_ws(Workspace(":memory:"))
    monkeypatch.setattr(llm, "resolve_provider", lambda force=False: None)  # default: no LLM
    from app.main import app
    return TestClient(app)


def H(role):
    return {"X-Role": role}


def test_seeded_trap_and_demo_numbers(client):
    p = client.get("/api/plan").json()
    c1 = next(i for i in p["items"] if i["id"] == "c1")
    assert c1["metrics"]["stockout_pct"] > 75 and c1["metrics"]["violations"]
    assert p["totals"]["campaigns_breaking_rules"] == 1
    assert any(c["type"] == "Budget overrun" for c in p["conflicts"])


def test_rules_copilot_proposes_and_human_accepts(client):
    r = client.post("/api/copilot/chat", json={"message": "Critique my plan", "mode": "rules"}).json()
    assert r["mode"] == "rules" and r["proposals"]
    prop = r["proposals"][0]
    # AI wrote ONLY to the draft layer
    plan = client.get("/api/plan").json()
    assert next(i for i in plan["items"] if i["id"] == "c1")["disc"] == 25
    assert plan["ghosts"]["ghosts"]
    # partial acceptance: accept the discount cut, reject the rest
    first = prop["changes"][0]
    out = client.post(f"/api/proposals/{prop['id']}/changes/{first['cid']}/accept").json()
    assert out["status"] == "partial" or out["status"] == "pending"
    plan = client.get("/api/plan").json()
    assert next(i for i in plan["items"] if i["id"] == "c1")["disc"] == 16
    client.post(f"/api/proposals/{prop['id']}/reject")
    assert client.get(f"/api/proposals/{prop['id']}").json()["status"] in ("partial", "rejected")
    # undo restores
    client.post("/api/plan/undo")
    assert next(i for i in client.get("/api/plan").json()["items"] if i["id"] == "c1")["disc"] == 25


def test_accept_all_clears_violation_and_edit_before_accept(client):
    r = client.post("/api/copilot/chat", json={"message": "make Diwali Footwear Fest margin-safe", "mode": "rules"}).json()
    prop = r["proposals"][0]
    assert prop["validation"]["rule_violations_after"] == 0
    c = prop["changes"][0]
    client.post(f"/api/proposals/{prop['id']}/changes/{c['cid']}/accept", json={"patch": {"disc": 17}})
    assert next(i for i in client.get("/api/plan").json()["items"] if i["id"] == "c1")["disc"] == 17
    client.post(f"/api/proposals/{prop['id']}/accept")
    plan = client.get("/api/plan").json()
    assert plan["totals"]["campaigns_breaking_rules"] == 0


def test_rbac_readonly_and_abac(client):
    r = client.post("/api/copilot/chat", json={"message": "fix c1", "mode": "rules"}).json()
    pid = r["proposals"][0]["id"]
    assert client.post(f"/api/proposals/{pid}/accept", headers=H("exec")).status_code == 403
    store = client.get("/api/plan", headers=H("store")).json()
    assert {i["region"] for i in store["items"]} == {"TS"}
    assert client.get("/api/segments", headers=H("store")).status_code == 403
    assert client.get("/api/simulation/c6", headers=H("store")).status_code == 403
    assert client.get("/api/plan", headers={"X-Role": "nope"}).status_code == 400


def test_brief_parsing_and_infeasible(client):
    r = client.post("/api/copilot/chat", json={"message": "₹2L, clear aging jackets in Delhi before Diwali, margin ≥ 22%", "mode": "rules"}).json()
    assert r["proposals"], r["reply"]
    assert r["proposals"][0]["changes"][0]["type"] in ("create", "update")
    r = client.post("/api/copilot/chat", json={"message": "plan ₹1L clear footwear in Telangana before diwali margin >= 80", "mode": "rules"}).json()
    assert "No feasible" in r["reply"] or r["proposals"] == []


def test_whatif_and_split_and_move_and_copy(client):
    for msg in ("Budget ₹10L → ₹6L?", "split budget 60/40 between Telangana and Karnataka", "move the beauty campaign a week earlier", "Why 16%?", "draft whatsapp copy premium for footwear"):
        r = client.post("/api/copilot/chat", json={"message": msg, "mode": "rules"})
        assert r.status_code == 200 and r.json()["reply"], msg


def test_simulation_lab(client):
    lab = client.get("/api/simulation/c1?runs=500").json()
    assert lab["probabilities"]["stockout_pct"] > 25
    assert lab["distribution"]["p10"] < lab["distribution"]["p50"] < lab["distribution"]["p90"]
    assert lab["red_team"]["resilience_score"] <= 100 and len(lab["agent_room"]["agents"]) == 7
    assert lab["confidence"]["recommendation"]["action"] == "do_not_proceed"
    cr = client.post("/api/simulation/c1/crisis").json()
    assert "delayed" in cr["crisis"]


def test_approval_chain_separation_of_duties(client):
    v = client.get("/api/approvals/c3").json()
    assert v["next_step"] == "Merchandising"
    assert client.post("/api/approvals/c3/approve", headers=H("supply")).status_code == 400   # wrong role
    assert client.post("/api/approvals/c3/approve", headers=H("merch")).status_code == 200
    # violating campaign cannot enter review without override
    assert client.post("/api/approvals/c1/submit").status_code == 400
    assert client.post("/api/approvals/c1/override", json={"reason": "x"}).status_code == 400
    assert client.post("/api/approvals/c1/override", json={"reason": "Exec waiver for pilot"}).status_code == 200
    assert client.post("/api/approvals/c1/submit").status_code == 200
    # creator cannot publish
    assert client.post("/api/approvals/c4/go-live", headers=H("marketing")).status_code == 400
    assert client.post("/api/approvals/c4/go-live", headers=H("admin")).status_code == 200


def test_warroom_flow(client):
    for _ in range(4):
        w = client.post("/api/warroom/step").json()
    assert w["alert"] and w["alert"]["proposed_intervention"]["requires_human_approval"]
    sim = client.post("/api/warroom/transfer/simulate").json()
    assert sim["after"]["days_of_stock_left"] > sim["before"]["days_of_stock_left"]
    assert client.post("/api/warroom/transfer/approve").status_code == 200
    assert client.get("/api/warroom").json()["alert"] is None


def test_governance_block_with_alternative_and_audit(client):
    t = client.post("/api/governance/test", json={"cat": "FW", "disc": 40}).json()
    assert not t["allowed"] and t["feasible_alternative"]
    client.put("/api/governance", json={"marginFloor": 30})
    assert client.get("/api/plan").json()["totals"]["campaigns_breaking_rules"] >= 1
    client.put("/api/governance", json={"tier": 1})
    assert any(i["metrics"]["violations"] for i in client.get("/api/plan").json()["items"] if i["aud"] != "all")
    log = client.get("/api/audit").json()["events"]
    assert any(e["action"] == "Guardrail changed" for e in log)


def test_patch_drag_recomputes_and_locks_approved(client):
    r = client.patch("/api/plan/items/c1", json={"start": 31})
    assert r.status_code == 200 and r.json()["start"] == 31
    assert client.patch("/api/plan/items/c4", json={"start": 30}).status_code == 400   # Approved is locked


def test_control_and_exec_brief(client):
    c = client.get("/api/control").json()
    assert c["morning_brief"]["decisions_needed"]
    assert "stockout" in client.get("/api/control/executive-brief").json()["main_risk"]


def test_creative_guardrails(client):
    assert not client.post("/api/creative/check", json={"text": "Guaranteed lowest price ever! Only 3 left", "item_id": "c1"}).json()["ok"]
    assert client.post("/api/creative/draft", json={"item_id": "c1", "tone": "hindi"}).json()["copy"]["headline"]


# ------------------------------------------------------------- LLM tool-calling loop (mocked OpenAI-compatible server)
def _tc(name, args, i="1"):
    return {"id": i, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def test_llm_tool_loop_only_drafts_and_flags_invented_numbers(client, monkeypatch):
    monkeypatch.setattr(llm, "resolve_provider", lambda force=False: {"name": "ollama", "model": "mock", "base_url": "", "headers": {}})
    script = iter([
        {"content": "", "tool_calls": [_tc("get_plan", {})]},
        {"content": "", "tool_calls": [_tc("propose_fix", {"item_id": "c1"}, "2"), _tc("accept_everything", {}, "3")]},   # hallucinated tool
        {"content": "Diwali Footwear Fest has 81% stockout risk. Fix drafted. I guarantee a 93% win rate."},
    ])
    seen = []

    def fake_chat(messages, tools=None, temperature=0.1):
        seen.append(messages[-1])
        return next(script)
    monkeypatch.setattr(llm, "chat", fake_chat)
    r = client.post("/api/copilot/chat", json={"message": "critique my plan"}).json()
    assert r["mode"] == "llm" and r["provider"]["name"] == "ollama"
    assert [c["name"] for c in r["tool_calls"]] == ["get_plan", "propose_fix", "accept_everything"]
    assert r["tool_calls"][2]["ok"] is False                      # no accept tool exists
    assert r["proposals"] and r["proposals"][0]["status"] == "pending"
    assert next(i for i in client.get("/api/plan").json()["items"] if i["id"] == "c1")["disc"] == 25   # live plan untouched
    assert "93%" in r["grounding"]["ungrounded_numbers"] and "81%" not in r["grounding"]["ungrounded_numbers"]
    assert r["warnings"]


def test_llm_failure_falls_back_to_rules(client, monkeypatch):
    monkeypatch.setattr(llm, "resolve_provider", lambda force=False: {"name": "groq", "model": "m", "base_url": "", "headers": {}})

    def boom(*a, **k):
        raise llm.LLMUnavailable("down")
    monkeypatch.setattr(llm, "chat", boom)
    r = client.post("/api/copilot/chat", json={"message": "critique my plan"}).json()
    assert r["mode"] == "rules" and r["proposals"] and r["warnings"]


def test_llm_role_scope_enforced_in_tools(client, monkeypatch):
    monkeypatch.setattr(llm, "resolve_provider", lambda force=False: {"name": "ollama", "model": "mock", "base_url": "", "headers": {}})
    script = iter([{"content": "", "tool_calls": [_tc("propose_fix", {"item_id": "c6"})]}, {"content": "done"}])
    monkeypatch.setattr(llm, "chat", lambda *a, **k: next(script))
    r = client.post("/api/copilot/chat", json={"message": "fix c6"}, headers=H("store")).json()
    assert r["tool_calls"][0]["ok"] is False and "region scope" in r["tool_calls"][0]["error"]
    assert r["proposals"] == []
