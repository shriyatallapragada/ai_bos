"""AI Copilot: an LLM (Ollama/Groq) that does language only and calls deterministic tools for every number.

Contract (PDF §2, §M2):
  * The LLM never invents numbers: every figure comes from a tool result; a grounding check flags the rest.
  * Propose-tools write only to the draft layer. There is no tool to accept, approve or publish.
  * If no LLM is reachable (or it fails), a deterministic intent router drives the same tools.
"""
import json
import re

from . import llm, services as S
from .data import AUD, CATS, MECH, REGIONS, clone
from .models import inr
from .services import ToolError

SYSTEM_PROMPT = """You are the planning copilot inside a retail promotion planning canvas (synthetic data, Indian retailer, Diwali 2026).
You do LANGUAGE only: understand the user's request, call tools, and explain results in plain English.

HARD RULES
1. Never invent or estimate numbers. Every figure (stockout %, margin %, units, rupees, dates) must come from a tool result in this conversation. If you lack a number, call a tool.
2. You can only DRAFT. propose_* tools create proposals that a human must accept; you cannot accept, approve, publish or change the live plan. Say that proposals await the user's accept / edit / reject.
3. Always call a tool before answering anything about the plan. Start with get_plan if you do not know campaign ids. Campaign ids look like c1..c9.
4. Relay constraint violations honestly. Never describe a plan with violations as fine.
5. State evidence strength (strong / moderate / weak) from the proposal and recommend 'pilot' or 'experiment' when evidence is not strong.
6. Be concise: a short summary, then bullets of the proposed changes with before/after numbers from the tools. Use rupee shorthand like ₹2.5L.

TOOL GUIDE
- 'critique my plan' -> get_plan, then propose_fix on the worst campaign (see totals.worst_stockout and violations).
- 'make X margin-safe / fix X' -> propose_fix(item_id).
- a brief like '₹10L, clear footwear in Telangana before Diwali, margin >= 22%' -> propose_from_brief.
- 'week 3 has no activity / fill gaps / aging stock' -> propose_gap_fill.
- 'move X a week earlier' -> propose_reschedule (days negative = earlier).
- 'split budget 60/40 between A and B' -> propose_budget_split. 'budget 10L to 6L?' -> propose_budget_whatif.
- 'why 16%?' -> explain_discount.  'write copy' -> draft_copy.  'set discount to 18%' -> propose_edit.
Regions: TS Telangana/Hyderabad, KA Karnataka/Bengaluru, MH Maharashtra/Pune, DL Delhi NCR. Categories: FW footwear, AP apparel, BT beauty, EL electronics, GR grocery."""


def _t(name, desc, props=None, req=None):
    return {"type": "function", "function": {"name": name, "description": desc,
                                              "parameters": {"type": "object", "properties": props or {}, "required": req or []}}}


_ITEM = {"item_id": {"type": "string", "description": "Campaign id such as c1"}}
_REG = {"type": "string", "description": "TS, KA, MH, DL or a city/state name"}
_CAT = {"type": "string", "description": "FW, AP, BT, EL, GR or a category name"}

