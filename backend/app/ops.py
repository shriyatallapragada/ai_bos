"""Simulation Lab, Readiness & Approval, War Room & Learning, Governance, Control Tower."""
import random

from .data import (AUD, BASE, CATS, EVENTS, FEEDBACK_TOPICS, LEARNING_ROWS, PROFILES, READY_ITEMS, REGIONS, ROLES, ROOT_CAUSES,
                   SEASONS, TODAY, ds)
from .models import (donor_for, events_in, inr, monte_carlo, optimize, plan_totals, quantile, season_mult, sigma, sim,
                     stock_of, violations)
from .services import (ToolError, build_fix, confidence, get_item, gap_candidate, metrics_out, r1, visible_items, worst_item)


# ================================================================= SIMULATION LAB (M4)
def stress_opts(stress):
    return {"demand_mult": 1.3 if stress.get("demand") else 1.0, "stock_mult": .7 if stress.get("supplier") else 1.0,
            "lift_mult": .65 if stress.get("competitor") else 1.0}


def agent_views(ws, it, m):
    st = ws.st
    G = st["guard"]
    donor = donor_for(st, st["plan"], it["region"], it["cat"])
    v = violations(st, it, m)
    a = [
        {"agent": "Customer", "report": f"{AUD[it['aud']]['n']}: {round(AUD[it['aud']]['share'] * 100)}% of buyers discounted. Discount waste {inr(m['waste'])}.",
         "stance": "wants targeting" if it["aud"] == "all" else "OK", "status": "amber" if it["aud"] == "all" else "green"},
        {"agent": "Demand", "report": f"Forecast {round(m['D'])} units (80% band {round(m['D'] * (1 - 1.28 * sigma(st)))}–{round(m['D'] * (1 + 1.28 * sigma(st)))}).", "stance": "forecast ready", "status": "blue"},
        {"agent": "Inventory", "report": f"{round(m['stk'])} units, {m['dos']:.1f} days of supply. " + (f"{REGIONS[donor['r']]['city']} can spare {donor['surplus']}." if donor else "No donor available."),
         "stance": "objects: stockout" if m["pStock"] * 100 > G["stockoutMax"] else "OK", "status": "red" if m["pStock"] * 100 > G["stockoutMax"] else "green"},
        {"agent": "Finance", "report": f"Margin {m['marginPct']:.1f}% vs floor {G['marginFloor']}%. Inc. profit {inr(m['incProfit'])}.",
         "stance": "objects: margin" if m["marginPct"] < G["marginFloor"] else "OK", "status": "red" if m["marginPct"] < G["marginFloor"] else "green"},
        {"agent": "Operations", "report": f"{round(m['sold'] / it['len'])} units/day pick load. Signage lead time 3 days.", "stance": "OK", "status": "green"},
        {"agent": "Market", "report": f"{', '.join(events_in(it)) or 'No festival'} in window. Competitor promo likely (0.6).", "stance": "watch", "status": "amber"},
        {"agent": "Risk", "report": f"{len(v)} hard-rule breaks. Resilience depends on stock transfer.", "stance": "blocks review" if v else "OK", "status": "red" if v else "green"},
    ]
    fix = build_fix(ws, it)
    orch = " · ".join(c["label"] for c in fix["changes"]) if fix and fix["changes"] else "Current plan is feasible. No changes."
    return {"agents": a, "orchestrator": orch}


