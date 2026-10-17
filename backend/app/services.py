"""Planning services = the deterministic tools the copilot calls (PDF §M2 'Tool calls the AI uses').

Read tools return facts. `propose_*` tools write ONLY to the draft layer (a proposal of change sets);
nothing here ever mutates the live plan except accept_change(), which a human must call.
"""
import math
import re

from .data import AUD, BASE, CATS, DAYS, EVENTS, FORBIDDEN_TERMS, MECH, REGIONS, STATUSES, TODAY, clone, ds
from .models import (apply_change, conflicts, donor_for, events_in, inr, monte_carlo, optimize, overlap,
                     plan_totals, quantile, season_mult, sigma, sim, stock_of, transfer_need, violations)

DIWALI_DAY = 41


class ToolError(Exception):
    """Raised for bad tool input; the message is returned to the LLM so it can self-correct."""


# ----------------------------------------------------------------- helpers
def r1(x, d=1):
    return round(float(x), d)


def get_item(st, item_id):
    for it in st["plan"]["items"]:
        if it["id"] == item_id:
            return it
    raise ToolError(f"Unknown campaign id '{item_id}'. Valid ids: {[i['id'] for i in st['plan']['items']]}")


def metrics_out(m):
    """JSON-safe, rounded metric block used by every API and tool."""
    return {
        "forecast_units": round(m["D"]), "baseline_units": round(m["B"]), "incremental_units": round(m["I"]),
        "forecast_low": round(m["D"] * (1 - 1.28 * m["sd"] / m["D"])), "forecast_high": round(m["D"] * (1 + 1.28 * m["sd"] / m["D"])),
        "stock": round(m["stk"]), "days_of_supply": r1(m["dos"]), "stockout_pct": r1(m["pStock"] * 100),
        "units_sold": round(m["sold"]), "revenue": round(m["revenue"]), "margin_pct": r1(m["marginPct"]),
        "incremental_revenue": round(m["incRev"]), "incremental_profit": round(m["incProfit"]),
        "discount_waste": round(m["waste"]), "violations": m.get("viol", []),
    }


def find_region(t):
    t = t.lower()
    pats = {"TS": r"telangana|hyderabad|\bts\b", "KA": r"karnataka|bengaluru|bangalore", "MH": r"maharashtra|pune|mumbai", "DL": r"delhi|ncr|gurgaon|noida"}
    return next((k for k, p in pats.items() if re.search(p, t)), None)


def find_cat(t):
    t = t.lower()
    pats = {"FW": r"footwear|shoe|sneaker|kicks", "AP": r"apparel|fashion|jacket|ethnic|wear|clothing", "BT": r"beauty|glow|cosmetic",
            "EL": r"electronic|gadget|laptop|phone", "GR": r"grocery|staples|food"}
    return next((k for k, p in pats.items() if re.search(p, t)), None)


def norm_region(v):
    if v is None:
        return None
    v = str(v)
    if v.upper() in REGIONS:
        return v.upper()
    r = find_region(v)
    if not r:
        raise ToolError(f"Unknown region '{v}'. Use one of {list(REGIONS)}")
    return r


def norm_cat(v):
    if v is None:
        return None
    v = str(v)
    if v.upper() in CATS:
        return v.upper()
    c = find_cat(v)
    if not c:
        raise ToolError(f"Unknown category '{v}'. Use one of {list(CATS)}")
    return c


def visible_items(st, role_cfg):
    reg = (role_cfg or {}).get("region")
    return [i for i in st["plan"]["items"] if not reg or i["region"] == reg]


# ----------------------------------------------------------------- read tools
def plan_view(st, role_cfg=None):
    T = plan_totals(st, st["plan"])
    items = []
    for it in visible_items(st, role_cfg):
        m = T["per"][it["id"]]
        items.append({**it, "range": f"{ds(it['start'])} – {ds(it['start'] + it['len'] - 1)}", "city": REGIONS[it["region"]]["city"],
                      "metrics": metrics_out(m), "events": events_in(it)})
    return {
        "items": items,
        "totals": {"spend": round(T["spend"]), "budget_cap": st["guard"]["budgetCap"], "revenue": round(T["rev"]),
                   "plan_margin_pct": r1(T["margin"]), "incremental_revenue": round(T["inc"]),
                   "incremental_revenue_low": round(T["incLo"]), "incremental_revenue_high": round(T["incHi"]),
                   "campaigns_breaking_rules": T["nViol"], "max_contact_pressure": T["contact"],
                   "worst_stockout": {"id": T["worst"][0]["id"], "name": T["worst"][0]["name"], "stockout_pct": r1(T["worst"][1]["pStock"] * 100)} if T["worst"] else None},
        "conflicts": T["conf"], "transfers": st["plan"]["transfers"], "guard": st["guard"],
    }