TOOL_SCHEMAS = [
    _t("get_plan", "All campaigns with simulated metrics (stockout %, margin %, violations), plan totals and conflicts."),
    _t("get_forecast", "Demand forecast with 80% interval for a region and category.", {"region": _REG, "category": _CAT, "start_day": {"type": "integer"}, "days": {"type": "integer"}}, ["region", "category"]),
    _t("get_inventory", "Available / in-transit stock, days of supply and inventory confidence.", {"region": _REG, "category": _CAT}),
    _t("get_segments", "Customer micro-segments and which are available at the current data tier."),
    _t("simulate", "Simulate a campaign, optionally with overrides, returning ranges and violations.",
       {**_ITEM, "overrides": {"type": "object", "description": "Any of disc (int %), aud (all|uplift|loyal|lapsed), budget (INR), start (day index), len (days), mech, excl (bool)"},
        "demand_mult": {"type": "number"}, "stock_mult": {"type": "number"}}, ["item_id"]),
    _t("check_constraints", "Check hard rules (margin floor, stockout limit, discount cap, data tier). Omit item_id for the whole plan.", _ITEM),
    _t("find_conflicts", "Find same-SKU overlap, over-contact and budget overrun."),
    _t("suggest_transfer", "Inventory transfer needed for a campaign and the best donor region.", _ITEM, ["item_id"]),
    _t("optimize", "Search audience x scope x discount depth for the best feasible config under guardrails.",
       {**_ITEM, "margin_floor": {"type": "number"}, "max_stockout_pct": {"type": "number"}}, ["item_id"]),
    _t("explain_discount", "Compare discount levels side by side (why 16%? why not 20%?).", {**_ITEM, "levels": {"type": "array", "items": {"type": "integer"}}}, ["item_id"]),
    _t("propose_fix", "DRAFT a validated change set (discount, audience, SKU scope, budget, stock transfer, merge) to make a campaign feasible.", _ITEM, ["item_id"]),
    _t("propose_from_brief", "DRAFT a new campaign from a natural-language brief's parsed fields.",
       {"budget_inr": {"type": "number"}, "region": _REG, "category": _CAT, "margin_floor_pct": {"type": "number"},
        "goal": {"type": "string", "enum": ["clear", "revenue"]}, "before_diwali": {"type": "boolean"}}, ["region", "category"]),
    _t("propose_gap_fill", "DRAFT a clearance campaign for the biggest idle-stock gap."),
    _t("propose_reschedule", "DRAFT moving a campaign by N days (negative = earlier).", {**_ITEM, "days": {"type": "integer"}}, ["item_id", "days"]),
    _t("propose_budget_split", "DRAFT a budget split between two regions.", {"region_a": _REG, "region_b": _REG, "share_a_pct": {"type": "number"}}, ["region_a", "region_b", "share_a_pct"]),
    _t("propose_budget_whatif", "DRAFT trimming plan budget to a new total, with trade-offs.", {"target_budget_inr": {"type": "number"}}, ["target_budget_inr"]),
    _t("propose_edit", "DRAFT a direct edit of campaign fields (validated).", {**_ITEM, "changes": {"type": "object", "description": "disc, aud, budget, start, len, mech, excl"}}, ["item_id", "changes"]),
    _t("draft_copy", "Text-only creative with guardrail checks. tone: standard|premium|hindi|telugu.", {**_ITEM, "tone": {"type": "string"}}, ["item_id"]),
    _t("check_copy", "Check marketing text against forbidden terms, fake urgency, disclaimers.", {"text": {"type": "string"}, "item_id": {"type": "string"}}, ["text"]),
]


# ----------------------------------------------------------------- tool dispatch
def summarize_proposal(p):
    return {"proposal_id": p["id"], "title": p["title"], "evidence": p["evidence"], "recommendation": p["recommendation"], "validation": p["validation"],
            "set_diff": p["set_diff"], "changes": [{"change_id": c["cid"], "label": c["label"], "why": c["why"], "diff": c["diff"]} for c in p["changes"]],
            "status": "DRAFT: awaiting human accept / edit / reject"}


def _strip(o):
    """Compact plan view for the LLM context window."""
    return o


