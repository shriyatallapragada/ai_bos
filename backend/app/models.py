"""Deterministic statistical services: forecast, stock, margin, Monte Carlo, constraints, optimizer.

The LLM never computes numbers; it calls these functions through tools.py.
All functions take the workspace state `st` for guardrails, data tier and season sigma.
"""
import math
import random

from .data import AUD, BASE, CATS, DAYS, EVENTS, MECH_FX, REGIONS, SEASONS, clone, ds


def sigma(st):
    return SEASONS[st["season"]]["sigma"]


def phi(z):
    return .5 * (1 + math.erf(z / math.sqrt(2)))


def _g(d, c, w):
    return math.exp(-(((d - c) / w) ** 2))


def season_mult(d, cat):
    return 1 + .75 * _g(d, 40, 4.5) + .3 * _g(d, 22, 2.5) + (.5 if cat == "EL" else .15) * _g(d, 60, 2)


def stock_of(plan, r, c):
    s = BASE[r][c][1]
    for t in plan["transfers"]:
        if t["cat"] == c:
            if t["to"] == r:
                s += t["units"]
            if t["from"] == r:
                s -= t["units"]
    return s


def sim(st, it, plan, demand_mult=1.0, lift_mult=1.0, stock=None, stock_mult=1.0):
    cat, aud, b = CATS[it["cat"]], AUD[it["aud"]], BASE[it["region"]][it["cat"]]
    B = sum(b[0] * season_mult(d, it["cat"]) for d in range(it["start"], it["start"] + it["len"]))
    if it.get("excl"):
        B *= .9
    B *= demand_mult
    d = it["disc"] / 100
    ref = b[0] * it["len"] * cat["price"] * .025
    eff = min(1.2, math.sqrt(max(it["budget"], 1) / ref))          # diminishing returns on spend
    fx = MECH_FX.get(it["mech"], [1, 1])
    lift = cat["elast"] * aud["reach"] * eff * d * fx[0] * lift_mult
    I = B * lift
    D = B + I
    stk = (stock if stock is not None else stock_of(plan, it["region"], it["cat"])) * stock_mult
    sd = sigma(st) * D
    p_stock = 1 - phi((stk - D) / sd)
    sold = min(D, stk)
    f = sold / D
    dis_u = aud["share"] * sold * fx[1]
    price = cat["price"]
    revenue = sold * price - dis_u * price * d
    gross = sold * price * cat["margin"] - dis_u * price * d
    margin_pct = (gross - it["budget"]) / revenue * 100
    inc_rev = revenue - min(B, stk) * price
    inc_units = I * f
    inc_profit = inc_units * price * cat["margin"] - dis_u * price * d - it["budget"]
    waste = max(0, dis_u - inc_units) * price * d
    dos = stk / (D / it["len"])
    return {"B": B, "I": I, "D": D, "stk": stk, "sd": sd, "pStock": p_stock, "sold": sold, "revenue": revenue,
            "gross": gross, "marginPct": margin_pct, "incRev": inc_rev, "incProfit": inc_profit, "waste": waste,
            "dos": dos, "eff": eff, "incUnits": inc_units}


def violations(st, it, m):
    v, G = [], st["guard"]
    if m["marginPct"] < G["marginFloor"]:
        v.append({"k": "margin", "t": f"Margin {m['marginPct']:.1f}% is below the {G['marginFloor']}% floor"})
    if m["pStock"] * 100 > G["stockoutMax"]:
        v.append({"k": "stock", "t": f"Stockout risk {m['pStock'] * 100:.0f}% exceeds the {G['stockoutMax']}% limit"})
    if it["disc"] > G["discountCap"][it["cat"]]:
        v.append({"k": "disc", "t": f"{it['disc']}% off exceeds the {CATS[it['cat']]['n']} cap of {G['discountCap'][it['cat']]}%"})
    if st["tier"] < 2 and AUD[it["aud"]]["tier"] > 1:
        v.append({"k": "tier", "t": "Segment targeting needs data tier 2 (customer IDs)"})
    return v


def overlap(a, b):
    return a["start"] < b["start"] + b["len"] and b["start"] < a["start"] + a["len"]


def inr(n):
    a, s = abs(n), "-" if n < 0 else ""
    if a >= 1e7:
        return f"{s}₹{a / 1e7:.2f}Cr"
    if a >= 1e5:
        return s + "₹" + f"{a / 1e5:.1f}".rstrip("0").rstrip(".") + "L"
    if a >= 1e3:
        return f"{s}₹{round(a / 1e3)}K"
    return f"{s}₹{round(a)}"