def simulation_lab(ws, item_id, stress=None, n=2000):
    st = ws.st
    it = get_item(st, item_id)
    stress = st["stress"] if stress is None else stress
    o = stress_opts(stress)
    mc = monte_carlo(st, it, st["plan"], n=n, **o)
    revs = [x["rev"] for x in mc]
    G = st["guard"]
    p_so = sum(1 for x in mc if x["so"]) / n
    p_mb = sum(1 for x in mc if x["margin"] < G["marginFloor"]) / n
    lo, hi, bins = quantile(revs, .02), quantile(revs, .98), 36
    hist = [0] * bins
    for v in revs:
        hist[max(0, min(bins - 1, int((v - lo) / (hi - lo) * bins)))] += 1
    m0 = sim(st, it, st["plan"], **o)
    cf_levels = sorted({10, 16, 20, 25, it["disc"]})
    cf = []
    for d in cf_levels:
        x = {**it, "disc": d}
        m = sim(st, x, st["plan"], **o); v = violations(st, x, m)
        cf.append({"discount": d, "current": d == it["disc"], "revenue": round(m["revenue"]), "incremental_profit": round(m["incProfit"]), "margin_pct": r1(m["marginPct"]),
                   "stockout_pct": r1(m["pStock"] * 100), "rules_broken": len(v), "violations": [y["t"] for y in v]})
    feas = [c for c in cf if not c["rules_broken"]]
    best = max(feas, key=lambda c: c["incremental_profit"])["discount"] if feas else None
    scen = [("Base", {}), ("Demand +30%", {"demand_mult": 1.3}), ("Supplier delay 5d", {"stock_mult": .7}), ("Competitor promo", {"lift_mult": .65}), ("Demand -20%", {"demand_mult": .8})]
    scen_r = []
    for name, so in scen:
        m = sim(st, it, st["plan"], **so); v = violations(st, it, m)
        scen_r.append({"scenario": name, "stockout_pct": r1(m["pStock"] * 100), "margin_pct": r1(m["marginPct"]), "pass": not v})
    resil = round(sum(1 for s in scen_r if s["pass"]) / len(scen_r) * 100)
    if p_so * 100 > G["stockoutMax"] or p_mb > .4:
        rec = {"action": "do_not_proceed", "text": "Do not proceed as-is. Fix it on the canvas first."}
    elif p_mb > .15:
        rec = {"action": "pilot", "text": "Pilot in 2 stores for 3 days, then scale."}
    else:
        rec = {"action": "proceed", "text": "Proceed. Risk is within guardrails."}
    m0["viol"] = violations(st, it, m0)
    return {
        "item": {**it, "city": REGIONS[it["region"]]["city"]}, "stress": stress, "crisis": st["crisis"], "runs": n, "sigma": sigma(st),
        "distribution": {"p10": round(quantile(revs, .1)), "p50": round(quantile(revs, .5)), "p90": round(quantile(revs, .9)), "histogram": hist, "range": [round(lo), round(hi)]},
        "probabilities": {"stockout_pct": r1(p_so * 100), "margin_breach_pct": r1(p_mb * 100)},
        "point_estimate": metrics_out(m0),
        "second_order": {"pull_forward_units": round(m0["I"] * .12), "fulfillment_load_per_day": round(m0["sold"] / it["len"]), "stores": len(REGIONS[it["region"]]["stores"])},
        "counterfactual": {"question": "Why not 20%?", "rows": cf, "best_feasible_discount": best,
                           "ghost_replay": "Last year's Diwali footwear ran 25% off to everyone and stocked out on day 6. Replaying it through today's model flags 71% stockout risk. This is an estimated counterfactual."},
        "red_team": {"scenarios": scen_r, "resilience_score": resil},
        "confidence": {"known": ["Stock by store (confidence 0.92)", "Baseline demand: 2 yrs of POS", "Festive seasonality"],
                       "uncertain": ["Elasticity (14 promos, CI ±25%)", "Competitor response"], "unknown": ["Weather impact (no data)"], "recommendation": rec},
        "agent_room": agent_views(ws, it, m0),
        "labels": "Synthetic data. Counterfactuals are estimates.",
    }


def inject_crisis(ws, item_id, who):
    st = ws.st
    it = get_item(st, item_id)
    st["stress"]["supplier"] = True
    st["crisis"] = f"Supplier for {CATS[it['cat']]['n']} delayed 5 days (-30% inbound stock)"
    ws.audit("System", "Crisis injected", st["crisis"])
    return st["crisis"]


# ================================================================= READINESS & APPROVAL (M5)
def readiness(ws, item_id):
    st = ws.st
    it = get_item(st, item_id)
    r = st["readiness"].setdefault(item_id, {"price": True, "channels": item_id != "c3", "supplier": True, "stores": False, "consent": True, "creative": False})
    m = sim(st, it, st["plan"])
    r["stock"] = m["pStock"] * 100 <= st["guard"]["stockoutMax"]
    return r