class Dispatcher:
    def __init__(self, ws, role_key, role_cfg, selected_id=None, user_text=""):
        self.user_text = user_text
        self.ws, self.st, self.role_key, self.role_cfg, self.selected = ws, ws.st, role_key, role_cfg or {}, selected_id
        self.proposal_ids = []

    def _guard_item(self, item_id):
        it = S.get_item(self.st, item_id)
        if self.role_cfg.get("region") and it["region"] != self.role_cfg["region"]:
            raise ToolError("Outside your region scope (ABAC).")
        return it

    def _guard_region(self, r):
        if self.role_cfg.get("region") and r and S.norm_region(r) != self.role_cfg["region"]:
            raise ToolError("Outside your region scope (ABAC).")

    def _prop(self, res):
        p = res.get("proposal")
        if p:
            self.proposal_ids.append(p["id"])
            res = {**res, "proposal": summarize_proposal(p)}
        return res

    def call(self, name, a):
        st, ws = self.st, self.ws
        a = a or {}
        if name == "get_plan":
            v = S.plan_view(st, self.role_cfg)
            v["items"].sort(key=lambda i: (-len(i["metrics"]["violations"]), -i["metrics"]["stockout_pct"]))
            v["totals"]["worst_campaign_id"] = v["items"][0]["id"] if v["items"] else None
            v["totals"]["spend_display"], v["totals"]["budget_cap_display"] = inr(v["totals"]["spend"]), inr(v["totals"]["budget_cap"])
            return {"note": "Campaigns are sorted worst-first. Use totals.worst_campaign_id for 'fix the worst'. Use *_display strings for rupee amounts.",
                    "totals": v["totals"], "conflicts": v["conflicts"], "campaigns": [
                {"id": i["id"], "name": i["name"], "city": i["city"], "category": CATS[i["cat"]]["n"], "dates": i["range"], "discount_pct": i["disc"], "audience": AUD[i["aud"]]["n"],
                 "budget": i["budget"], "budget_display": inr(i["budget"]), "status": i["status"], "mechanic": i["mech"], **{k: i["metrics"][k] for k in ("stockout_pct", "margin_pct", "forecast_units", "stock", "days_of_supply", "incremental_revenue", "violations")}}
                for i in v["items"]]}
        if name == "get_forecast":
            self._guard_region(a.get("region"))
            r = S.get_forecast(st, a.get("region"), a.get("category"), a.get("start_day"), a.get("days", 14))
            r.pop("daily", None)
            return r
        if name == "get_inventory":
            self._guard_region(a.get("region")) if a.get("region") else None
            return S.get_inventory(st, a.get("region") or self.role_cfg.get("region"), a.get("category"))
        if name == "get_segments":
            if self.role_cfg.get("noCustomer"):
                raise ToolError("Store Managers see the local view without customer-level data.")
            return S.get_segments(st)
        if name == "simulate":
            self._guard_item(a["item_id"])
            return S.simulate_item(st, a["item_id"], a.get("overrides"), a.get("demand_mult", 1.0), 1.0, a.get("stock_mult", 1.0))
        if name == "check_constraints":
            if a.get("item_id"):
                self._guard_item(a["item_id"])
            return S.check_constraints(st, a.get("item_id"))
        if name == "find_conflicts":
            return S.find_conflicts(st)
        if name == "suggest_transfer":
            self._guard_item(a["item_id"])
            return S.suggest_transfer(st, a["item_id"])
        if name == "optimize":
            self._guard_item(a["item_id"])
            return S.optimize_item(st, a["item_id"], a.get("margin_floor"), a.get("max_stockout_pct"))
        if name == "explain_discount":
            self._guard_item(a["item_id"])
            return S.explain_discount(st, a["item_id"], a.get("levels"))
        if name == "propose_fix":
            note = None
            w = S.worst_item(st, self.role_cfg)
            if w and re.search(r"\bworst\b|most at risk|biggest risk", self.user_text, re.I) and a.get("item_id") != w["id"]:
                note = f"User asked for the worst campaign; used {w['id']} ({w['name']}) instead of {a.get('item_id')}."
                a["item_id"] = w["id"]
            self._guard_item(a["item_id"])
            with ws.lock:
                res = self._prop(S.propose_fix(ws, a["item_id"]))
            if note:
                res["corrected_from_user_text"] = [note]
            return res
        if name == "propose_from_brief":
            # Small models mis-parse briefs; whatever the user explicitly wrote wins over the LLM's arguments.
            pb, fixed = S.parse_brief_text(self.user_text), []
            for k, key, val in (("region", "region", pb["region"]), ("category", "cat", pb["cat"]), ("budget_inr", "budget", pb["budget"]), ("margin_floor_pct", "margin_floor", pb["margin_floor"])):
                if val is not None and a.get(k) != val:
                    if a.get(k) is not None:
                        fixed.append(f"{k}: {a.get(k)} → {val}")
                    a[k] = val
            self._guard_region(a.get("region"))
            with ws.lock:
                res = self._prop(S.propose_from_brief(ws, a.get("budget_inr"), a.get("region"), a.get("category"), a.get("margin_floor_pct"), a.get("goal", "clear"), a.get("before_diwali", True)))
            if fixed:
                res["corrected_from_user_text"] = fixed
            return res
        if name == "propose_gap_fill":
            with ws.lock:
                return self._prop(S.propose_gap_fill(ws))
        if name == "propose_reschedule":
            self._guard_item(a["item_id"])
            with ws.lock:
                return self._prop(S.propose_reschedule(ws, a["item_id"], a["days"]))
        if name == "propose_budget_split":
            with ws.lock:
                return self._prop(S.propose_budget_split(ws, a["region_a"], a["region_b"], a.get("share_a_pct", 60)))
        if name == "propose_budget_whatif":
            with ws.lock:
                return self._prop(S.propose_budget_whatif(ws, a["target_budget_inr"]))
        if name == "propose_edit":
            self._guard_item(a["item_id"])
            with ws.lock:
                return self._prop(S.propose_update(ws, a["item_id"], a.get("changes") or {}))
        if name == "draft_copy":
            self._guard_item(a["item_id"])
            return S.draft_copy(st, a["item_id"], a.get("tone", "standard"))
        if name == "check_copy":
            return S.check_copy(a["text"], S.get_item(st, a["item_id"]) if a.get("item_id") else None)
        raise ToolError(f"Unknown tool '{name}'. Available: {[t['function']['name'] for t in TOOL_SCHEMAS]}")


