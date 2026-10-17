"""Synthetic retail data and static configuration (mirrors the frontend prototype)."""
import copy
from datetime import date, timedelta

START = date(2026, 9, 28)  # Mon 28 Sep 2026
DAYS = 63                  # 9 weeks
TODAY = 2                  # Wed 30 Sep 2026

EVENTS = [
    {"d": 13, "n": "Navratri"}, {"d": 22, "n": "Dussehra"}, {"d": 39, "n": "Dhanteras"},
    {"d": 41, "n": "Diwali"}, {"d": 60, "n": "Black Friday"},
]

CATS = {
    "FW": {"n": "Footwear",    "price": 2400, "margin": .44, "elast": 2.0, "cap": 30},
    "AP": {"n": "Apparel",     "price": 1800, "margin": .52, "elast": 2.0, "cap": 40},
    "BT": {"n": "Beauty",      "price": 650,  "margin": .48, "elast": 1.6, "cap": 25},
    "EL": {"n": "Electronics", "price": 3200, "margin": .34, "elast": 1.8, "cap": 15},
    "GR": {"n": "Grocery",     "price": 420,  "margin": .34, "elast": 1.2, "cap": 20},
}

REGIONS = {
    "TS": {"n": "Telangana", "city": "Hyderabad", "stores": ["Banjara Hills", "Kukatpally", "Gachibowli", "Secunderabad", "Madhapur", "LB Nagar", "Ameerpet", "Kondapur"]},
    "KA": {"n": "Karnataka", "city": "Bengaluru", "stores": ["Indiranagar", "Koramangala", "Whitefield", "Jayanagar", "HSR Layout", "Malleshwaram", "Hebbal", "Marathahalli"]},
    "MH": {"n": "Maharashtra", "city": "Pune", "stores": ["Kothrud", "Baner", "Viman Nagar", "Hadapsar", "Aundh", "Wakad", "Camp", "Kharadi"]},
    "DL": {"n": "Delhi NCR", "city": "Delhi", "stores": ["Saket", "Rajouri", "Dwarka", "Noida 18", "Gurgaon CC", "Lajpat", "Karol Bagh", "Rohini"]},
}

# [daily baseline units, available stock, in-transit]  (region level, x3 scale applied below)
_BASE = {
    "TS": {"FW": [70, 1350, 0], "AP": [55, 2600, 0],   "BT": [80, 2400, 0], "EL": [25, 700, 150],  "GR": [400, 9000, 0]},
    "KA": {"FW": [60, 1900, 0], "AP": [75, 2300, 400], "BT": [70, 2100, 0], "EL": [40, 1100, 0],   "GR": [380, 8500, 0]},
    "MH": {"FW": [55, 2600, 0], "AP": [60, 2200, 0],   "BT": [65, 1500, 0], "EL": [35, 1000, 0],   "GR": [420, 9500, 0]},
    "DL": {"FW": [65, 1700, 0], "AP": [50, 4000, 0],   "BT": [60, 1800, 0], "EL": [45, 1300, 0],   "GR": [450, 10000, 0]},
}
BASE = {r: {c: [v * 3 for v in vals] for c, vals in cats.items()} for r, cats in _BASE.items()}

AUD = {
    "all":    {"n": "All shoppers",              "reach": 1,   "share": 1,   "tier": 1},
    "uplift": {"n": "High-uplift segment (38%)", "reach": .8,  "share": .52, "tier": 2},
    "loyal":  {"n": "Loyalty members",           "reach": .6,  "share": .55, "tier": 2},
    "lapsed": {"n": "Lapsed 90-day customers",   "reach": .25, "share": .2,  "tier": 2},
}

# relative lift, and share of the headline discount that is a real cost
MECH_FX = {"% off": [1, 1], "Bundle": [.8, .6], "BOGO / multi-buy": [1.1, .6], "Free delivery": [.5, .3],
           "Points boost": [.6, .45], "EMI / exchange": [.9, .5], "Early access": [.4, .6]}
MECH = list(MECH_FX)
STATUSES = ["Draft", "Proposed", "In review", "Approved", "Live"]

ROLES = {
    "marketing": {"n": "Marketing Manager", "edit": True, "step": "Marketing"},
    "merch":     {"n": "Merchandiser", "edit": True, "step": "Merchandising"},
    "supply":    {"n": "Supply Chain", "edit": True, "step": "Supply Chain"},
    "exec":      {"n": "Executive", "edit": False, "step": "Executive"},
    "store":     {"n": "Store Manager · Hyderabad", "edit": False, "region": "TS", "noCustomer": True},
    "admin":     {"n": "Admin", "edit": True, "step": "Executive"},
}

PROFILES = {
    "fashion":     {"n": "Fashion & Footwear", "constraint": "Size coverage, season end", "levers": "Markdown timing, bundles", "kpi": "Sell-through", "chain": ["Marketing", "Merchandising", "Supply Chain", "Executive"]},
    "grocery":     {"n": "Grocery", "constraint": "Expiry, days of supply", "levers": "Markdowns, multi-buy", "kpi": "Waste reduction", "chain": ["Marketing", "Merchandising", "Executive"]},
    "electronics": {"n": "Electronics", "constraint": "Price-match, vendor funding", "levers": "EMI / exchange, accessory attach", "kpi": "Attach rate", "chain": ["Marketing", "Merchandising", "Supply Chain", "Executive"]},
    "qcom":        {"n": "Quick commerce", "constraint": "Dark-store stock, rider capacity", "levers": "Small targeted offers, slot throttling", "kpi": "Fill rate", "chain": ["Marketing", "Supply Chain", "Executive"]},
    "marketplace": {"n": "Marketplace", "constraint": "Seller co-funding, courier limits", "levers": "Co-funded deals", "kpi": "Seller-funded share", "chain": ["Marketing", "Merchandising", "Executive"]},
    "pharmacy":    {"n": "Pharmacy / Beauty", "constraint": "Regulated items, expiry", "levers": "Refill and loyalty offers", "kpi": "Repeat rate", "chain": ["Marketing", "Merchandising", "Executive"]},
}