def readiness_view(ws, item_id):
    st = ws.st
    it = get_item(st, item_id)
    r = readiness(ws, item_id)
    chain = PROFILES[st["profile"]]["chain"]
    score = sum(1 for k, _, _ in READY_ITEMS if r.get(k)) / len(READY_ITEMS)
    v = violations(st, it, sim(st, it, st["plan"]))
    step = st["approvals"].get(item_id, 0)
    return {"id": item_id, "name": it["name"], "status": it["status"],
            "checklist": [{"key": k, "label": lbl, "owner": own, "done": bool(r.get(k))} for k, lbl, own in READY_ITEMS],
            "score_pct": round(score * 100), "go": score >= .7 and not v,
            "verdict": "GO" if score >= .7 and not v else "NO-GO",
            "chain": chain, "approved_steps": min(step, len(chain)), "next_step": chain[step] if step < len(chain) else None,
            "violations": v, "override": st["overrides"].get(item_id)}


def toggle_readiness(ws, item_id, key, done, who):
    if key not in {k for k, _, _ in READY_ITEMS} or key == "stock":
        raise ToolError("Unknown or computed readiness key (stock is computed from the simulator)")
    readiness(ws, item_id)
    ws.st["readiness"][item_id][key] = bool(done)
    ws.audit(who, "Readiness updated", f"{item_id}: {key} = {bool(done)}")


def set_override(ws, item_id, reason, who):
    if not reason or len(reason.strip()) < 5:
        raise ToolError("An override requires a recorded reason (min 5 characters)")
    ws.st["overrides"][item_id] = {"reason": reason.strip(), "by": who}
    ws.audit(who, "Override recorded", f"{get_item(ws.st, item_id)['name']}: {reason}")


def approve(ws, item_id, role_key):
    st = ws.st
    it = get_item(st, item_id)
    chain = PROFILES[st["profile"]]["chain"]
    step = st["approvals"].get(item_id, 0)
    if step >= len(chain):
        raise ToolError("Already fully approved")
    role = ROLES[role_key]
    if role_key != "admin" and role.get("step") != chain[step]:
        raise ToolError(f"This step needs the '{chain[step]}' role (you are {role['n']}). No single person approves every step.")
    r = readiness(ws, item_id)
    score = sum(1 for k, _, _ in READY_ITEMS if r.get(k)) / len(READY_ITEMS)
    v = violations(st, it, sim(st, it, st["plan"]))
    if v and item_id not in st["overrides"]:
        raise ToolError("Blocked: hard rules are violated and there is no override reason on record.")
    if step == len(chain) - 1 and score < .7:
        raise ToolError("Final approval needs a readiness score of at least 70%.")
    ws.audit(role["n"], "Approved", f"{it['name']} · step {chain[step]}")
    st["approvals"][item_id] = step + 1
    if st["approvals"][item_id] >= len(chain):
        it["status"] = "Approved"
    return readiness_view(ws, item_id)


def reject_approval(ws, item_id, reason, who):
    if not reason:
        raise ToolError("A reason is required")
    it = get_item(ws.st, item_id)
    it["status"] = "Draft"
    ws.st["approvals"][item_id] = 0
    ws.audit(who, "Sent back", f"{it['name']}: {reason}")


def go_live(ws, item_id, role_key):
    it = get_item(ws.st, item_id)
    if role_key == "marketing":
        raise ToolError("Separation of duties: the campaign creator cannot publish. Switch to Admin.")
    if it["status"] != "Approved":
        raise ToolError("Only fully approved campaigns can be published.")
    it["status"] = "Live"
    ws.audit(ROLES[role_key]["n"], "Published", it["name"])


def send_to_review(ws, item_id, who):
    st = ws.st
    it = get_item(st, item_id)
    v = violations(st, it, sim(st, it, st["plan"]))
    if v and item_id not in st["overrides"]:
        raise ToolError("Blocked: hard rule violated. Fix the campaign or record an override reason.")
    it["status"] = "In review"
    st["approvals"].setdefault(item_id, 0)
    ws.audit(who, "Status changed", f"{it['name']} → In review")