# ----------------------------------------------------------------- grounding check ("LLM never invents numbers")
_NUM = re.compile(r"(₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*(Cr|L|K|%)?", re.I)


def _collect(o, out):
    if isinstance(o, bool):
        return
    if isinstance(o, (int, float)):
        out.add(float(o))
    elif isinstance(o, dict):
        for v in o.values():
            _collect(v, out)
    elif isinstance(o, (list, tuple)):
        for v in o:
            _collect(v, out)
    elif isinstance(o, str):
        for m in re.finditer(r"\d[\d,]*(?:\.\d+)?", o):
            try:
                out.add(float(m.group(0).replace(",", "")))
            except ValueError:
                pass


def grounding_check(reply, results, extra_text=""):
    known = set()
    for r in results:
        _collect(r, known)
    for m in re.finditer(r"\d[\d,]*(?:\.\d+)?", extra_text):
        known.add(float(m.group(0).replace(",", "")))
    ungrounded = []
    for m in _NUM.finditer(reply):
        cur, raw, unit = m.group(1), m.group(2), (m.group(3) or "").lower()
        try:
            v = float(raw.replace(",", ""))
        except ValueError:
            continue
        if unit == "" and not cur and v == int(v) and v <= 31:
            continue                               # dates, counts, ids
        if unit == "" and not cur and 2000 <= v <= 2100:
            continue                               # years
        mult = {"cr": 1e7, "l": 1e5, "k": 1e3}.get(unit, 1)
        cands = {v * mult} if (unit or cur) else {v}
        ok = any(abs(c - k) <= max(0.6, abs(k) * 0.02) for c in cands for k in known)
        if not ok:
            ungrounded.append(m.group(0).strip())
    return sorted(set(ungrounded))


