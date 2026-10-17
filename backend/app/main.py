"""RetailVerse / AI BOS backend: FastAPI app. Run: uvicorn app.main:app --reload --port 8000"""
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import copilot, llm, ops, services as S
from .config import settings
from .data import (AUD, CATS, EVENTS, MECH, PROFILES, REGIONS, ROLES, SEASONS, STATUSES, clone)
from .models import plan_totals
from .store import get_ws

app = FastAPI(title="RetailVerse AI · Decision Twin API", version="0.1.0",
              description="Deterministic simulation/optimizer services + an open-source-LLM (Ollama/Groq) copilot with human-in-the-loop change sets.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(S.ToolError)
async def tool_error_handler(_: Request, e: S.ToolError):
    return JSONResponse(status_code=400, content={"detail": str(e)})


# ----------------------------------------------------------------- auth: role from header (demo RBAC/ABAC)
class Actor:
    def __init__(self, key):
        if key not in ROLES:
            raise HTTPException(400, f"Unknown role '{key}'. Use one of {list(ROLES)}")
        self.key, self.cfg = key, ROLES[key]
        self.name = self.cfg["n"]

    def require_edit(self):
        if not self.cfg["edit"]:
            raise HTTPException(403, f"{self.name} is read-only. Ask a planner to make this change.")

    def scope_item(self, item):
        if self.cfg.get("region") and item["region"] != self.cfg["region"]:
            raise HTTPException(403, "Outside your region scope (ABAC).")


def actor(x_role: str = Header("marketing")) -> Actor:
    return Actor(x_role)


# ----------------------------------------------------------------- schemas
class ItemIn(BaseModel):
    name: str
    region: str
    cat: str
    start: int = Field(ge=0, le=62)
    len: int = Field(ge=1, le=63)
    disc: int = Field(ge=0, le=90)
    aud: str = "all"
    budget: int = Field(ge=0)
    mech: str = "% off"
    excl: bool = False


class ItemPatch(BaseModel):
    name: Optional[str] = None
    start: Optional[int] = Field(None, ge=0, le=62)
    len: Optional[int] = Field(None, ge=1, le=63)
    disc: Optional[int] = Field(None, ge=0, le=90)
    aud: Optional[str] = None
    budget: Optional[int] = Field(None, ge=0)
    mech: Optional[str] = None
    excl: Optional[bool] = None
    region: Optional[str] = None
    cat: Optional[str] = None


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    selected_id: Optional[str] = None
    mode: str = "auto"  # auto | llm | rules


class DecideIn(BaseModel):
    patch: Optional[Dict[str, Any]] = None   # "edit" before accepting


class SimIn(BaseModel):
    item_id: Optional[str] = None
    overrides: Dict[str, Any] = {}
    demand_mult: float = 1.0
    lift_mult: float = 1.0
    stock_mult: float = 1.0


class OptIn(BaseModel):
    item_id: str
    margin_floor: Optional[float] = None
    max_stockout_pct: Optional[float] = None


class StressIn(BaseModel):
    demand: Optional[bool] = None
    supplier: Optional[bool] = None
    competitor: Optional[bool] = None


class ReasonIn(BaseModel):
    reason: str


class ReadyIn(BaseModel):
    key: str
    done: bool


class GovIn(BaseModel):
    marginFloor: Optional[float] = None
    budgetCap: Optional[float] = None
    stockoutMax: Optional[float] = None
    contactCap: Optional[int] = None
    discountCap: Optional[Dict[str, int]] = None
    tier: Optional[int] = None
    profile: Optional[str] = None
    season: Optional[str] = None


class GovTestIn(BaseModel):
    cat: str = "FW"
    disc: int = 40
    region: str = "TS"


class CopyIn(BaseModel):
    item_id: str
    tone: str = "standard"


class CheckCopyIn(BaseModel):
    text: str
    item_id: Optional[str] = None


# ----------------------------------------------------------------- meta / health
@app.get("/api/health")
def health():
    return {"ok": True, "llm": llm.status()}


@app.get("/api/llm")
def llm_status():
    return llm.status()


@app.get("/api/meta")
def meta():
    return {"categories": CATS, "regions": REGIONS, "audiences": AUD, "mechanics": MECH, "statuses": STATUSES, "events": EVENTS, "profiles": PROFILES,
            "seasons": SEASONS, "roles": ROLES, "disclaimer": "All data is synthetic, counterfactuals are estimates and root causes are hypotheses."}


@app.post("/api/reset")
def reset(a: Actor = Depends(actor)):
    a.require_edit()
    get_ws().reset()
    return {"ok": True}


# ----------------------------------------------------------------- plan (M2)
@app.get("/api/plan")
def plan(a: Actor = Depends(actor)):
    ws = get_ws()
    with ws.lock:
        v = S.plan_view(ws.st, a.cfg)
        v["ghosts"] = S.pending_ghosts(ws.st)
        v["can_undo"], v["can_redo"] = bool(ws.st["undo"]), bool(ws.st["redo"])
        return v


@app.post("/api/plan/items")
def create_item(body: ItemIn, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate() as st:
        d = body.model_dump()
        d["region"], d["cat"] = S.norm_region(d["region"]), S.norm_cat(d["cat"])
        if d["aud"] not in AUD or d["mech"] not in MECH:
            raise S.ToolError(f"aud must be one of {list(AUD)}; mech one of {MECH}")
        if d["start"] + d["len"] > 63:
            raise S.ToolError("Campaign must end within the 9-week window")
        d.update(id=ws.nid("c"), status="Draft")
        a.scope_item(d)
        ws.push_undo()
        st["plan"]["items"].append(d)
        ws.audit(a.name, "Created campaign", d["name"])
    return S.plan_view(st, a.cfg)["items"][-1]


@app.patch("/api/plan/items/{item_id}")
def patch_item(item_id: str, body: ItemPatch, a: Actor = Depends(actor)):
    """Drag / resize / edit a card. Returns the live recomputed metrics (constraints rerun instantly)."""
    a.require_edit()
    ws = get_ws()
    with ws.mutate() as st:
        it = S.get_item(st, item_id)
        a.scope_item(it)
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        if "region" in patch:
            patch["region"] = S.norm_region(patch["region"])
        if "cat" in patch:
            patch["cat"] = S.norm_cat(patch["cat"])
        if patch.get("aud", "all") not in AUD or patch.get("mech", MECH[0]) not in MECH:
            raise S.ToolError("Invalid aud or mech")
        if it["status"] in ("Approved", "Live"):
            raise S.ToolError(f"{it['name']} is {it['status']}; send it back to Draft before editing.")
        new = {**it, **patch}
        if new["start"] + new["len"] > 63:
            raise S.ToolError("Campaign must end within the 9-week window")
        ws.push_undo()
        it.update(patch)
        ws.audit(a.name, "Edited campaign", f"{it['name']}: " + ", ".join(f"{k}={v}" for k, v in patch.items()))
    return next(i for i in S.plan_view(st, a.cfg)["items"] if i["id"] == item_id)


@app.delete("/api/plan/items/{item_id}")
def delete_item(item_id: str, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate() as st:
        it = S.get_item(st, item_id)
        a.scope_item(it)
        ws.push_undo()
        st["plan"]["items"] = [i for i in st["plan"]["items"] if i["id"] != item_id]
        ws.audit(a.name, "Deleted campaign", it["name"])
    return {"ok": True}


@app.post("/api/plan/undo")
def undo(a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate() as st:
        if not st["undo"]:
            raise S.ToolError("Nothing to undo")
        st["redo"].append(clone(st["plan"]))
        st["plan"] = st["undo"].pop()
        ws.audit(a.name, "Undo", "Reverted last change")
    return S.plan_view(st, a.cfg)


@app.post("/api/plan/redo")
def redo(a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate() as st:
        if not st["redo"]:
            raise S.ToolError("Nothing to redo")
        st["undo"].append(clone(st["plan"]))
        st["plan"] = st["redo"].pop()
        ws.audit(a.name, "Redo", "")
    return S.plan_view(st, a.cfg)


@app.get("/api/audit")
def audit_log(limit: int = 200, a: Actor = Depends(actor)):
    return {"events": get_ws().audit_log(limit)}


# ----------------------------------------------------------------- data & tools as plain endpoints (M1, tool layer)
@app.get("/api/forecast")
def forecast(region: str, cat: str, start: Optional[int] = None, days: int = 14, a: Actor = Depends(actor)):
    if a.cfg.get("region") and S.norm_region(region) != a.cfg["region"]:
        raise HTTPException(403, "Outside your region scope (ABAC).")
    return S.get_forecast(get_ws().st, region, cat, start, days)


@app.get("/api/inventory")
def inventory(region: Optional[str] = None, cat: Optional[str] = None, a: Actor = Depends(actor)):
    return S.get_inventory(get_ws().st, region or a.cfg.get("region"), cat)


@app.get("/api/segments")
def segments(a: Actor = Depends(actor)):
    if a.cfg.get("noCustomer"):
        raise HTTPException(403, "Store Managers see the local view without customer-level data.")
    return S.get_segments(get_ws().st)


@app.get("/api/market-pulse")
def market_pulse():
    st = get_ws().st
    return {"events": [{"day": e["d"], "name": e["n"], "date": S.ds(e["d"])} for e in EVENTS], "season": SEASONS[st["season"]]["n"], "days_to_diwali": 41 - 2}


@app.post("/api/simulate")
def simulate(body: SimIn, a: Actor = Depends(actor)):
    st = get_ws().st
    if body.item_id:
        a.scope_item(S.get_item(st, body.item_id))
    return S.simulate_item(st, body.item_id, body.overrides, body.demand_mult, body.lift_mult, body.stock_mult)


@app.post("/api/optimize")
def optimize_ep(body: OptIn, a: Actor = Depends(actor)):
    st = get_ws().st
    a.scope_item(S.get_item(st, body.item_id))
    return S.optimize_item(st, body.item_id, body.margin_floor, body.max_stockout_pct)


@app.get("/api/constraints")
def constraints(item_id: Optional[str] = None):
    return S.check_constraints(get_ws().st, item_id)


@app.get("/api/conflicts")
def conflicts_ep():
    return S.find_conflicts(get_ws().st)


@app.get("/api/transfers/suggest")
def transfer(item_id: str, a: Actor = Depends(actor)):
    st = get_ws().st
    a.scope_item(S.get_item(st, item_id))
    return S.suggest_transfer(st, item_id)


@app.get("/api/explain/discount")
def explain(item_id: str, levels: Optional[str] = None, a: Actor = Depends(actor)):
    st = get_ws().st
    a.scope_item(S.get_item(st, item_id))
    return S.explain_discount(st, item_id, [int(x) for x in levels.split(",")] if levels else None)


# ----------------------------------------------------------------- copilot + draft layer (HITL)
@app.post("/api/copilot/chat")
def copilot_chat(body: ChatIn, a: Actor = Depends(actor)):
    ws = get_ws()
    with ws.lock:
        return copilot.chat(ws, body.message, a.key, a.cfg, body.selected_id, body.mode)


@app.get("/api/copilot/history")
def copilot_history():
    return {"messages": get_ws().st["chat"]}


@app.get("/api/proposals")
def proposals(status: Optional[str] = None):
    ps = list(get_ws().st["proposals"].values())
    return {"proposals": [p for p in ps if not status or p["status"] == status]}


@app.get("/api/proposals/{pid}")
def proposal(pid: str):
    p = get_ws().st["proposals"].get(pid)
    if not p:
        raise HTTPException(404, "Unknown proposal")
    return p


@app.post("/api/proposals/{pid}/changes/{cid}/accept")
def accept_change(pid: str, cid: str, body: DecideIn = DecideIn(), a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        return S.decide_change(ws, pid, cid, True, a.name, body.patch)


@app.post("/api/proposals/{pid}/changes/{cid}/reject")
def reject_change(pid: str, cid: str, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        return S.decide_change(ws, pid, cid, False, a.name)


@app.post("/api/proposals/{pid}/accept")
def accept_all(pid: str, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        return S.decide_all(ws, pid, True, a.name)


@app.post("/api/proposals/{pid}/reject")
def reject_all(pid: str, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        return S.decide_all(ws, pid, False, a.name)


# ----------------------------------------------------------------- simulation lab (M4)
@app.get("/api/simulation/{item_id}")
def sim_lab(item_id: str, runs: int = 2000, a: Actor = Depends(actor)):
    ws = get_ws()
    a.scope_item(S.get_item(ws.st, item_id))
    with ws.lock:
        return ops.simulation_lab(ws, item_id, n=max(200, min(runs, 10000)))


@app.put("/api/simulation/stress")
def set_stress(body: StressIn):
    ws = get_ws()
    with ws.mutate() as st:
        for k, v in body.model_dump().items():
            if v is not None:
                st["stress"][k] = v
    return {"stress": ws.st["stress"]}


@app.post("/api/simulation/{item_id}/crisis")
def crisis(item_id: str, a: Actor = Depends(actor)):
    ws = get_ws()
    with ws.mutate():
        c = ops.inject_crisis(ws, item_id, a.name)
    return {"crisis": c, "lab": ops.simulation_lab(ws, item_id)}


@app.delete("/api/simulation/crisis")
def clear_crisis():
    ws = get_ws()
    with ws.mutate() as st:
        st["crisis"] = None; st["stress"] = {}
    return {"ok": True}


# ----------------------------------------------------------------- readiness & approval (M5)
@app.get("/api/approvals")
def approvals():
    ws = get_ws()
    with ws.lock:
        return {"campaigns": [ops.readiness_view(ws, i["id"]) for i in ws.st["plan"]["items"] if i["status"] != "Draft"], "chain": PROFILES[ws.st["profile"]]["chain"]}


@app.get("/api/approvals/{item_id}")
def approval_one(item_id: str):
    return ops.readiness_view(get_ws(), item_id)


@app.patch("/api/approvals/{item_id}/readiness")
def set_readiness(item_id: str, body: ReadyIn, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        ops.toggle_readiness(ws, item_id, body.key, body.done, a.name)
    return ops.readiness_view(ws, item_id)


@app.post("/api/approvals/{item_id}/submit")
def submit_review(item_id: str, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        ops.send_to_review(ws, item_id, a.name)
    return ops.readiness_view(ws, item_id)


@app.post("/api/approvals/{item_id}/override")
def override(item_id: str, body: ReasonIn, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        ops.set_override(ws, item_id, body.reason, a.name)
    return ops.readiness_view(ws, item_id)


@app.post("/api/approvals/{item_id}/approve")
def approve(item_id: str, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        return ops.approve(ws, item_id, a.key)


@app.post("/api/approvals/{item_id}/reject")
def reject_appr(item_id: str, body: ReasonIn, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        ops.reject_approval(ws, item_id, body.reason, a.name)
    return {"ok": True}


@app.post("/api/approvals/{item_id}/go-live")
def go_live(item_id: str, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        ops.go_live(ws, item_id, a.key)
    return ops.readiness_view(ws, item_id)


@app.post("/api/creative/draft")
def creative_draft(body: CopyIn, a: Actor = Depends(actor)):
    it = S.get_item(get_ws().st, body.item_id)
    a.scope_item(it)
    return S.draft_copy(get_ws().st, body.item_id, body.tone)


@app.post("/api/creative/check")
def creative_check(body: CheckCopyIn):
    st = get_ws().st
    return S.check_copy(body.text, S.get_item(st, body.item_id) if body.item_id else None)


# ----------------------------------------------------------------- war room & learning (M6)
@app.get("/api/warroom")
def war():
    return ops.war_view(get_ws())


@app.post("/api/warroom/step")
def war_step():
    ws = get_ws()
    with ws.mutate():
        return ops.war_step(ws)


@app.post("/api/warroom/transfer/simulate")
def war_sim():
    return ops.war_simulate_transfer(get_ws())


@app.post("/api/warroom/transfer/approve")
def war_approve(a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        return ops.war_approve_transfer(ws, a.name)


@app.post("/api/warroom/reset")
def war_reset():
    ws = get_ws()
    with ws.mutate():
        ops.war_reset(ws)
    return ops.war_view(ws)


@app.get("/api/learning")
def learning():
    return ops.learning_view(get_ws())


@app.post("/api/learning/guardrail")
def learning_guardrail(a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        ops.add_learning_guardrail(ws, a.name)
    return ops.learning_view(ws)


# ----------------------------------------------------------------- governance
@app.get("/api/governance")
def governance():
    return ops.governance_view(get_ws())


@app.put("/api/governance")
def governance_update(body: GovIn, a: Actor = Depends(actor)):
    a.require_edit()
    ws = get_ws()
    with ws.mutate():
        return ops.update_governance(ws, a.name, body.model_dump(exclude_none=True))


@app.post("/api/governance/test")
def governance_test(body: GovTestIn, a: Actor = Depends(actor)):
    ws = get_ws()
    with ws.mutate():
        return ops.guardrail_test(ws, a.name, body.cat, body.disc, body.region)


# ----------------------------------------------------------------- control tower (M7)
@app.get("/api/control")
def control(a: Actor = Depends(actor)):
    return ops.control_tower(get_ws(), a.cfg)


@app.get("/api/control/executive-brief")
def exec_brief():
    return ops.executive_brief(get_ws())


# Optionally serve the existing static frontend from the repo root at "/".
_ROOT = Path(__file__).resolve().parents[2]
if (_ROOT / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(_ROOT), html=True), name="frontend")