# ================================================================= WAR ROOM & LEARNING (M6)
def _war_t():
    s = sum(BASE["DL"]["FW"][0] * season_mult(33 + d, "FW") * 1.25 for d in range(10))
    return round(s * .3 / 10) * 10


def _rn(seed):
    return random.Random(seed).random()


def war_series(st, r):
    out = []
    for d in range(10):
        pred = BASE[r]["FW"][0] * season_mult(33 + d, "FW") * 1.25
        obs = pred * (1 + (_rn(ord(r[0]) * 100 + d) - .5) * .12)
        if r == "DL":
            obs = pred * (1 + min(.37, d * .1))
        out.append({"pred": pred, "obs": obs})
    stock = sum(x["pred"] for x in out) * (1.6 if r == "MH" else 1.08)
    if st["war"]["transfer"] == "done":
        if r == "DL":
            stock += _war_t()
        if r == "MH":
            stock -= _war_t()
    return out, stock


def region_status(st, r, day):
    series, stock = war_series(st, r)
    used = sum(series[d]["obs"] for d in range(day))
    cur = series[max(0, day - 1)]
    var = (cur["obs"] / cur["pred"] - 1) * 100 if day else 0
    left = stock - used
    days_left = left / cur["obs"]
    rem = 10 - day
    if day and (days_left < rem * .9 or (var > 25 and days_left < rem * 1.15)):
        s = "red"
    elif day and (var > 15 or days_left < rem * 1.05):
        s = "amber"
    else:
        s = "green"
    return {"region": r, "city": REGIONS[r]["city"], "status": s, "variance_pct": r1(var), "stock_left": round(left), "days_of_stock_left": r1(days_left),
            "predicted_today": round(cur["pred"]), "observed_today": round(cur["obs"])}


def war_view(ws):
    st = ws.st
    W = st["war"]
    day = W["day"]
    regs = [region_status(st, r, day) for r in REGIONS]
    dl = next(x for x in regs if x["region"] == "DL")
    alert = None
    if day >= 3 and dl["status"] == "red" and W["transfer"] == "none":
        alert = {"level": "red", "text": f"Delhi footwear demand is +{round(dl['variance_pct'])}% vs forecast; stock covers {dl['days_of_stock_left']} days vs {10 - day} remaining.",
                 "circuit_breaker": "Triggered: throttle push, Delhi footwear (demand > +25% vs forecast). Pre-approved by humans, logged.",
                 "proposed_intervention": {"type": "transfer", "units": _war_t(), "from": "Pune (MH)", "to": "Delhi (DL)", "requires_human_approval": True}}
    series = {r: [{"day": d + 1, "predicted": round(s["pred"]), "observed": round(s["obs"]) if d < day else None} for d, s in enumerate(war_series(st, r)[0])] for r in REGIONS}
    return {"day": day, "of": 10, "transfer": W["transfer"], "regions": regs, "alert": alert, "series": series, "transfer_units": _war_t()}


def war_step(ws):
    st = ws.st
    W = st["war"]
    if W["day"] >= 10:
        return war_view(ws)
    W["day"] += 1
    dl = region_status(st, "DL", W["day"])
    if W["day"] >= 3 and dl["status"] == "red" and W["transfer"] == "none" and not W["alerted"]:
        W["alerted"] = True
        ws.audit("System", "Early-warning alert", f"Delhi footwear +{round(dl['variance_pct'])}% vs forecast")
        ws.audit("System", "Circuit breaker triggered", "Throttle push, Delhi footwear (demand > +25% vs forecast)")
    return war_view(ws)


def war_simulate_transfer(ws):
    st = ws.st
    before = region_status(st, "DL", max(st["war"]["day"], 1))
    saved = st["war"]["transfer"]
    st["war"]["transfer"] = "done"
    after = region_status(st, "DL", max(st["war"]["day"], 1))
    st["war"]["transfer"] = saved
    return {"units": _war_t(), "from": "Pune", "to": "Delhi", "before": before, "after": after}


def war_approve_transfer(ws, who):
    if ws.st["war"]["transfer"] == "done":
        raise ToolError("Transfer already approved")
    ws.st["war"]["transfer"] = "done"
    ws.audit(who, "Approved intervention", f"Transfer {_war_t()} footwear units Pune → Delhi")
    return war_view(ws)