def get_forecast(st, region, cat, start=None, length=14):
    region, cat = norm_region(region), norm_cat(cat)
    start = TODAY if start is None else int(start)
    length = max(1, min(int(length), DAYS - start))
    b = BASE[region][cat]
    daily = [{"day": ds(d), "units": round(b[0] * season_mult(d, cat)),
              "low": round(b[0] * season_mult(d, cat) * (1 - 1.28 * sigma(st))), "high": round(b[0] * season_mult(d, cat) * (1 + 1.28 * sigma(st)))}
             for d in range(start, start + length)]
    total = sum(b[0] * season_mult(d, cat) for d in range(start, start + length))
    return {"region": REGIONS[region]["n"], "category": CATS[cat]["n"], "window": f"{ds(start)} – {ds(start + length - 1)}",
            "baseline_daily_units": b[0], "total_units": round(total), "interval_80": [round(total * (1 - 1.28 * sigma(st))), round(total * (1 + 1.28 * sigma(st)))],
            "events": [e["n"] for e in EVENTS if start <= e["d"] < start + length], "daily": daily[:21]}


def get_inventory(st, region=None, cat=None):
    region, cat = norm_region(region), norm_cat(cat)
    rows = []
    for r in REGIONS:
        for c in CATS:
            if (region and r != region) or (cat and c != cat):
                continue
            avail, transit = stock_of(st["plan"], r, c), BASE[r][c][2]
            rows.append({"region": r, "city": REGIONS[r]["city"], "cat": c, "category": CATS[c]["n"], "available": round(avail), "in_transit": transit,
                         "days_of_supply": r1(avail / BASE[r][c][0]),
                         "inventory_confidence": 0.92 if transit == 0 else 0.78,
                         "flag": "in-transit dependency" if transit else ("aging/overstock" if avail / BASE[r][c][0] > 55 else "ok")})
    return {"rows": rows}


def get_segments(st):
    return {"data_tier": st["tier"], "segments": [
        {"id": k, "name": v["n"], "reach_strength": v["reach"], "share_of_discounted_units": v["share"],
         "available": st["tier"] >= v["tier"], "needs_tier": v["tier"]} for k, v in AUD.items()],
        "note": "Pseudonymized IDs; sensitive attributes and proxies excluded. Offers, not individual prices."}


def simulate_item(st, item_id=None, overrides=None, demand_mult=1.0, lift_mult=1.0, stock_mult=1.0):
    overrides = overrides or {}
    base = clone(get_item(st, item_id)) if item_id else {"id": "adhoc", "name": "Ad-hoc", "region": "TS", "cat": "FW", "start": 33, "len": 10, "disc": 15,
                                                          "aud": "all", "budget": 60000, "status": "Draft", "mech": "% off", "excl": False}
    for k, v in overrides.items():
        if k in ("region", "cat"):
            v = norm_region(v) if k == "region" else norm_cat(v)
        if k in ("disc", "start", "len", "budget"):
            v = int(v)
        base[k] = v
    if base["aud"] not in AUD:
        raise ToolError(f"aud must be one of {list(AUD)}")
    if base["mech"] not in MECH:
        raise ToolError(f"mech must be one of {MECH}")
    m = sim(st, base, st["plan"], demand_mult=demand_mult, lift_mult=lift_mult, stock_mult=stock_mult)
    m["viol"] = violations(st, base, m)
    return {"item": base, "metrics": metrics_out(m)}


def check_constraints(st, item_id=None):
    if item_id:
        it = get_item(st, item_id)
        m = sim(st, it, st["plan"])
        v = violations(st, it, m)
        return {"id": item_id, "name": it["name"], "ok": not v, "violations": v}
    T = plan_totals(st, st["plan"])
    return {"ok": T["nViol"] == 0 and not T["conf"], "campaigns": [{"id": i["id"], "name": i["name"], "violations": T["per"][i["id"]]["viol"]}
                                                                    for i in st["plan"]["items"] if T["per"][i["id"]]["viol"]], "conflicts": T["conf"]}


def find_conflicts(st):
    return {"conflicts": conflicts(st, st["plan"])}


def suggest_transfer(st, item_id):
    it = get_item(st, item_id)
    donor = donor_for(st, st["plan"], it["region"], it["cat"])
    need = transfer_need(st, st["plan"], it)
    if not donor:
        return {"id": item_id, "units_needed": need, "donor": None, "note": "No region has surplus stock for this category."}
    units = min(need, donor["surplus"])
    return {"id": item_id, "units_needed": need, "donor": REGIONS[donor["r"]]["city"], "donor_surplus": donor["surplus"], "suggested_units": units,
            "lead_time_days": 2, "arrives_before": ds(it["start"]), "from": donor["r"], "to": it["region"], "cat": it["cat"]}