def _text_tool_calls(content):
    """Some small models emit the call as JSON text instead of a tool_calls field."""
    m = re.search(r"\{.*\}", content, re.S)
    if not m:
        return []
    try:
        o = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    name = o.get("name")
    if name in {t["function"]["name"] for t in TOOL_SCHEMAS}:
        return [{"id": "txt", "type": "function", "function": {"name": name, "arguments": o.get("parameters") or o.get("arguments") or {}}}]
    return []


def _claims_proposal(text):
    return bool(re.search(r"propos|change set|draft(ed)?\b|suggest(ed)? (a )?fix|here are the (changes|edits)", text, re.I))


def _wants_proposal(msg):
    return bool(re.search(r"critique|fix|safe|optimi|brief|₹|move|shift|split|what.?if|fill|gap|improve|plan", msg, re.I))


# ----------------------------------------------------------------- LLM tool-calling loop
def _result_for_llm(res):
    s = json.dumps(res, default=str)
    return s if len(s) < 9000 else s[:9000] + "...[truncated]"


def run_llm(disp, message, history):
    from .config import settings
    msgs = [{"role": "system", "content": SYSTEM_PROMPT + f"\nCurrently selected campaign on the canvas: {disp.selected or 'none'}. User role: {disp.role_cfg.get('n', disp.role_key)}."}]
    for h in history[-6:]:
        msgs.append({"role": "user" if h["who"] == "user" else "assistant", "content": h["text"]})
    msgs.append({"role": "user", "content": message})
    calls, results, nudged = [], [], False
    for _ in range(settings.max_tool_rounds):
        m = llm.chat(msgs, TOOL_SCHEMAS)
        tcs = m.get("tool_calls") or _text_tool_calls(m.get("content") or "")
        if not tcs:
            content = (m.get("content") or "").strip()
            # Small models sometimes describe a proposal without drafting one. Nudge once.
            if not nudged and not disp.proposal_ids and _claims_proposal(content) and _wants_proposal(message):
                nudged = True
                msgs.append({"role": "assistant", "content": content})
                msgs.append({"role": "user", "content": "You described a proposal but did not create one. Call the matching propose_* tool now (e.g. propose_fix with the campaign id); do not describe results you did not get from a tool."})
                continue
            return content, calls, results
        tcs = [{**tc, "function": {**tc["function"], "arguments": tc["function"]["arguments"] if isinstance(tc["function"].get("arguments"), str)
                                    else json.dumps(tc["function"].get("arguments") or {})}} for tc in tcs]
        msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": tcs})
        for tc in tcs:
            fn = tc["function"]
            try:
                args = fn.get("arguments") or {}
                args = json.loads(args) if isinstance(args, str) else args
            except json.JSONDecodeError:
                args = {}
            try:
                res = disp.call(fn["name"], args)
                calls.append({"name": fn["name"], "args": args, "ok": True})
                results.append(res)
                content = _result_for_llm(res)
            except ToolError as e:
                calls.append({"name": fn["name"], "args": args, "ok": False, "error": str(e)})
                content = json.dumps({"error": str(e)})
            except (KeyError, TypeError, ValueError) as e:
                calls.append({"name": fn["name"], "args": args, "ok": False, "error": f"bad arguments: {e}"})
                content = json.dumps({"error": f"bad arguments: {e}. Check the tool schema."})
            msgs.append({"role": "tool", "tool_call_id": tc.get("id", fn["name"]), "name": fn["name"], "content": content})
    # out of rounds: ask for a final answer without tools
    msgs.append({"role": "user", "content": "Summarize what you found now using only the tool results above."})
    m = llm.chat(msgs)
    return (m.get("content") or "").strip(), calls, results