SEASONS = {
    "regular": {"n": "Regular", "sigma": .16},
    "pre":     {"n": "Pre-festive", "sigma": .20},
    "peak":    {"n": "Peak", "sigma": .25},
    "post":    {"n": "Post-festive", "sigma": .18},
}

READY_ITEMS = [
    ("stock", "Stock in place", "Supply Chain"), ("price", "Price loaded in POS", "Merchandising"),
    ("creative", "Creative approved", "Marketing"), ("channels", "Channels scheduled", "Marketing"),
    ("supplier", "Supplier confirmed", "Supply Chain"), ("stores", "Stores briefed (signage, shelf price)", "Store Ops"),
    ("consent", "Consent & compliance check", "Legal"),
]

FORBIDDEN_TERMS = ["guaranteed", "lowest price ever", "last chance", "only today", "hurry", "act now", "100% free", "cure", "risk-free"]

LEARNING_ROWS = [
    {"campaign": "Diwali Footwear Fest", "city": "Hyderabad", "predicted_L": 21.4, "actual_L": 19.8, "uplift_pct": 14},
    {"campaign": "Delhi Festive Kicks", "city": "Delhi", "predicted_L": 14.2, "actual_L": 18.9, "uplift_pct": 11},
    {"campaign": "Glow for Diwali", "city": "Pune", "predicted_L": 6.1, "actual_L": 5.7, "uplift_pct": 9},
    {"campaign": "Festive Ethnic Wear", "city": "Bengaluru", "predicted_L": 17.5, "actual_L": 16.2, "uplift_pct": 12},
    {"campaign": "Gadget Upgrade EMI", "city": "Delhi", "predicted_L": 12.8, "actual_L": 13.4, "uplift_pct": 7},
]
FEEDBACK_TOPICS = [
    {"topic": "Size availability", "share_pct": 38, "spike": True}, {"topic": "Delivery delay", "share_pct": 21},
    {"topic": "Price / offer clarity", "share_pct": 14}, {"topic": "Product quality", "share_pct": 11},
    {"topic": "Store experience", "share_pct": 9},
]
ROOT_CAUSES = [
    {"hypothesis": "Size curve mismatch: sizes 8–9 out of stock in 60% of Delhi stores", "likelihood": 0.62},
    {"hypothesis": "Demand spike from competitor stock-out nearby", "likelihood": 0.21},
    {"hypothesis": "Push notification sent twice (channel collision)", "likelihood": 0.11},
    {"hypothesis": "Data lag in store inventory feed", "likelihood": 0.06},
]


def day_date(d: int) -> date:
    return START + timedelta(days=d)


def ds(d: int) -> str:
    x = day_date(d)
    return f"{x.day} {x.strftime('%b')}"


def seed_plan():
    def mk(id, name, region, cat, start, len_, disc, aud, budget, status, mech="% off"):
        return {"id": id, "name": name, "region": region, "cat": cat, "start": start, "len": len_,
                "disc": disc, "aud": aud, "budget": budget, "status": status, "mech": mech, "excl": False}
    return {
        "items": [
            mk("c1", "Diwali Footwear Fest", "TS", "FW", 33, 10, 25, "all", 250000, "Draft"),
            mk("c2", "Festive Ethnic Wear", "KA", "AP", 27, 14, 20, "loyal", 180000, "Proposed"),
            mk("c3", "Glow for Diwali", "MH", "BT", 35, 8, 15, "uplift", 90000, "In review"),
            mk("c4", "Gadget Upgrade EMI", "DL", "EL", 37, 7, 10, "all", 160000, "Approved", "EMI / exchange"),
            mk("c5", "Dussehra Grocery Saver", "TS", "GR", 18, 6, 12, "all", 60000, "In review", "BOGO / multi-buy"),
            mk("c6", "Delhi Festive Kicks", "DL", "FW", 34, 9, 18, "loyal", 120000, "Approved"),
            mk("c7", "Back-to-work Laptops", "KA", "EL", 0, 9, 8, "all", 80000, "Live", "EMI / exchange"),
            mk("c8", "Post-Diwali Clearance", "MH", "AP", 44, 10, 30, "all", 70000, "Draft"),
            mk("c9", "Footwear Flash Sale", "TS", "FW", 38, 6, 20, "all", 60000, "Draft"),
        ],
        "transfers": [],
    }


def default_guard():
    return {"marginFloor": 22, "budgetCap": 1000000, "stockoutMax": 25, "contactCap": 2,
            "discountCap": {k: v["cap"] for k, v in CATS.items()}, "extra": []}


def initial_state():
    return {
        "profile": "fashion", "season": "pre", "tier": 3,
        "plan": seed_plan(), "guard": default_guard(),
        "proposals": {}, "approvals": {"c3": 1, "c5": 1, "c4": 99, "c6": 99, "c7": 99},
        "readiness": {}, "overrides": {}, "crisis": None, "stress": {},
        "war": {"day": 0, "transfer": "none", "alerted": False},
        "learnGuardAdded": False, "undo": [], "redo": [], "chat": [], "seq": 100,
        "model_version": "v0.3",
    }


def clone(o):
    return copy.deepcopy(o)