def optimize_item(st, item_id, floor=None, max_stockout=None):
    it = get_item(st, item_id)
    best = optimize(st, clone(it), st["plan"], floor=floor, max_so=max_stockout)
    if not best:
        return {"id": item_id, "feasible": False, "note": "No audience/discount combination satisfies the margin floor and stockout limit. Consider a stock transfer or smaller scope."}
    b = best["it"]
    m = best["m"]; m["viol"] = violations(st, b, m)
    return {"id": item_id, "feasible": True, "discount": b["disc"], "audience": b["aud"], "audience_name": AUD[b["aud"]]["n"], "exclude_low_stock_skus": b["excl"],
            "metrics": metrics_out(m), "searched": f"{len(AUD) if st['tier'] >= 2 else 1} audiences x 2 scopes x {st['guard']['discountCap'][it['cat']] - 4} discount levels"}


def explain_discount(st, item_id, levels=None):
    it = get_item(st, item_id)
    aud = "uplift" if it["aud"] == "all" and st["tier"] >= 2 else it["aud"]
    if levels is not None and not isinstance(levels, (list, tuple)):
        levels = re.findall(r"\d+", str(levels))
    try:
        levels = sorted({int(x) for x in (levels or [10, 16, 20, 25])} | {it["disc"]})
    except (TypeError, ValueError):
        raise ToolError("levels must be a list of integer discount percentages, e.g. [10, 16, 20]")
    rows = []
    for d in levels:
        x = {**it, "disc": d, "aud": aud}
        m = sim(st, x, st["plan"]); v = violations(st, x, m)
        rows.append({"discount": d, "incremental_profit": round(m["incProfit"]), "margin_pct": r1(m["marginPct"]), "stockout_pct": r1(m["pStock"] * 100),
                     "discount_waste": round(m["waste"]), "feasible": not v, "violations": [y["t"] for y in v]})
    ok = [r for r in rows if r["feasible"]]
    best = max(ok, key=lambda r: r["incremental_profit"]) if ok else None
    return {"id": item_id, "audience": AUD[aud]["n"], "alternatives": rows, "best_feasible_discount": best["discount"] if best else None,
            "drivers": {"price_elasticity": CATS[it["cat"]]["elast"], "discounted_share_of_buyers_pct": round(AUD[aud]["share"] * 100),
                        "stock_ceiling_units": round(stock_of(st["plan"], it["region"], it["cat"])),
                        "constraints": {"margin_floor_pct": st["guard"]["marginFloor"], "stockout_max_pct": st["guard"]["stockoutMax"], "discount_cap_pct": st["guard"]["discountCap"][it["cat"]]}},
            "evidence": "moderate: elasticity fitted on a small sample of past promos; pilot in 2 stores first"}


# ----------------------------------------------------------------- proposals (draft layer)
def confidence(it):
    if it["aud"] == "lapsed":
        return {"evidence": "Weak", "action": "experiment", "advice": "Run as a 2-store experiment first"}
    if it["cat"] in ("GR", "EL"):
        return {"evidence": "Strong", "action": "proceed", "advice": "Proceed"}
    return {"evidence": "Moderate", "action": "pilot", "advice": "Pilot in 2 stores, then scale"}


def _change_target(st, ch):
    if ch["type"] == "create":
        return ch["item"]["id"]
    if ch["type"] == "transfer":
        t = next((i for i in st["plan"]["items"] if i["region"] == ch["t"]["to"] and i["cat"] == ch["t"]["cat"]), None)
        return t["id"] if t else None
    return ch.get("id")


def diff_for(st, plan, ch):
    before = plan_totals(st, plan)
    p = clone(plan)
    apply_change(p, ch)
    after = plan_totals(st, p)
    tid = _change_target({"plan": plan}, ch)
    b, a = before["per"].get(tid), after["per"].get(tid)
    out = {"target": tid}
    if a:
        out["stockout_pct"] = {"before": r1(b["pStock"] * 100) if b else None, "after": r1(a["pStock"] * 100)}
        out["margin_pct"] = {"before": r1(b["marginPct"]) if b else None, "after": r1(a["marginPct"])}
    out["incremental_revenue"] = {"before": round(before["inc"]), "after": round(after["inc"])}
    out["spend"] = {"before": round(before["spend"]), "after": round(after["spend"])}
    out["rule_violations"] = {"before": before["nViol"], "after": after["nViol"]}
    out["contact_pressure"] = {"before": before["contact"], "after": after["contact"]}
    return out