def war_reset(ws):
    ws.st["war"] = {"day": 0, "transfer": "none", "alerted": False}


def learning_view(ws):
    st = ws.st
    locked = st["tier"] < 3
    rows = [{**r, "error_pct": round((r["actual_L"] - r["predicted_L"]) / r["predicted_L"] * 100)} for r in LEARNING_ROWS]
    return {"reality_check": rows, "forecast_mape_pct": 11.8, "interval_coverage_80_pct": 83, "model": "v0.3 → v0.4 (recalibrated with actuals)",
            "feedback": {"locked": locked, "needs_tier": 3, "topics": [] if locked else FEEDBACK_TOPICS, "sentiment": -0.21, "reviews": 4812},
            "root_causes": {"label": "Ranked hypotheses, not facts", "items": ROOT_CAUSES},
            "suggested_guardrail": "Size coverage ≥ 80% per store (apparel & footwear)", "guardrail_added": st["learnGuardAdded"],
            "memory": ["23 similar festive campaigns indexed as planner benchmarks", "Footwear elasticity updated 2.0 → 2.1 (± 0.4)"]}


def add_learning_guardrail(ws, who):
    st = ws.st
    if st["learnGuardAdded"]:
        raise ToolError("Guardrail already added")
    st["learnGuardAdded"] = True
    st["guard"]["extra"].append("Size coverage ≥ 80% per store (apparel & footwear)")
    ws.audit(who, "Guardrail added", "Size coverage ≥ 80% (from learning loop)")


# ================================================================= GOVERNANCE
def governance_view(ws):
    st = ws.st
    return {"guard": st["guard"], "tier": st["tier"], "profile": st["profile"], "profile_detail": PROFILES[st["profile"]], "season": st["season"],
            "season_detail": SEASONS[st["season"]], "model_version": st["model_version"],
            "locked_features": {"segments": st["tier"] < 2, "feedback_intelligence": st["tier"] < 3},
            "privacy": ["Pseudonymized customer IDs", "Consent and channel opt-in flags", "Jurisdiction-configurable rules (e.g. India DPDP, MRP rules): verify specifics before claiming",
                        "Fairness: sensitive attributes and proxies excluded; offers, not individual shelf prices"]}


def update_governance(ws, who, body):
    st = ws.st
    G = st["guard"]
    for k in ("marginFloor", "budgetCap", "stockoutMax", "contactCap"):
        if body.get(k) is not None:
            G[k] = body[k]
            ws.audit(who, "Guardrail changed", f"{k} → {body[k]}")
    if body.get("discountCap"):
        for c, v in body["discountCap"].items():
            if c not in CATS:
                raise ToolError(f"Unknown category {c}")
            G["discountCap"][c] = v
            ws.audit(who, "Guardrail changed", f"discountCap.{c} → {v}")
    if body.get("tier") is not None:
        if body["tier"] not in (1, 2, 3):
            raise ToolError("tier must be 1, 2 or 3")
        st["tier"] = body["tier"]; ws.audit(who, "Data tier changed", f"Tier {body['tier']}")
    if body.get("profile"):
        if body["profile"] not in PROFILES:
            raise ToolError(f"profile must be one of {list(PROFILES)}")
        st["profile"] = body["profile"]; ws.audit(who, "Profile switched", PROFILES[body["profile"]]["n"])
    if body.get("season"):
        if body["season"] not in SEASONS:
            raise ToolError(f"season must be one of {list(SEASONS)}")
        st["season"] = body["season"]; ws.audit(who, "Season mode changed", SEASONS[body["season"]]["n"])
    return governance_view(ws)