# ----------------------------------------------------------------- deterministic fallback (same tools, templated language)
def _fmt_prop(p):
    lines = [f"**{p['title']}** · evidence: {p['evidence']} → recommendation: {p['recommendation']}"]
    for c in p["changes"]:
        d = c["diff"]
        bits = []
        if d.get("stockout_pct"):
            bits.append(f"stockout {d['stockout_pct']['before']}% → {d['stockout_pct']['after']}%" if d["stockout_pct"]["before"] is not None else f"stockout {d['stockout_pct']['after']}%")
        if d.get("margin_pct"):
            bits.append(f"margin {d['margin_pct']['before']}% → {d['margin_pct']['after']}%" if d["margin_pct"]["before"] is not None else f"margin {d['margin_pct']['after']}%")
        lines.append(f"- {c['label']}" + (f" ({'; '.join(bits)})" if bits else ""))
    sd = p["set_diff"]
    lines.append(f"If all accepted: rule violations {sd['rule_violations']['before']} → {sd['rule_violations']['after']}, worst stockout {sd['stockout_pct_worst']['before']}% → {sd['stockout_pct_worst']['after']}%.")
    if p["validation"]["warning"]:
        lines.append("⚠ " + p["validation"]["warning"])
    return "\n".join(lines)


def find_item_by_text(st, t, role_cfg, selected):
    t = t.lower()
    its = S.visible_items(st, role_cfg)
    named = next((i for i in its if i["name"].lower() in t), None)
    if named:
        return named
    c, r = S.find_cat(t), S.find_region(t)
    cand = [i for i in its if (not c or i["cat"] == c) and (not r or i["region"] == r)]
    if (c or r) and cand:
        return max(cand, key=lambda i: S.sim(st, i, st["plan"])["pStock"])
    if re.search(r"\bthis\b|selected|\bit\b", t) and selected:
        return next((i for i in its if i["id"] == selected), None)
    return None