def new_proposal(ws, title, changes, evidence="Moderate", note="", source="ai", recommendation=None):
    """Validate every change against hard rules, then store as a draft. Never touches the live plan."""
    st = ws.st
    pid = ws.nid("p")
    for c in changes:
        c["cid"] = ws.nid("ch"); c["st"] = "pending"; c["pid"] = pid
        c["diff"] = diff_for(st, st["plan"], c)
    p2 = clone(st["plan"])
    for c in changes:
        apply_change(p2, c)
    after = plan_totals(st, p2)
    before = plan_totals(st, st["plan"])
    prop = {"id": pid, "title": title, "changes": changes, "evidence": evidence, "note": note, "author": source,
            "recommendation": recommendation or {"Strong": "proceed", "Moderate": "pilot", "Weak": "experiment"}.get(evidence, "pilot"),
            "validation": {"rule_violations_after": after["nViol"], "conflicts_after": len(after["conf"]), "blocked": False,
                           "warning": ("Applying every change still leaves %d campaign(s) breaking hard rules." % after["nViol"]) if after["nViol"] else None},
            "set_diff": {"stockout_pct_worst": {"before": r1(before["worst"][1]["pStock"] * 100), "after": r1(after["worst"][1]["pStock"] * 100)},
                         "plan_margin_pct": {"before": r1(before["margin"]), "after": r1(after["margin"])},
                         "incremental_revenue": {"before": round(before["inc"]), "after": round(after["inc"]), "after_low": round(after["incLo"]), "after_high": round(after["incHi"])},
                         "spend": {"before": round(before["spend"]), "after": round(after["spend"])},
                         "rule_violations": {"before": before["nViol"], "after": after["nViol"]}},
            "status": "pending"}
    st["proposals"][pid] = prop
    ws.audit("AI Copilot" if source == "ai" else source, "Proposed change set", f"{title} ({len(changes)} changes)", src=source)
    return prop


def build_fix(ws, it):
    st = ws.st
    changes = []
    donor = donor_for(st, st["plan"], it["region"], it["cat"])
    p2 = clone(st["plan"])
    if donor:
        p2["transfers"].append({"from": donor["r"], "to": it["region"], "cat": it["cat"], "units": donor["surplus"]})
    best = optimize(st, clone(it), p2)
    if not best:
        return None
    b, G = best["it"], st["guard"]
    if b["disc"] != it["disc"]:
        changes.append({"type": "update", "id": it["id"], "patch": {"disc": b["disc"]}, "label": f"Cut discount {it['disc']}% → {b['disc']}%",
                        "why": f"Highest incremental profit that clears the {G['marginFloor']}% margin floor. Deeper discounts mostly subsidise shoppers who would buy anyway."})
    if b["aud"] != it["aud"]:
        changes.append({"type": "update", "id": it["id"], "patch": {"aud": b["aud"]}, "label": f"Target “{AUD[b['aud']]['n']}” instead of “{AUD[it['aud']]['n']}”",
                        "why": f"Uplift model: this segment responds {round(AUD[b['aud']]['reach'] / AUD[it['aud']]['reach'] * 100)}% as strongly while receiving only {round(AUD[b['aud']]['share'] * 100)}% of discounted units. That cuts discount waste."})
    if b["excl"] != it.get("excl"):
        changes.append({"type": "update", "id": it["id"], "patch": {"excl": b["excl"]}, "label": "Exclude low-stock SKUs / sizes",
                        "why": "Removes sizes with under 3 units per store, which avoids stranded demand."})
    ref = BASE[it["region"]][it["cat"]][0] * it["len"] * CATS[it["cat"]]["price"] * .025
    eff = math.ceil(ref * 1.44 / 10000) * 10000
    spend = sum(x["budget"] for x in st["plan"]["items"])
    if it["budget"] > eff * 1.05:
        changes.append({"type": "update", "id": it["id"], "patch": {"budget": eff}, "label": f"Trim budget {inr(it['budget'])} → {inr(eff)}",
                        "why": f"Response curve is flat above {inr(eff)} (diminishing reach)." + (f" Also brings the plan back toward the {inr(G['budgetCap'])} cap." if spend > G["budgetCap"] else "")})
    pa = clone(st["plan"])
    for c in changes:
        apply_change(pa, c)
    need = transfer_need(st, pa, next(x for x in pa["items"] if x["id"] == it["id"]))
    if need > 0 and donor:
        units = min(need, donor["surplus"])
        changes.append({"type": "transfer", "t": {"from": donor["r"], "to": it["region"], "cat": it["cat"], "units": units},
                        "label": f"Transfer {units} units from {REGIONS[donor['r']]['city']} → {REGIONS[it['region']]['city']}",
                        "why": f"{REGIONS[donor['r']]['city']} holds {round(stock_of(st['plan'], donor['r'], it['cat']))} {CATS[it['cat']]['n'].lower()} units with {round(donor['surplus'])} surplus after its own plans. 2-day lead time; arrives before {ds(it['start'])}."})
    for x in st["plan"]["items"]:
        if x["id"] != it["id"] and x["region"] == it["region"] and x["cat"] == it["cat"] and overlap(x, it):
            changes.append({"type": "delete", "id": x["id"], "label": f"Merge “{x['name']}” into this campaign",
                            "why": f"Overlaps {x['len']} days on the same SKUs and audience, which cannibalizes demand and adds contact pressure."})
    return {"title": f"Fix: {it['name']}", "changes": changes, "evidence": confidence(it)["evidence"]}