def conflicts(st, plan):
    out, its, G = [], plan["items"], st["guard"]
    for i in range(len(its)):
        for j in range(i + 1, len(its)):
            a, b = its[i], its[j]
            if overlap(a, b) and a["region"] == b["region"] and a["cat"] == b["cat"]:
                out.append({"type": "SKU overlap", "ids": [a["id"], b["id"]],
                            "text": f"{a['name']} and {b['name']} both promote {CATS[a['cat']]['n']} in {REGIONS[a['region']]['city']} on overlapping days (cannibalization)"})
    for r in REGIONS:
        worst = None
        for d in range(DAYS):
            act = [x for x in its if x["region"] == r and x["start"] <= d < x["start"] + x["len"]]
            if len(act) > G["contactCap"] and (worst is None or len(act) > worst["n"]):
                worst = {"n": len(act), "d": d, "ids": [x["id"] for x in act]}
        if worst:
            out.append({"type": "Over-contact", "ids": worst["ids"],
                        "text": f"{worst['n']} campaigns reach {REGIONS[r]['city']} shoppers on {ds(worst['d'])} (cap {G['contactCap']})"})
    spend = sum(x["budget"] for x in its)
    if spend > G["budgetCap"]:
        out.append({"type": "Budget overrun", "ids": [],
                    "text": f"Plan spend {inr(spend)} exceeds the {inr(G['budgetCap'])} budget by {inr(spend - G['budgetCap'])}"})
    return out


def max_contact(plan):
    mx = 0
    for r in REGIONS:
        for d in range(DAYS):
            mx = max(mx, sum(1 for x in plan["items"] if x["region"] == r and x["start"] <= d < x["start"] + x["len"]))
    return mx


def plan_totals(st, plan):
    spend = rev = net = inc = v2 = 0.0
    worst, n_viol, per = None, 0, {}
    for it in plan["items"]:
        m = sim(st, it, plan)
        m["viol"] = violations(st, it, m)
        per[it["id"]] = m
        spend += it["budget"]; rev += m["revenue"]; net += m["gross"] - it["budget"]; inc += m["incRev"]
        v2 += (m["sd"] * CATS[it["cat"]]["price"] * .5) ** 2
        if m["viol"]:
            n_viol += 1
        if worst is None or m["pStock"] > worst[1]["pStock"]:
            worst = (it, m)
    sd = math.sqrt(v2)
    return {"spend": spend, "rev": rev, "margin": net / rev * 100 if rev else 0, "inc": inc,
            "incLo": inc - 1.28 * sd, "incHi": inc + 1.28 * sd, "worst": worst, "nViol": n_viol,
            "conf": conflicts(st, plan), "per": per, "contact": max_contact(plan)}


def optimize(st, base, plan, floor=None, max_so=None):
    """Grid search over audience x SKU scope x discount depth under hard constraints."""
    G = st["guard"]
    floor = G["marginFloor"] if floor is None else floor
    max_so = G["stockoutMax"] if max_so is None else max_so
    auds = ["uplift", "loyal", "lapsed", "all"] if st["tier"] >= 2 else ["all"]
    best = None
    for aud in auds:
        for excl in (False, True):
            for d in range(5, G["discountCap"][base["cat"]] + 1):
                it = {**base, "aud": aud, "excl": excl, "disc": d}
                m = sim(st, it, plan)
                if m["marginPct"] < floor or m["pStock"] * 100 > max_so:
                    continue
                score = m["incProfit"] - m["pStock"] * m["revenue"] * .15
                if best is None or score > best["score"]:
                    best = {"it": it, "m": m, "score": score}
    return best


def donor_for(st, plan, region, cat):
    best = None
    for r in REGIONS:
        if r == region:
            continue
        committed = sum(sim(st, x, plan)["D"] * 1.25 for x in plan["items"] if x["region"] == r and x["cat"] == cat)
        surplus = stock_of(plan, r, cat) - committed - BASE[r][cat][0] * 14
        if best is None or surplus > best["surplus"]:
            best = {"r": r, "surplus": math.floor(surplus / 50) * 50}
    return best if best and best["surplus"] > 0 else None


def transfer_need(st, plan, it, target=.05):
    m = sim(st, it, plan)
    z = 1.645 if target <= .05 else .674
    return math.ceil(max(0, m["D"] * (1 + z * sigma(st)) - m["stk"]) / 50) * 50


def quantile(arr, p):
    s = sorted(arr)
    return s[int(p * (len(s) - 1))]


def monte_carlo(st, it, plan, n=2000, demand_mult=1.0, lift_mult=1.0, stock_mult=1.0, seed=42):
    r = random.Random(seed)
    out = []
    for _ in range(n):
        dm = max(.3, 1 + r.gauss(0, 1) * sigma(st)) * demand_mult
        lm = max(0, 1 + r.gauss(0, 1) * .15) * lift_mult
        sm = (.92 + r.random() * .08) * stock_mult
        m = sim(st, it, plan, demand_mult=dm, lift_mult=lm, stock_mult=sm)
        out.append({"rev": m["revenue"], "margin": m["marginPct"], "so": m["D"] > m["stk"], "inc": m["incRev"]})
    return out


def events_in(it):
    return [e["n"] for e in EVENTS if it["start"] <= e["d"] < it["start"] + it["len"]]


def apply_change(plan, ch):
    t = ch["type"]
    if t == "update":
        for it in plan["items"]:
            if it["id"] == ch["id"]:
                it.update(ch["patch"])
    elif t == "create":
        if not any(i["id"] == ch["item"]["id"] for i in plan["items"]):
            plan["items"].append(clone(ch["item"]))
    elif t == "delete":
        plan["items"] = [i for i in plan["items"] if i["id"] != ch["id"]]
    elif t == "transfer":
        plan["transfers"].append(clone(ch["t"]))
    return plan