def run_rules(disp, message):
    st = disp.st
    t = message.lower()
    calls, results, notes = [], [], []

    def call(name, **a):
        r = disp.call(name, a)
        calls.append({"name": name, "args": a, "ok": True}); results.append(r)
        return r

    try:
        if re.search(r"critique|review my|check (the|my) plan|what.*wrong|issues|problems|conflict", t):
            plan = call("get_plan")
            lines = [f"I checked all {len(plan['campaigns'])} campaigns against inventory, forecast and guardrails. {plan['totals']['campaigns_breaking_rules']} break hard rules; {len(plan['conflicts'])} conflicts."]
            for c in plan["campaigns"]:
                if c["violations"]:
                    lines.append(f"- ⛔ {c['name']} ({c['city']}): {c['stock']} units in stock ({c['days_of_supply']} days) vs forecast {c['forecast_units']} → stockout {c['stockout_pct']}%, margin {c['margin_pct']}%.")
            lines += [f"- ⚠ {c['type']}: {c['text']}" for c in plan["conflicts"]]
            w = S.worst_item(st, disp.role_cfg)
            if w:
                r = call("propose_fix", item_id=w["id"])
                lines.append(_fmt_prop(st["proposals"][r["proposal"]["proposal_id"]]) if r.get("proposal") else r.get("note", ""))
            gap = call("propose_gap_fill")
            if gap.get("gap"):
                lines.append(f"💡 Gap: {gap['gap']}")
                if gap.get("proposal"):
                    lines.append(_fmt_prop(st["proposals"][gap["proposal"]["proposal_id"]]))
            return "\n".join(lines), calls, results
        if re.search(r"what.?if", t) or (re.search(r"budget", t) and re.search(r"(→|->|\bto\b)\s*₹?\s*\d", t) and "split" not in t):
            nums = [S.parse_brief_text(m.group(0))["budget"] for m in re.finditer(r"\d+(?:\.\d+)?\s*(?:l|lakh|lac|cr|k)\b", t)]
            target = [n for n in nums if n][-1] if [n for n in nums if n] else 600000
            r = call("propose_budget_whatif", target_budget_inr=target)
            txt = f"What-if budget {inr(r['now']['spend'])} → {inr(target)}: incremental revenue {inr(r['now']['incremental_revenue'])} → {inr(r['at_target']['incremental_revenue'])}, plan margin {r['now']['plan_margin_pct']}% → {r['at_target']['plan_margin_pct']}%."
            if r["unreachable"]:
                txt += f" Cannot reach the target without cutting approved campaigns (floor {inr(r['floor_without_cutting_approved'])})."
            if r.get("proposal"):
                txt += "\n" + _fmt_prop(st["proposals"][r["proposal"]["proposal_id"]])
            return txt, calls, results
        if "split" in t:
            regs = sorted([(t.find(k), v) for k, v in {"telangana": "TS", "hyderabad": "TS", "karnataka": "KA", "bengaluru": "KA", "maharashtra": "MH", "pune": "MH", "delhi": "DL"}.items() if k in t])
            seen = []
            for _, r_ in regs:
                if r_ not in seen:
                    seen.append(r_)
            if len(seen) < 2:
                return "Please name two regions, e.g. “split budget 60/40 between Telangana and Karnataka”.", calls, results
            m = re.search(r"(\d+)\s*/\s*(\d+)", t)
            r = call("propose_budget_split", region_a=seen[0], region_b=seen[1], share_a_pct=int(m.group(1)) if m else 60)
            return (_fmt_prop(st["proposals"][r["proposal"]["proposal_id"]]) if r.get("proposal") else r["note"]), calls, results
        bm = S.parse_brief_text(t)
        if bm["budget"] and re.search(r"clear|plan|launch|campaign|promot|sell", t):
            r = call("propose_from_brief", budget_inr=bm["budget"], region=bm["region"] or "TS", category=bm["cat"] or "FW", margin_floor_pct=bm["margin_floor"], goal=bm["goal"], before_diwali=bm["before_diwali"])
            txt = f"Parsed brief → {r.get('parsed_brief')}. " + (r.get("note") or "")
            if r.get("proposal"):
                txt += "\n" + _fmt_prop(st["proposals"][r["proposal"]["proposal_id"]])
            return txt, calls, results
        if "why" in t:
            it = find_item_by_text(st, t, disp.role_cfg, disp.selected) or S.get_item(st, "c1")
            nm = re.search(r"(\d+)\s*%", t)
            r = call("explain_discount", item_id=it["id"], levels=[int(nm.group(1))] if nm else None)
            rows = "\n".join(f"- {x['discount']}%: inc. profit {inr(x['incremental_profit'])}, margin {x['margin_pct']}%, stockout {x['stockout_pct']}% {'✓' if x['feasible'] else '✗ ' + '; '.join(x['violations'])}" for x in r["alternatives"])
            return f"Why {nm.group(1) + '%' if nm else str(it['disc']) + '%'} for {it['name']} (audience: {r['audience']})?\n{rows}\n{('Best feasible: ' + str(r['best_feasible_discount']) + '%.') if r['best_feasible_discount'] is not None else 'No level is feasible at current stock; consider a transfer first (ask me to fix it).'} Evidence: {r['evidence']}.", calls, results
        if re.search(r"move|shift|earlier|later|postpone|prepone", t):
            it = find_item_by_text(st, t, disp.role_cfg, disp.selected)
            if not it:
                return "Which campaign? Mention it by name, category or region (e.g. “move the beauty campaign a week earlier”).", calls, results
            n = 7 if "week" in t else 1
            dm = re.search(r"(\d+)\s*(day|week)", t)
            if dm:
                n = int(dm.group(1)) * (7 if dm.group(2) == "week" else 1)
            r = call("propose_reschedule", item_id=it["id"], days=-n if re.search(r"earlier|prepone|back|before", t) else n)
            return _fmt_prop(st["proposals"][r["proposal"]["proposal_id"]]), calls, results
        if re.search(r"margin.?safe|fix|optimi[sz]e|improve|safer", t):
            it = find_item_by_text(st, t, disp.role_cfg, disp.selected) or S.worst_item(st, disp.role_cfg)
            r = call("propose_fix", item_id=it["id"])
            return (_fmt_prop(st["proposals"][r["proposal"]["proposal_id"]]) if r.get("proposal") else r["note"]), calls, results
        if re.search(r"gap|fill|idle|aging|ageing|overstock", t):
            r = call("propose_gap_fill")
            return (f"💡 {r['gap']}\n" + _fmt_prop(st["proposals"][r["proposal"]["proposal_id"]])) if r.get("proposal") else r["note"], calls, results
        if re.search(r"copy|headline|whatsapp|message|creative|draft", t):
            it = find_item_by_text(st, t, disp.role_cfg, disp.selected) or S.get_item(st, "c1")
            tone = "premium" if "premium" in t else "hindi" if "hindi" in t else "telugu" if "telugu" in t else "standard"
            r = call("draft_copy", item_id=it["id"], tone=tone)
            cp = r["copy"]
            return f"Draft copy for {it['name']} ({tone}):\n- Headline: {cp['headline']}\n- Push: {cp['push']}\n- WhatsApp: {cp['whatsapp']}\nGuardrails ok: {r['guardrails']['ok']}.", calls, results
    except ToolError as e:
        return f"I could not complete that: {e}", calls, results
    return ("I can: critique the plan, fix a campaign (“make it margin-safe”), plan from a brief (“₹2L, clear jackets in Delhi before Diwali, margin ≥ 22%”), "
            "move / split budgets, answer what-ifs (“budget ₹10L → ₹6L?”), explain (“why 16%?”) and draft copy."), calls, results