def propose_fix(ws, item_id):
    st = ws.st
    it = get_item(st, item_id)
    m = sim(st, it, st["plan"]); v = violations(st, it, m)
    fix = build_fix(ws, it)
    if not fix:
        return {"proposal": None, "note": f"No feasible fix for {it['name']} under current guardrails; consider a stock transfer or a narrower scope first."}
    if not fix["changes"]:
        return {"proposal": None, "note": f"{it['name']} is already close to optimal (margin {m['marginPct']:.1f}%, stockout {m['pStock'] * 100:.0f}%). No changes suggested."}
    p = new_proposal(ws, fix["title"], fix["changes"], fix["evidence"])
    return {"proposal": p, "before": {"stockout_pct": r1(m["pStock"] * 100), "margin_pct": r1(m["marginPct"]), "rules_broken": len(v)}}


def worst_item(st, role_cfg=None):
    T = plan_totals(st, st["plan"])
    vis = visible_items(st, role_cfg)
    bad = sorted([i for i in vis if T["per"][i["id"]]["viol"]], key=lambda i: -T["per"][i["id"]]["pStock"])
    return bad[0] if bad else (T["worst"][0] if T["worst"] else None)


def gap_candidate(st):
    best = None
    for r in REGIONS:
        for c in CATS:
            cov = stock_of(st["plan"], r, c) / BASE[r][c][0]
            active = any(i["region"] == r and i["cat"] == c and i["start"] < DIWALI_DAY for i in st["plan"]["items"])
            if not active and cov > 55 and (best is None or cov > best["cov"]):
                best = {"r": r, "c": c, "cov": cov}
    if best:
        best["units"] = round(stock_of(st["plan"], best["r"], best["c"]))
        best["text"] = (f"{REGIONS[best['r']]['city']} has {best['units']:,} {'aging jackets / apparel' if best['c'] == 'AP' else CATS[best['c']]['n'].lower()} units "
                        f"({round(best['cov'])} days of cover) and no campaign before Diwali.")
    return best


def propose_gap_fill(ws):
    st = ws.st
    gap = gap_candidate(st)
    if not gap:
        return {"proposal": None, "note": "No meaningful gaps: every overstocked row already has a campaign before Diwali."}
    name = f"Aging Jacket Clearance · {REGIONS[gap['r']]['city']}" if gap["c"] == "AP" else f"{CATS[gap['c']]['n']} Clearance · {REGIONS[gap['r']]['city']}"
    base = {"id": ws.nid("c"), "name": name, "region": gap["r"], "cat": gap["c"], "start": 14, "len": 8, "disc": 20, "aud": "all", "budget": 60000,
            "status": "Proposed", "mech": "% off", "excl": False}
    best = optimize(st, base, st["plan"])
    it = {**best["it"], "excl": False} if best else base
    m = sim(st, it, st["plan"])
    ch = [{"type": "create", "item": it, "label": f"Create “{it['name']}” · {ds(it['start'])} – {ds(it['start'] + it['len'] - 1)} · {it['disc']}% · {AUD[it['aud']]['n']}",
           "why": f"Clears ~{round(m['sold'])} units ({round(m['sold'] / m['stk'] * 100)}% of stock) at {m['marginPct']:.1f}% margin. Budget {inr(it['budget'])} fits under the cap."}]
    return {"gap": gap["text"], "proposal": new_proposal(ws, "Fill gap: clearance", ch, "Moderate")}


def parse_brief_text(text):
    t = text.lower()
    bm = re.search(r"(\d+(?:\.\d+)?)\s*(l|lakh|lac|cr|crore|k)\b", t)
    budget = None
    if bm:
        mult = {"l": 1e5, "lakh": 1e5, "lac": 1e5, "cr": 1e7, "crore": 1e7, "k": 1e3}[bm.group(2)]
        budget = float(bm.group(1)) * mult
    mm = re.search(r"margin\s*(?:≥|>=|>|of|at least|above)?\s*(\d+)", t)
    return {"budget": budget, "region": find_region(t), "cat": find_cat(t), "margin_floor": int(mm.group(1)) if mm else None,
            "goal": "clear" if re.search(r"clear|liquidat|excess|aging|ageing", t) else "revenue", "before_diwali": "before diwali" in t}