def guardrail_test(ws, who, cat, disc, region="TS"):
    st = ws.st
    if cat not in CATS:
        raise ToolError(f"Unknown category {cat}")
    it = {"id": "test", "name": "Test", "region": region, "cat": cat, "start": 33, "len": 10, "disc": disc, "aud": "all", "budget": 40000, "status": "Draft", "mech": "% off", "excl": False}
    m = sim(st, it, st["plan"]); v = violations(st, it, m)
    best = optimize(st, it, st["plan"])
    ws.audit(who, "Guardrail test", f"{disc}% off {CATS[cat]['n']}: {'blocked' if v else 'allowed'}")
    alt = None
    if best:
        alt = {"discount": best["it"]["disc"], "audience": AUD[best["it"]["aud"]]["n"], "exclude_low_stock_skus": best["it"]["excl"], "margin_pct": r1(best["m"]["marginPct"]),
               "stockout_pct": r1(best["m"]["pStock"] * 100), "incremental_profit": round(best["m"]["incProfit"])}
    return {"allowed": not v, "violations": [x["t"] for x in v], "metrics": {"margin_pct": r1(m["marginPct"]), "stockout_pct": r1(m["pStock"] * 100)}, "feasible_alternative": alt}


# ================================================================= CONTROL TOWER (M7)
def control_tower(ws, role_cfg=None):
    st = ws.st
    T = plan_totals(st, st["plan"])
    G = st["guard"]
    vis = visible_items(st, role_cfg)
    risky = [i for i in vis if T["per"][i["id"]]["viol"]]
    in_review = [i for i in st["plan"]["items"] if i["status"] == "In review"]
    over = T["spend"] > G["budgetCap"]
    decisions = []
    if risky:
        w = max(risky, key=lambda i: T["per"][i["id"]]["pStock"]); m = T["per"][w["id"]]
        decisions.append({"title": f"Resolve risk on {w['name']}", "detail": f"{m['pStock'] * 100:.0f}% stockout risk · margin {m['marginPct']:.1f}%", "action": "copilot_fix", "item_id": w["id"]})
    if over:
        decisions.append({"title": "Bring the plan within budget", "detail": f"{inr(T['spend'])} planned against a {inr(G['budgetCap'])} cap", "action": "open_plan"})
    if in_review:
        decisions.append({"title": f"Approve {len(in_review)} campaign(s)", "detail": " · ".join(i["name"] for i in in_review), "action": "open_approvals", "item_id": in_review[0]["id"]})
    gap = gap_candidate(st)
    opportunities = [{"title": "Diwali opportunity", "detail": f"Diwali in {41 - TODAY} days; festive demand peaks ~1.75x baseline."}]
    if gap:
        opportunities.append({"title": "Idle aging stock", "detail": gap["text"]})
    risks = [{"title": f"{i['name']}", "detail": "; ".join(x["t"] for x in T["per"][i["id"]]["viol"])} for i in risky]
    risks += [{"title": c["type"], "detail": c["text"]} for c in T["conf"]]
    return {
        "date": ds(TODAY), "days_to_diwali": 41 - TODAY, "profile": PROFILES[st["profile"]]["n"], "headline_kpi": PROFILES[st["profile"]]["kpi"],
        "kpis": {"incremental_revenue": round(T["inc"]), "incremental_revenue_low": round(T["incLo"]), "incremental_revenue_high": round(T["incHi"]),
                 "plan_margin_pct": r1(T["margin"]), "margin_floor_pct": G["marginFloor"], "budget_committed": round(T["spend"]), "budget_cap": G["budgetCap"],
                 "campaigns_breaking_rules": T["nViol"]},
        "morning_brief": {"opportunities": opportunities, "risks": risks, "decisions_needed": decisions},
        "status_counts": {s: sum(1 for i in st["plan"]["items"] if i["status"] == s) for s in ("Draft", "Proposed", "In review", "Approved", "Live")},
    }


def executive_brief(ws):
    st = ws.st
    T = plan_totals(st, st["plan"])
    w = T["worst"]
    return {
        "title": "Diwali 2026 plan",
        "recommendation": "Replace blanket discounts with targeted offers, and move footwear stock from Pune to Hyderabad before 31 Oct.",
        "main_risk": f"{w[0]['name']}: {w[1]['pStock'] * 100:.0f}% stockout risk." if w else "None.",
        "action": "Accept the copilot's change set, then route it to Merchandising and Supply Chain.",
        "confidence": "Moderate. The elasticity comes from 14 past promotions, so pilot in two stores first.",
        "decision_required": f"Approve {inr(T['spend'])} of plan spend (cap {inr(st['guard']['budgetCap'])}).",
        "labels": "Synthetic data. Counterfactuals are estimates; root causes are hypotheses.",
    }