# ----------------------------------------------------------------- entry point
def chat(ws, message, role_key, role_cfg, selected_id=None, mode="auto"):
    who = (role_cfg or {}).get("n", role_key)
    disp = Dispatcher(ws, role_key, role_cfg, selected_id, message)
    history = ws.st["chat"]
    ws.audit(who, "Asked copilot", message)
    warnings, used_mode, provider = [], "rules", None
    reply = calls = results = None
    if mode in ("auto", "llm"):
        p = llm.resolve_provider()
        if p:
            try:
                reply, calls, results = run_llm(disp, message, history)
                used_mode, provider = "llm", {"name": p["name"], "model": p["model"]}
                if not reply:
                    reply = "I ran the tools but produced no summary. See the proposals below." if disp.proposal_ids else "I could not produce an answer."
            except llm.LLMUnavailable as e:
                warnings.append(f"LLM unavailable ({e}); used the deterministic rules engine.")
        elif mode == "llm":
            warnings.append("No LLM provider reachable; used the deterministic rules engine.")
    if reply is None:
        disp = Dispatcher(ws, role_key, role_cfg, selected_id, message)   # discard any partial drafts' bookkeeping
        reply, calls, results = run_rules(disp, message)
    props = [clone(ws.st["proposals"][pid]) for pid in dict.fromkeys(disp.proposal_ids)]
    ungrounded = grounding_check(reply, results, message + " " + json.dumps([i for i in ws.st["plan"]["items"]])) if used_mode == "llm" else []
    if used_mode == "llm" and not props and _claims_proposal(reply):
        warnings.append("The answer mentions a proposal but none was created by a tool; treat the described changes as unverified.")
    if ungrounded:
        warnings.append("Some numbers in this answer were not found in any tool result; verify before relying on them: " + ", ".join(ungrounded[:8]))
    evidence = props[-1]["evidence"] if props else None
    out = {"reply": reply, "mode": used_mode, "provider": provider, "proposals": props, "tool_calls": calls, "evidence": evidence,
           "grounding": {"checked": used_mode == "llm", "ungrounded_numbers": ungrounded}, "warnings": warnings}
    history.append({"who": "user", "text": message})
    history.append({"who": "ai", "text": reply})
    del history[:-40]
    ws.save()
    return out