def propose_from_brief(ws, budget=None, region=None, cat=None, margin_floor=None, goal="clear", before_diwali=True):
    st = ws.st
    G = st["guard"]
    region, cat = norm_region(region) or "TS", norm_cat(cat) or "FW"
    budget = float(budget) if budget else 100000.0
    floor = int(margin_floor) if margin_floor else G["marginFloor"]
    parsed = {"budget": budget, "region": REGIONS[region]["n"], "category": CATS[cat]["n"], "goal": goal, "margin_floor_pct": floor, "end_before_diwali": bool(before_diwali)}
    existing = next((i for i in st["plan"]["items"] if i["region"] == region and i["cat"] == cat and i["start"] < DIWALI_DAY and i["start"] + i["len"] > 25), None)
    if existing:
        if floor != G["marginFloor"] and not optimize(st, clone(existing), st["plan"], floor=floor):
            return {"parsed_brief": parsed, "proposal": None,
                    "note": f"No feasible plan: every discount/audience combination for {existing['name']} breaks margin >= {floor}% or the stockout limit. Try a smaller scope or a stock transfer first."}
        res = propose_fix(ws, existing["id"])
        res["parsed_brief"] = parsed
        res["note"] = f"A campaign already exists for this scope ({existing['name']}), so the optimizer improved it instead of adding a duplicate. " + res.get("note", "")
        return res
    length = 10
    start = DIWALI_DAY - length if before_diwali else TODAY + 10
    room = max(20000, G["budgetCap"] - sum(x["budget"] for x in st["plan"]["items"]))
    base = {"id": ws.nid("c"), "name": f"{'Clearance' if goal == 'clear' else 'Festive'} {CATS[cat]['n']} · {REGIONS[region]['city']}", "region": region, "cat": cat,
            "start": start, "len": length, "disc": 15, "aud": "uplift", "budget": min(budget, room, 150000), "status": "Proposed", "mech": "% off", "excl": False}
    best = optimize(st, base, st["plan"], floor=floor)
    if not best:
        return {"parsed_brief": parsed, "proposal": None, "note": f"No feasible plan: every discount/audience combination breaks margin >= {floor}% or the stockout limit. Try a smaller scope or a stock transfer first."}
    it, m = best["it"], best["m"]
    why = f"Optimizer pick. Sells ~{round(m['sold'])} units, margin {m['marginPct']:.1f}%, stockout {m['pStock'] * 100:.0f}%."
    if it["budget"] < budget:
        why += f" Budget capped at {inr(it['budget'])}: returns flatten above that and plan headroom is limited."
    ch = [{"type": "create", "item": it, "label": f"Create “{it['name']}” · {ds(it['start'])} – {ds(it['start'] + it['len'] - 1)} · {it['disc']}% · {AUD[it['aud']]['n']} · {inr(it['budget'])}", "why": why}]
    return {"parsed_brief": parsed, "proposal": new_proposal(ws, "Brief → draft plan", ch, "Moderate")}


def propose_reschedule(ws, item_id, days):
    st = ws.st
    it = get_item(st, item_id)
    days = int(days)
    ns = max(0, min(it["start"] + days, DAYS - it["len"]))
    m0, m1 = sim(st, it, st["plan"]), sim(st, {**it, "start": ns}, st["plan"])
    ch = [{"type": "update", "id": it["id"], "patch": {"start": ns}, "label": f"Move “{it['name']}” to {ds(ns)} – {ds(ns + it['len'] - 1)}",
           "why": f"{', '.join(events_in({**it, 'start': ns})) or 'No festival'} in window. Demand forecast {round(m0['D'])} → {round(m1['D'])} units."}]
    return {"proposal": new_proposal(ws, "Reschedule", ch, "Strong"), "forecast_units": {"before": round(m0["D"]), "after": round(m1["D"])}}


def propose_budget_split(ws, region_a, region_b, share_a=60):
    st = ws.st
    ra, rb = norm_region(region_a), norm_region(region_b)
    a = float(share_a) / 100
    a = a if a <= 1 else a / 100
    b = 1 - a
    ia = [i for i in st["plan"]["items"] if i["region"] == ra]
    ib = [i for i in st["plan"]["items"] if i["region"] == rb]
    pool = sum(x["budget"] for x in ia + ib)
    changes = []
    for its, share in ((ia, a), (ib, b)):
        tot = sum(x["budget"] for x in its) or 1
        for x in its:
            nb = round(pool * share * x["budget"] / tot / 5000) * 5000
            if nb != x["budget"]:
                changes.append({"type": "update", "id": x["id"], "patch": {"budget": nb}, "label": f"{x['name']}: budget {inr(x['budget'])} → {inr(nb)}",
                                "why": f"{REGIONS[x['region']]['n']} share {round(share * 100)}%"})
    if not changes:
        return {"proposal": None, "note": "Budgets already match that split."}
    return {"pooled_budget": round(pool), "proposal": new_proposal(ws, f"Split budget {round(a * 100)}/{round(b * 100)}", changes, "Strong")}


def propose_budget_whatif(ws, target):
    st = ws.st
    target = float(target)
    T0 = plan_totals(st, st["plan"])
    p = clone(st["plan"])
    changes = []
    spend = sum(x["budget"] for x in p["items"])
    ranked = sorted([i for i in p["items"] if i["status"] not in ("Live", "Approved")], key=lambda i: sim(st, i, p)["incProfit"] / i["budget"])
    for i in ranked:
        if spend <= target:
            break
        cut = min(i["budget"] - 20000, spend - target)
        if cut <= 0:
            continue
        nb = round((i["budget"] - cut) / 5000) * 5000
        changes.append({"type": "update", "id": i["id"], "patch": {"budget": nb}, "label": f"{i['name']}: {inr(i['budget'])} → {inr(nb)}",
                        "why": f"Lowest return per ₹ ({sim(st, i, p)['incProfit'] / i['budget']:.2f}x)"})
        spend -= i["budget"] - nb
        i["budget"] = nb
    T1 = plan_totals(st, p)
    res = {"target_budget": round(target), "now": {"spend": round(T0["spend"]), "incremental_revenue": round(T0["inc"]), "plan_margin_pct": r1(T0["margin"]), "rule_violations": T0["nViol"]},
           "at_target": {"spend": round(T1["spend"]), "incremental_revenue": round(T1["inc"]), "plan_margin_pct": r1(T1["margin"]), "rule_violations": T1["nViol"]},
           "unreachable": spend > target, "floor_without_cutting_approved": round(spend)}
    res["proposal"] = new_proposal(ws, f"What-if: budget {inr(target)}", changes, "Moderate") if changes else None
    return res


def propose_update(ws, item_id, patch):
    """Generic, validated edit (e.g. 'make the discount 18%'). Lands in the draft layer like everything else."""
    st = ws.st
    it = get_item(st, item_id)
    allowed = {"disc", "aud", "budget", "start", "len", "mech", "excl"}
    bad = set(patch) - allowed
    if bad:
        raise ToolError(f"Cannot edit {sorted(bad)}. Editable fields: {sorted(allowed)}")
    patch = dict(patch)
    for k in ("disc", "budget", "start", "len"):
        if k in patch:
            patch[k] = int(patch[k])
    if "aud" in patch and patch["aud"] not in AUD:
        raise ToolError(f"aud must be one of {list(AUD)}")
    if "mech" in patch and patch["mech"] not in MECH:
        raise ToolError(f"mech must be one of {MECH}")
    cap = st["guard"]["discountCap"][it["cat"]]
    if patch.get("disc", 0) > cap:
        alt = optimize(st, clone(it), st["plan"])
        return {"proposal": None, "blocked": True, "reason": f"{patch['disc']}% exceeds the {CATS[it['cat']]['n']} cap of {cap}%.",
                "feasible_alternative": {"discount": alt["it"]["disc"], "audience": AUD[alt["it"]["aud"]]["n"]} if alt else None}
    label = ", ".join(f"{k} {it.get(k)} → {v}" for k, v in patch.items())
    ch = [{"type": "update", "id": it["id"], "patch": patch, "label": f"{it['name']}: {label}", "why": "Requested edit; validated by the simulator before showing."}]
    return {"proposal": new_proposal(ws, f"Edit: {it['name']}", ch, confidence({**it, **patch})["evidence"])}


# ----------------------------------------------------------------- human decisions on proposals
def _find_change(st, pid, cid):
    p = st["proposals"].get(pid)
    if not p:
        raise ToolError(f"Unknown proposal '{pid}'")
    c = next((x for x in p["changes"] if x["cid"] == cid), None)
    if not c:
        raise ToolError(f"Unknown change '{cid}'")
    return p, c


def _refresh_status(p):
    sts = {c["st"] for c in p["changes"]}
    p["status"] = "pending" if "pending" in sts else ("accepted" if sts == {"accepted"} else "rejected" if sts == {"rejected"} else "partial")


def decide_change(ws, pid, cid, ok, who, patch=None):
    """Human-only: accept (optionally with edits) or reject a single change."""
    st = ws.st
    p, c = _find_change(st, pid, cid)
    if c["st"] != "pending":
        raise ToolError("Change already decided")
    if not ok:
        c["st"] = "rejected"
        ws.audit(who, "Rejected AI change", c["label"])
    else:
        if patch and c["type"] == "update":
            c["patch"] = {**c["patch"], **patch}
            c["label"] += " (edited by user)"
        elif patch and c["type"] == "create":
            c["item"] = {**c["item"], **patch}
            c["label"] += " (edited by user)"
        ws.push_undo()
        apply_change(st["plan"], c)
        c["st"] = "accepted"
        ws.audit(who, "Accepted AI change", c["label"])
    _refresh_status(p)
    return p


def decide_all(ws, pid, ok, who):
    st = ws.st
    p = st["proposals"].get(pid)
    if not p:
        raise ToolError(f"Unknown proposal '{pid}'")
    pending = [c for c in p["changes"] if c["st"] == "pending"]
    if ok and pending:
        ws.push_undo()
    for c in pending:
        if ok:
            apply_change(st["plan"], c); c["st"] = "accepted"
            ws.audit(who, "Accepted AI change", c["label"])
        else:
            c["st"] = "rejected"
            ws.audit(who, "Rejected AI change", c["label"])
    _refresh_status(p)
    return p


def pending_ghosts(st):
    """Plan with all pending changes overlaid, for ghost-card rendering (not persisted)."""
    p = clone(st["plan"])
    out = []
    for pr in st["proposals"].values():
        for c in pr["changes"]:
            if c["st"] == "pending":
                apply_change(p, c)
                out.append({"pid": pr["id"], "cid": c["cid"], "type": c["type"], "label": c["label"], "target": c["diff"].get("target")})
    return {"ghosts": out, "plan_with_pending_totals": {k: v for k, v in _brief_totals(st, p).items()}}


def _brief_totals(st, plan):
    T = plan_totals(st, plan)
    return {"spend": round(T["spend"]), "plan_margin_pct": r1(T["margin"]), "incremental_revenue": round(T["inc"]), "rule_violations": T["nViol"], "conflicts": len(T["conf"])}


# ----------------------------------------------------------------- creative (text only, guardrailed)
def copy_for(st, it, tone="standard"):
    city, c, off, end = REGIONS[it["region"]]["city"], CATS[it["cat"]]["n"], it["disc"], ds(it["start"] + it["len"] - 1)
    sets = {
        "standard": {"headline": f"{c} for the festive season, up to {off}% off", "push": f"Your Diwali look starts here: {off}% off selected {c.lower()} at {city} stores & online. Offer ends {end}.",
                     "whatsapp": f"Hi! 🪔 Diwali is almost here. Enjoy {off}% off selected {c.lower()} till {end}. T&C apply.", "banner": f"Up to {off}% off {c} · Till {end}"},
        "premium": {"headline": f"Crafted for celebration. {c}, now {off}% off", "push": f"An invitation to celebrate: the festive {c.lower()} edit, {off}% off for a limited period.",
                    "whatsapp": f"Namaste 🪔 Our festive {c.lower()} edit is {off}% off until {end}. T&C apply.", "banner": f"The Festive Edit · {off}% off"},
        "hindi": {"headline": f"त्योहार की ख़ुशियाँ, {c} पर {off}% तक की छूट", "push": f"इस दिवाली {city} में चुनिंदा {c} पर {off}% की छूट। ऑफ़र {end} तक।",
                  "whatsapp": f"नमस्ते 🪔 दिवाली ऑफ़र: चुनिंदा {c} पर {off}% छूट। नियम व शर्तें लागू।", "banner": f"{c} पर {off}% तक छूट"},
        "telugu": {"headline": f"పండుగ సంబరాలు, {c} పై {off}% వరకు తగ్గింపు", "push": f"ఈ దీపావళికి {city}లో ఎంపిక చేసిన {c} పై {off}% తగ్గింపు.",
                   "whatsapp": f"నమస్తే 🪔 దీపావళి ఆఫర్: {c} పై {off}% తగ్గింపు. షరతులు వర్తిస్తాయి.", "banner": f"{c} పై {off}% తగ్గింపు"},
    }
    return sets.get(tone, sets["standard"])


def check_copy(text, item=None):
    """Creative guardrails: forbidden terms, fake urgency, T&C/disclaimer, honest discount."""
    low = text.lower()
    issues = [f"Forbidden/overclaiming term: '{t}'" for t in FORBIDDEN_TERMS if t in low]
    if re.search(r"only \d+ (left|remaining)|selling fast|ends in \d+ ?(min|hour)", low):
        issues.append("Fake-urgency pattern")
    if item:
        for n in re.findall(r"(\d+)\s*%", text):
            if int(n) > item["disc"]:
                issues.append(f"Claims {n}% off but the campaign discount is {item['disc']}%")
    has_tc = bool(re.search(r"t&c|terms|नियम|షరతు", low))
    return {"ok": not issues, "issues": issues, "disclaimer_present": has_tc,
            "note": "Add 'T&C apply' for WhatsApp/push templates" if not has_tc else "Disclaimer present"}


def draft_copy(st, item_id, tone="standard"):
    it = get_item(st, item_id)
    cp = copy_for(st, it, tone)
    checks = {k: check_copy(v, it) for k, v in cp.items()}
    return {"id": item_id, "tone": tone, "copy": cp, "guardrails": {"ok": all(c["ok"] for c in checks.values()), "per_channel": checks},
            "note": "Copy tweaks are pre-approved as low-risk but logged. Final sign-off happens in Readiness & Approval."}
