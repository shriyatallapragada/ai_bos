'use strict';
/* =====================================================================
   AI BOS · Business Operations System — prototype
   Everything runs in the browser on synthetic data. Numbers shown by the
   copilot always come from the simulator / optimizer functions below;
   the copilot text layer never invents figures.
   ===================================================================== */

/* ---------------- Constants & synthetic data ---------------- */
const START = new Date(2026, 8, 28);           // Mon 28 Sep 2026
const DAYS = 63;                               // 9 weeks
const TODAY = 2;                               // Wed 30 Sep 2026
const EVENTS = [
  { d: 13, n: 'Navratri' }, { d: 22, n: 'Dussehra' }, { d: 39, n: 'Dhanteras' },
  { d: 41, n: 'Diwali' }, { d: 60, n: 'Black Friday' }
];
const CATS = {
  FW: { n: 'Footwear',    color: '#1f3b73', price: 2400, margin: .44, elast: 2.0, cap: 30 },
  AP: { n: 'Apparel',     color: '#4f7cac', price: 1800, margin: .52, elast: 2.0, cap: 40 },
  BT: { n: 'Beauty',      color: '#b08a4a', price: 650,  margin: .48, elast: 1.6, cap: 25 },
  EL: { n: 'Electronics', color: '#6b8f71', price: 3200, margin: .34, elast: 1.8, cap: 15 },
  GR: { n: 'Grocery',     color: '#9c6b5e', price: 420,  margin: .34, elast: 1.2, cap: 20 }
};
const REGIONS = {
  TS: { n: 'Telangana',   city: 'Hyderabad', stores: ['Banjara Hills','Kukatpally','Gachibowli','Secunderabad','Madhapur','LB Nagar','Ameerpet','Kondapur'] },
  KA: { n: 'Karnataka',   city: 'Bengaluru', stores: ['Indiranagar','Koramangala','Whitefield','Jayanagar','HSR Layout','Malleshwaram','Hebbal','Marathahalli'] },
  MH: { n: 'Maharashtra', city: 'Pune',      stores: ['Kothrud','Baner','Viman Nagar','Hadapsar','Aundh','Wakad','Camp','Kharadi'] },
  DL: { n: 'Delhi NCR',   city: 'Delhi',     stores: ['Saket','Rajouri','Dwarka','Noida 18','Gurgaon CC','Lajpat','Karol Bagh','Rohini'] }
};
// [daily baseline units, available stock, in-transit]
const BASE = {
  TS: { FW: [70, 1350, 0], AP: [55, 2600, 0],   BT: [80, 2400, 0], EL: [25, 700, 150],  GR: [400, 9000, 0] },
  KA: { FW: [60, 1900, 0], AP: [75, 2300, 400], BT: [70, 2100, 0], EL: [40, 1100, 0],   GR: [380, 8500, 0] },
  MH: { FW: [55, 2600, 0], AP: [60, 2200, 0],   BT: [65, 1500, 0], EL: [35, 1000, 0],   GR: [420, 9500, 0] },
  DL: { FW: [65, 1700, 0], AP: [50, 4000, 0],   BT: [60, 1800, 0], EL: [45, 1300, 0],   GR: [450, 10000, 0] }
};
for (const r in BASE) for (const c in BASE[r]) BASE[r][c] = BASE[r][c].map(v => v * 3);   // region-level scale
const AUD = {
  all:    { n: 'All shoppers',              reach: 1,   share: 1,   tier: 1 },
  uplift: { n: 'High-uplift segment (38%)', reach: .8,  share: .52, tier: 2 },
  loyal:  { n: 'Loyalty members',           reach: .6,  share: .55, tier: 2 },
  lapsed: { n: 'Lapsed 90-day customers',   reach: .25, share: .2,  tier: 2 }
};
// mechanic economics: relative lift, and share of the headline discount that is a real cost
const MECH_FX = { '% off': [1, 1], 'Bundle': [.8, .6], 'BOGO / multi-buy': [1.1, .6], 'Free delivery': [.5, .3], 'Points boost': [.6, .45], 'EMI / exchange': [.9, .5], 'Early access': [.4, .6] };
const MECH = ['% off', 'Bundle', 'BOGO / multi-buy', 'Free delivery', 'Points boost', 'EMI / exchange', 'Early access'];
const STATUSES = ['Draft', 'Proposed', 'In review', 'Approved', 'Live'];
const STATUS_CLS = { Draft: '', Proposed: 'blue', 'In review': 'amber', Approved: 'green', Live: 'ai' };
const ROLES = {
  marketing: { n: 'Marketing Manager', edit: true,  step: 'Marketing' },
  merch:     { n: 'Merchandiser',      edit: true,  step: 'Merchandising' },
  supply:    { n: 'Supply Chain',      edit: true,  step: 'Supply Chain' },
  exec:      { n: 'Executive',         edit: false, step: 'Executive' },
  store:     { n: 'Store Manager · Hyderabad', edit: false, region: 'TS', noCustomer: true },
  admin:     { n: 'Admin',             edit: true }
};
const PROFILES = {
  fashion:     { n: 'Fashion & Footwear', constraint: 'Size coverage, season end',       levers: 'Markdown timing, bundles',            kpi: 'Sell-through',        chain: ['Marketing', 'Merchandising', 'Supply Chain', 'Executive'] },
  grocery:     { n: 'Grocery',            constraint: 'Expiry, days of supply',          levers: 'Markdowns, multi-buy',                kpi: 'Waste reduction',     chain: ['Marketing', 'Merchandising', 'Executive'] },
  electronics: { n: 'Electronics',        constraint: 'Price-match, vendor funding',     levers: 'EMI / exchange, accessory attach',    kpi: 'Attach rate',         chain: ['Marketing', 'Merchandising', 'Supply Chain', 'Executive'] },
  qcom:        { n: 'Quick commerce',     constraint: 'Dark-store stock, rider capacity', levers: 'Small targeted offers, slot throttling', kpi: 'Fill rate',        chain: ['Marketing', 'Supply Chain', 'Executive'] },
  marketplace: { n: 'Marketplace',        constraint: 'Seller co-funding, courier limits', levers: 'Co-funded deals',                   kpi: 'Seller-funded share', chain: ['Marketing', 'Merchandising', 'Executive'] },
  pharmacy:    { n: 'Pharmacy / Beauty',  constraint: 'Regulated items, expiry',         levers: 'Refill and loyalty offers',           kpi: 'Repeat rate',         chain: ['Marketing', 'Merchandising', 'Executive'] }
};
const SEASONS = {
  regular: { n: 'Regular',      sigma: .16 },
  pre:     { n: 'Pre-festive',  sigma: .20 },
  peak:    { n: 'Peak',         sigma: .25 },
  post:    { n: 'Post-festive', sigma: .18 }
};
const NAV = [
  { k: 'control',  n: 'Control Tower',        i: '◎' },
  { k: 'planning', n: 'Planning Canvas',      i: '▦', tag: 'HERO' },
  { k: 'promo',    n: 'Promotions',           i: '◇' },
  { k: 'sim',      n: 'Simulation Lab',       i: '∿' },
  { k: 'approvals',n: 'Readiness & Approval', i: '✓' },
  { k: 'war',      n: 'War Room & Learning',  i: '◉' },
  { k: 'gov',      n: 'Guardrails & Config',  i: '⚙' }
];

function seedPlan() {
  const mk = (id, name, region, cat, start, len, disc, aud, budget, status, mech = '% off') =>
    ({ id, name, region, cat, start, len, disc, aud, budget, status, mech, excl: false });
  return {
    items: [
      mk('c1', 'Diwali Footwear Fest',   'TS', 'FW', 33, 10, 25, 'all',    250000, 'Draft'),
      mk('c2', 'Festive Ethnic Wear',    'KA', 'AP', 27, 14, 20, 'loyal',  180000, 'Proposed'),
      mk('c3', 'Glow for Diwali',        'MH', 'BT', 35, 8,  15, 'uplift', 90000,  'In review'),
      mk('c4', 'Gadget Upgrade EMI',     'DL', 'EL', 37, 7,  10, 'all',    160000, 'Approved', 'EMI / exchange'),
      mk('c5', 'Dussehra Grocery Saver', 'TS', 'GR', 18, 6,  12, 'all',    60000,  'In review', 'BOGO / multi-buy'),
      mk('c6', 'Delhi Festive Kicks',    'DL', 'FW', 34, 9,  18, 'loyal',  120000, 'Approved'),
      mk('c7', 'Back-to-work Laptops',   'KA', 'EL', 0,  9,  8,  'all',    80000,  'Live', 'EMI / exchange'),
      mk('c8', 'Post-Diwali Clearance',  'MH', 'AP', 44, 10, 30, 'all',    70000,  'Draft'),
      mk('c9', 'Footwear Flash Sale',    'TS', 'FW', 38, 6,  20, 'all',    60000,  'Draft')
    ],
    transfers: []
  };
}

/* ---------------- State ---------------- */
let S;
function initState() {
  S = {
    screen: 'control', role: 'marketing', profile: 'fashion', season: 'pre', tier: 3,
    plan: seedPlan(),
    guard: { marginFloor: 22, budgetCap: 1000000, stockoutMax: 25, contactCap: 2,
             discountCap: { FW: 30, AP: 40, BT: 25, EL: 15, GR: 20 }, extra: [] },
    groupBy: 'region', overlay: 'none', zoom: 24, sel: 'c1', copilotOpen: false,
    chat: [], proposals: {}, audit: [], undo: [], redo: [], thinking: false,
    approvals: { c3: 1, c5: 1, c4: 99, c6: 99, c7: 99 }, readiness: {}, overrides: {},
    sim: { id: 'c1', stress: {} , crisis: null },
    war: { day: 0, running: false, transfer: 'none', region: 'DL', tab: 'live' },
    learnGuardAdded: false, lastChange: null,
    promo: { tab: 'recs', goal: 'profit', win: 'pre', region: 'all', cat: 'all', aud: 'any', focus: null, b: { goal: 'clear', region: 'DL', cat: 'AP', week: 3, len: 8, budget: 60000 } }, creativeTone: 'standard', unsafeCopy: false, apprSel: 'c3',
    firstScroll: true
  };
  S.chat.push({ who: 'ai', html:
    `Hi! I'm your planning copilot. I read the same live inventory, forecast and margin data as the canvas, and every number I show comes from the simulator.<br><br>
     I can only write to a <b>draft layer</b>: my edits appear as <span class="chip ai">ghost cards</span> with a before/after diff, and nothing changes until you accept it.<br><br>
     <b>Heads-up:</b> the plan has hard-rule violations. Try <i>"Critique my plan"</i>.` });
  audit('System', 'Plan loaded', 'Diwali 2026 plan v1 · synthetic data · model v0.3');
}

/* ---------------- Helpers ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function L(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(1).replace(/\.0$/, '') + 'L';
  if (a >= 1e3) return s + '₹' + Math.round(a / 1e3) + 'K';
  return s + '₹' + Math.round(a);
}
const pct = (x, d = 0) => (x).toFixed(d) + '%';
const dayDate = d => new Date(START.getFullYear(), START.getMonth(), START.getDate() + d);
const ds = d => dayDate(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const range = it => `${ds(it.start)} – ${ds(it.start + it.len - 1)}`;
const nowStr = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
function erf(x) { const t = 1 / (1 + .3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
const Phi = z => .5 * (1 + erf(z / Math.SQRT2));
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function normal(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }
function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = t; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3200); }
function audit(who, action, detail, src = 'human') { S.audit.unshift({ t: nowStr(), who, action, detail, src }); }
const role = () => ROLES[S.role];
const canEdit = () => role().edit;
const item = id => S.plan.items.find(i => i.id === id);
const sigma = () => SEASONS[S.season].sigma;

/* ---------------- Model: forecast, stock, simulation ---------------- */
function g(d, c, w) { return Math.exp(-(((d - c) / w) ** 2)); }
function seasonMult(d, cat) {
  return 1 + .75 * g(d, 40, 4.5) + .3 * g(d, 22, 2.5) + (cat === 'EL' ? .5 : .15) * g(d, 60, 2);
}
function stockOf(plan, r, c) {
  let s = BASE[r][c][1];
  for (const t of plan.transfers) if (t.cat === c) { if (t.to === r) s += t.units; if (t.from === r) s -= t.units; }
  return s;
}
function sim(it, plan, o = {}) {
  const cat = CATS[it.cat], aud = AUD[it.aud], b = BASE[it.region][it.cat];
  let B = 0; for (let d = it.start; d < it.start + it.len; d++) B += b[0] * seasonMult(d, it.cat);
  if (it.excl) B *= .9;
  B *= (o.demandMult ?? 1);
  const d = it.disc / 100;
  const ref = b[0] * it.len * cat.price * .025;
  const eff = Math.min(1.2, Math.sqrt(Math.max(it.budget, 1) / ref));   // diminishing returns on spend
  const fx = MECH_FX[it.mech] || [1, 1];
  const lift = cat.elast * aud.reach * eff * d * fx[0] * (o.liftMult ?? 1);
  const I = B * lift, D = B + I;
  const stk = (o.stock ?? stockOf(plan, it.region, it.cat)) * (o.stockMult ?? 1);
  const sd = sigma() * D;
  const pStock = 1 - Phi((stk - D) / sd);
  const sold = Math.min(D, stk), f = sold / D;
  const disU = aud.share * sold * fx[1];
  const price = cat.price;
  const revenue = sold * price - disU * price * d;
  const gross = sold * price * cat.margin - disU * price * d;
  const marginPct = (gross - it.budget) / revenue * 100;
  const incRev = revenue - Math.min(B, stk) * price;
  const incUnits = I * f;
  const incProfit = incUnits * price * cat.margin - disU * price * d - it.budget;
  const waste = Math.max(0, disU - incUnits) * price * d;
  const dos = stk / (D / it.len);
  return { B, I, D, stk, sd, pStock, sold, revenue, gross, marginPct, incRev, incProfit, waste, dos, eff, incUnits };
}
function violations(it, m) {
  const v = [], G = S.guard;
  if (m.marginPct < G.marginFloor) v.push({ k: 'margin', t: `Margin ${pct(m.marginPct, 1)} is below the ${G.marginFloor}% floor` });
  if (m.pStock * 100 > G.stockoutMax) v.push({ k: 'stock', t: `Stockout risk ${pct(m.pStock * 100)} exceeds the ${G.stockoutMax}% limit` });
  if (it.disc > G.discountCap[it.cat]) v.push({ k: 'disc', t: `${it.disc}% off exceeds the ${CATS[it.cat].n} cap of ${G.discountCap[it.cat]}%` });
  if (S.tier < 2 && AUD[it.aud].tier > 1) v.push({ k: 'tier', t: `Segment targeting needs data tier 2 (customer IDs)` });
  return v;
}
const overlap = (a, b) => a.start < b.start + b.len && b.start < a.start + a.len;
function conflicts(plan) {
  const out = [], its = plan.items;
  for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
    const a = its[i], b = its[j];
    if (overlap(a, b) && a.region === b.region && a.cat === b.cat)
      out.push({ type: 'SKU overlap', ids: [a.id, b.id], t: `<b>${esc(a.name)}</b> and <b>${esc(b.name)}</b> both promote ${CATS[a.cat].n} in ${REGIONS[a.region].city} on overlapping days (cannibalization)` });
  }
  for (const r in REGIONS) {
    let worst = null;
    for (let d = 0; d < DAYS; d++) {
      const act = its.filter(x => x.region === r && d >= x.start && d < x.start + x.len);
      if (act.length > S.guard.contactCap && (!worst || act.length > worst.n)) worst = { n: act.length, d, ids: act.map(x => x.id) };
    }
    if (worst) out.push({ type: 'Over-contact', ids: worst.ids, t: `${worst.n} campaigns reach ${REGIONS[r].city} shoppers on ${ds(worst.d)} (cap ${S.guard.contactCap})` });
  }
  const spend = its.reduce((s, x) => s + x.budget, 0);
  if (spend > S.guard.budgetCap) out.push({ type: 'Budget overrun', ids: [], t: `Plan spend ${L(spend)} exceeds the ${L(S.guard.budgetCap)} budget by ${L(spend - S.guard.budgetCap)}` });
  return out;
}
function maxContact(plan) {
  let mx = 0;
  for (const r in REGIONS) for (let d = 0; d < DAYS; d++) mx = Math.max(mx, plan.items.filter(x => x.region === r && d >= x.start && d < x.start + x.len).length);
  return mx;
}
function planTotals(plan) {
  let spend = 0, rev = 0, net = 0, inc = 0, v2 = 0, worst = null, nViol = 0;
  const per = {};
  for (const it of plan.items) {
    const m = sim(it, plan); m.viol = violations(it, m); per[it.id] = m;
    spend += it.budget; rev += m.revenue; net += m.gross - it.budget; inc += m.incRev;
    v2 += (m.sd * CATS[it.cat].price * .5) ** 2;
    if (m.viol.length) nViol++;
    if (!worst || m.pStock > worst.m.pStock) worst = { it, m };
  }
  const sd = Math.sqrt(v2);
  const conf = conflicts(plan);
  return { spend, rev, margin: rev ? net / rev * 100 : 0, inc, incLo: inc - 1.28 * sd, incHi: inc + 1.28 * sd,
           worst, nViol, conf, per, contact: maxContact(plan) };
}
function optimize(base, plan, o = {}) {
  const floor = o.floor ?? S.guard.marginFloor, maxSO = o.maxSO ?? S.guard.stockoutMax;
  const auds = S.tier >= 2 ? ['uplift', 'loyal', 'lapsed', 'all'] : ['all'];
  let best = null;
  for (const aud of auds) for (const excl of [false, true]) for (let d = 5; d <= S.guard.discountCap[base.cat]; d++) {
    const it = { ...base, aud, excl, disc: d }, m = sim(it, plan);
    if (m.marginPct < floor || m.pStock * 100 > maxSO) continue;
    const score = m.incProfit - m.pStock * m.revenue * .15;
    if (!best || score > best.score) best = { it, m, score };
  }
  return best;
}
function donorFor(plan, region, cat) {
  let best = null;
  for (const r in REGIONS) {
    if (r === region) continue;
    const committed = plan.items.filter(x => x.region === r && x.cat === cat).reduce((s, x) => s + sim(x, plan).D * 1.25, 0);
    const surplus = stockOf(plan, r, cat) - committed - BASE[r][cat][0] * 14;
    if (!best || surplus > best.surplus) best = { r, surplus: Math.floor(surplus / 50) * 50 };
  }
  return best && best.surplus > 0 ? best : null;
}
function transferNeed(plan, it, target = .05) {
  const m = sim(it, plan);
  const z = target <= .05 ? 1.645 : .674;
  return Math.ceil(Math.max(0, m.D * (1 + z * sigma()) - m.stk) / 50) * 50;
}

/* ---------------- Change sets (AI draft layer) ---------------- */
let seq = 100;
const nid = p => p + (++seq);
function applyChange(plan, ch) {
  if (ch.type === 'update') { const it = plan.items.find(i => i.id === ch.id); if (it) Object.assign(it, ch.patch); }
  else if (ch.type === 'create') { if (!plan.items.find(i => i.id === ch.item.id)) plan.items.push(clone(ch.item)); }
  else if (ch.type === 'delete') plan.items = plan.items.filter(i => i.id !== ch.id);
  else if (ch.type === 'transfer') plan.transfers.push(clone(ch.t));
}
function pendingChanges() {
  const out = [];
  for (const p of Object.values(S.proposals)) for (const c of p.changes) if (c.st === 'pending') out.push(c);
  return out;
}
function withPending(plan) { const p = clone(plan); pendingChanges().forEach(c => applyChange(p, c)); return p; }
function changeTarget(ch) {
  if (ch.type === 'create') return ch.item.id;
  if (ch.type === 'transfer') { const t = S.plan.items.find(i => i.region === ch.t.to && i.cat === ch.t.cat); return t && t.id; }
  return ch.id;
}
function diffFor(ch) {
  const before = planTotals(S.plan);
  const p = clone(S.plan); applyChange(p, ch);
  const after = planTotals(p);
  const tid = changeTarget(ch);
  const out = [];
  const b = before.per[tid], a = after.per[tid];
  const arrow = (l, x, y, fmt, goodIfLower) => {
    const better = goodIfLower ? y < x - 1e-6 : y > x + 1e-6, worse = goodIfLower ? y > x + 1e-6 : y < x - 1e-6;
    return `<span>${l} ${fmt(x)} → <b class="${better ? 'good' : worse ? 'bad' : ''}">${fmt(y)}</b></span>`;
  };
  if (b && a) {
    out.push(arrow('Stockout', b.pStock * 100, a.pStock * 100, v => pct(v), true));
    out.push(arrow('Margin', b.marginPct, a.marginPct, v => pct(v, 1), false));
  } else if (a) {
    out.push(`<span>Stockout <b>${pct(a.pStock * 100)}</b></span>`, `<span>Margin <b class="${a.marginPct >= S.guard.marginFloor ? 'good' : 'bad'}">${pct(a.marginPct, 1)}</b></span>`);
  }
  out.push(arrow('Inc. revenue', before.inc, after.inc, L, false));
  if (Math.abs(before.spend - after.spend) > 1) out.push(arrow('Spend', before.spend, after.spend, L, true));
  out.push(arrow('Rule violations', before.nViol, after.nViol, v => v, true));
  return out.join('');
}
function newProposal(title, changes, evidence, note) {
  const id = nid('p');
  changes.forEach(c => { c.cid = nid('ch'); c.st = 'pending'; c.pid = id; });
  // validate every proposal against hard rules before showing it
  const after = planTotals(withPendingOnly(changes));
  S.proposals[id] = { id, title, changes, evidence, note, validViol: after.nViol, validConf: after.conf.length };
  audit('AI Copilot', 'Proposed change set', `${title} (${changes.length} changes)`, 'ai');
  return id;
}
function withPendingOnly(changes) { const p = clone(S.plan); changes.forEach(c => applyChange(p, c)); return p; }
function decide(cid, ok) {
  for (const p of Object.values(S.proposals)) {
    const c = p.changes.find(x => x.cid === cid);
    if (!c || c.st !== 'pending') continue;
    if (ok) {
      if (!canEdit()) { toast('Your role is read-only. Ask a planner to accept.'); return; }
      pushUndo(); applyChange(S.plan, c); c.st = 'accepted';
      audit(role().n, 'Accepted AI change', c.label);
      explainChange(lastUndo(), [changeTarget(c)], 'Accepted AI change: ' + c.label, 'ai');
    } else { c.st = 'rejected'; audit(role().n, 'Rejected AI change', c.label); }
  }
  render();
}
function decideAll(pid, ok) {
  const p = S.proposals[pid]; if (!p) return;
  if (ok && !canEdit()) { toast('Your role is read-only.'); return; }
  if (ok) pushUndo();
  p.changes.filter(c => c.st === 'pending').forEach(c => {
    if (ok) { applyChange(S.plan, c); c.st = 'accepted'; audit(role().n, 'Accepted AI change', c.label); }
    else { c.st = 'rejected'; audit(role().n, 'Rejected AI change', c.label); }
  });
  if (ok) explainChange(lastUndo(), p.changes.filter(c => c.st === 'accepted').map(changeTarget), `Accepted AI change set: ${p.title}`, 'ai');
  render();
}

/* ---------------- Undo / redo ---------------- */
function pushUndo() { S.undo.push(clone(S.plan)); if (S.undo.length > 60) S.undo.shift(); S.redo = []; }
function undo() { if (!S.undo.length) return; S.redo.push(clone(S.plan)); S.plan = S.undo.pop(); audit(role().n, 'Undo', 'Reverted last change'); render(); }
function redo() { if (!S.redo.length) return; S.undo.push(clone(S.plan)); S.plan = S.redo.pop(); audit(role().n, 'Redo', ''); render(); }
function updateItem(id, patch, label) {
  if (!canEdit()) { toast('Read-only for ' + role().n); return; }
  pushUndo(); Object.assign(item(id), patch);
  audit(role().n, 'Edited campaign', `${item(id).name}: ${label || Object.keys(patch).join(', ')}`);
  explainChange(lastUndo(), [id], `Edited ${label || Object.keys(patch).join(', ')}`);
  render();
}

/* ---------------- Shell ---------------- */
function renderNav() {
  $('#nav').innerHTML = NAV.map(n => `<button class="${S.screen === n.k ? 'active' : ''}" onclick="go('${n.k}')"><span class="ico">${n.i}</span>${n.n}${n.tag ? `<span class="tag">${n.tag}</span>` : ''}</button>`).join('');
}
function go(k) { S.screen = k; render(); }
function renderTopbar() {
  const t = NAV.find(n => n.k === S.screen);
  $('#title').textContent = t.n;
  const subs = {
    control: 'Executive overview',
    planning: 'Plan, validate and refine campaigns',
    promo: 'Recommended offers by customer group, product and location',
    sim: 'Monte Carlo digital twin · counterfactuals · stress tests',
    approvals: 'Go / no-go readiness · approval chain · text creative with guardrails',
    war: 'Live monitor · interventions · reality check & learning loop',
    gov: 'Retailer profile · guardrails · roles · audit trail'
  };
  $('#subtitle').textContent = subs[S.screen];
  $('#profileSel').innerHTML = Object.entries(PROFILES).map(([k, v]) => `<option value="${k}" ${k === S.profile ? 'selected' : ''}>${v.n}</option>`).join('');
  $('#seasonSel').innerHTML = Object.entries(SEASONS).map(([k, v]) => `<option value="${k}" ${k === S.season ? 'selected' : ''}>${v.n}</option>`).join('');
  $('#roleSel').innerHTML = Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === S.role ? 'selected' : ''}>${v.n}</option>`).join('');
}
function render() {
  renderNav(); renderTopbar();
  const c = $('#content');
  c.className = 'content';
  ({ control: renderControl, planning: renderPlanning, promo: renderPromo, sim: renderSim, approvals: renderApprovals, war: renderWar, gov: renderGov })[S.screen]();
  if (S.screen !== 'planning') renderSide();
}
function resetDemo() { if (confirm('Reset the demo to its starting state?')) { clearInterval(warTimer); initState(); render(); toast('Demo reset'); } }

/* =====================================================================
   PLANNING CANVAS
   ===================================================================== */
function rowKeys() {
  if (S.groupBy === 'region') return role().region ? [role().region] : Object.keys(REGIONS);
  return Object.keys(CATS);
}
const rowOf = it => S.groupBy === 'region' ? it.region : it.cat;
function visibleItems(items) { return role().region ? items.filter(i => i.region === role().region) : items; }

function renderPlanning() {
  const c = $('#content');
  const pend = pendingChanges().length;
  const it = item(S.sel);
  c.innerHTML = `
  <div class="plan-page">
    <div class="card plan-toolbar">
      <span class="lbl">Rows</span>
      <div class="seg">${['region', 'category'].map(k => `<button class="${S.groupBy === k ? 'on' : ''}" onclick="S.groupBy='${k}';renderPlanning()">${k === 'region' ? 'Region' : 'Category'}</button>`).join('')}</div>
      <span class="lbl">Overlay</span>
      <div class="seg">${[['none', 'None'], ['inv', 'Inventory'], ['demand', 'Demand'], ['margin', 'Margin']].map(([k, n]) => `<button class="${S.overlay === k ? 'on' : ''}" onclick="S.overlay='${k}';renderPlanning()">${n}</button>`).join('')}</div>
      <div class="seg"><button onclick="zoom(-1)" title="Zoom out">−</button><button onclick="zoom(1)" title="Zoom in">＋</button></div>
      <div style="flex:1"></div>
      <button class="btn sm" onclick="undo()" ${S.undo.length ? '' : 'disabled'} title="Undo">↶ Undo</button>
      <button class="btn sm" onclick="redo()" ${S.redo.length ? '' : 'disabled'} title="Redo">↷ Redo</button>
      <button class="btn sm primary" onclick="newCampaign()" ${canEdit() ? '' : 'disabled'}>＋ New campaign</button>
    </div>

    <div class="card" id="kpiCard">
      <div class="card-h">Plan health <span class="muted">· updates live as you edit</span><span style="flex:1"></span>${pend ? `<span class="chip ai">✦ ${pend} AI change${pend > 1 ? 's' : ''} awaiting review</span>` : ''}</div>
      <div class="kpibar" id="kpibar"></div>
    </div>
    ${whyCardHtml()}

    <div class="card" id="calCard">
      <div class="card-h">Campaign calendar <span class="muted">· drag to move · drag edges to resize</span><span style="flex:1"></span>
        ${!canEdit() ? `<span class="chip amber">🔒 Read-only: ${esc(role().n)}</span>` : ''}<span class="legend">${legendHtml()}</span></div>
      <div class="tl-wrap" id="tlwrap"></div>
    </div>

    <div class="grid plan-lower">
      <div class="card" id="detailCard">
        <div class="card-h">Selected campaign ${it ? `<span class="muted">· ${esc(it.name)}</span>` : ''}</div>
        ${detailsHtml()}
      </div>
      <div class="card" id="historyCard">
        <div class="card-h">History & audit</div>
        ${historyHtml()}
      </div>
    </div>
  </div>`;
  renderKpis(); renderTL(); renderSide();
  const w = $('#tlwrap');
  if (S.firstScroll) { S.tlScroll = [12 * S.zoom, 0]; S.firstScroll = false; }
  if (S.tlScroll) w.scrollLeft = S.tlScroll[0];
  w.addEventListener('scroll', () => { S.tlScroll = [w.scrollLeft, 0]; });
}
function legendHtml() {
  if (S.overlay === 'inv') return `<span><i style="background:#fca5a5"></i>&lt;12 days</span><span><i style="background:#fcd34d"></i>12–20</span><span><i style="background:#86efac"></i>healthy</span><span><i style="background:#c4d2ea"></i>overstock / aging</span>`;
  if (S.overlay === 'demand') return `<span><i style="background:#eaf0fa"></i>normal</span><span><i style="background:#1f3b73"></i>peak demand</span>`;
  if (S.overlay === 'margin') return `<span><i style="background:#fca5a5"></i>below floor</span><span><i style="background:#fcd34d"></i>&lt;5pt headroom</span><span><i style="background:#86efac"></i>healthy</span>`;
  return '';
}
function zoom(dir) { const w = $('#tlwrap'); const mid = (w.scrollLeft + w.clientWidth / 2 - 170) / S.zoom; S.zoom = clamp(S.zoom + dir * 6, 14, 42); renderTL(); w.scrollLeft = mid * S.zoom - w.clientWidth / 2 + 170; }

function renderKpis() {
  const T = planTotals(S.plan);
  const pend = pendingChanges();
  const P = pend.length ? planTotals(withPending(S.plan)) : null;
  const G = S.guard;
  const d = (a, b, fmt) => P ? `<span class="delta">→ ${fmt(b)}</span>` : '';
  const spendCls = T.spend > G.budgetCap ? 'bad' : T.spend > G.budgetCap * .9 ? 'warn' : 'good';
  const marCls = T.margin < G.marginFloor ? 'bad' : T.margin < G.marginFloor + 3 ? 'warn' : 'good';
  const soCls = T.worst && T.worst.m.pStock * 100 > G.stockoutMax ? 'bad' : T.worst && T.worst.m.pStock > .1 ? 'warn' : 'good';
  const issues = T.nViol + T.conf.length;
  $('#kpibar').innerHTML = `
    <div class="k ${spendCls}"><div class="l">Spend vs budget</div><div class="v">${L(T.spend)} <span class="muted" style="font-size:12px;font-weight:500">/ ${L(G.budgetCap)}</span>${d(0, P && P.spend, L)}</div>
      <div class="bar" style="margin-top:4px"><i style="width:${clamp(T.spend / G.budgetCap * 100, 0, 100)}%;background:${T.spend > G.budgetCap ? 'var(--red)' : 'var(--primary)'}"></i></div></div>
    <div class="k ${marCls}"><div class="l">Plan margin</div><div class="v">${pct(T.margin, 1)}${d(0, P && P.margin, v => pct(v, 1))}</div><div class="s">range ${pct(T.margin - sigma() * 12, 0)}–${pct(T.margin + sigma() * 10, 0)} · floor ${G.marginFloor}%</div></div>
    <div class="k"><div class="l">Incremental revenue</div><div class="v">${L(T.inc)}${d(0, P && P.inc, L)}</div><div class="s">80% range ${L(T.incLo)} – ${L(T.incHi)}</div></div>
    <div class="k ${soCls}"><div class="l">Max stockout risk</div><div class="v">${T.worst ? pct(T.worst.m.pStock * 100) : '–'}${d(0, P && P.worst && P.worst.m.pStock * 100, v => pct(v))}</div><div class="s">${T.worst ? esc(T.worst.it.name) : ''} · limit ${G.stockoutMax}%</div></div>
    <div class="k ${T.contact > G.contactCap ? 'bad' : 'good'}"><div class="l">Contact pressure</div><div class="v">${T.contact} / day</div><div class="s">max overlapping campaigns · cap ${G.contactCap}</div></div>
    <div class="k click ${issues ? 'bad' : 'good'}" onclick="ask('Critique my plan')" title="Ask the copilot to critique"><div class="l">Issues <span class="faint">· click to critique</span></div><div class="v">${issues ? `${T.nViol} rule · ${T.conf.length} conflict` : '✓ All clear'}${P ? `<span class="delta">→ ${P.nViol + P.conf.length}</span>` : ''}</div><div class="s">${T.conf.map(c => c.type).join(' · ') || 'no conflicts'}</div></div>`;
}

function heatColor(row, w) {
  const pairs = S.groupBy === 'region' ? Object.keys(CATS).map(c => [row, c]) : rowKeysAll('region').map(r => [r, row]);
  const d0 = w * 7, d1 = Math.min(DAYS, d0 + 7);
  if (S.overlay === 'inv') {
    let stock = 0, dem = 0;
    for (const [r, c] of pairs) {
      const b = BASE[r][c]; let sold = 0;
      for (let d = TODAY; d < d0; d++) sold += b[0] * seasonMult(d, c) * .3;   // net of replenishment
      stock += Math.max(0, stockOf(S.plan, r, c) + (w >= 2 ? b[2] : 0) - sold);
      for (let d = d0; d < d1; d++) dem += b[0] * seasonMult(d, c) / (d1 - d0);
    }
    const cov = stock / dem;
    return cov < 12 ? '#fca5a5' : cov < 20 ? '#fcd34d' : cov > 55 ? '#c4d2ea' : '#bbf7d0';
  }
  if (S.overlay === 'demand') {
    let s = 0, n = 0;
    for (let d = d0; d < d1; d++) { s += seasonMult(d, pairs[0][1]); n++; }
    const v = clamp((s / n - 1) / .7, 0, 1);
    return `rgba(31,59,115,${.06 + v * .5})`;
  }
  if (S.overlay === 'margin') {
    const its = visibleItems(S.plan.items).filter(i => rowOf(i) === row && i.start < d1 && i.start + i.len > d0);
    if (!its.length) return 'transparent';
    const mn = Math.min(...its.map(i => sim(i, S.plan).marginPct)) - S.guard.marginFloor;
    return mn < 0 ? '#fca5a5' : mn < 5 ? '#fcd34d' : '#bbf7d0';
  }
  return 'transparent';
}
const rowKeysAll = k => k === 'region' ? (role().region ? [role().region] : Object.keys(REGIONS)) : Object.keys(CATS);

function rowLabel(k) {
  if (S.groupBy === 'region') {
    const r = REGIONS[k];
    const tot = Object.keys(CATS).reduce((s, c) => s + stockOf(S.plan, k, c) * CATS[c].price, 0);
    const n = S.plan.items.filter(i => i.region === k).length;
    return `<b>${r.n}</b><small>${r.city} · ${r.stores.length} stores</small><div class="inv"><span class="chip">${n} campaigns</span><span class="chip">stock ${L(tot)}</span></div>`;
  }
  const c = CATS[k];
  const units = rowKeysAll('region').reduce((s, r) => s + stockOf(S.plan, r, k), 0);
  return `<b><span class="dot" style="background:${c.color}"></span> ${c.n}</b><small>margin ${pct(c.margin * 100)} · cap ${S.guard.discountCap[k]}% off</small><div class="inv"><span class="chip">${units.toLocaleString('en-IN')} units</span></div>`;
}

function cardHtml(it, m, opts = {}) {
  const dw = S.zoom, c = CATS[it.cat];
  const so = m.pStock * 100;
  const soCls = so > S.guard.stockoutMax ? 'red' : so > 10 ? 'amber' : 'green';
  const mCls = m.marginPct < S.guard.marginFloor ? 'red' : m.marginPct < S.guard.marginFloor + 3 ? 'amber' : 'green';
  const sub = S.groupBy === 'region' ? c.n : REGIONS[it.region].city;
  const audTxt = role().noCustomer ? 'segment hidden' : AUD[it.aud].n.replace(' (38%)', '');
  const cls = ['cc'];
  if (opts.ghost) cls.push('ghost');
  else {
    if (m.viol && m.viol.length) cls.push('viol');
    if (S.sel === it.id) cls.push('sel');
    if (opts.pending) cls.push('pending-ai');
    if (opts.dim) cls.push('dim');
    if (!canEdit()) cls.push('locked');
  }
  return `<div class="${cls.join(' ')}" data-id="${it.id}" ${opts.ghost ? `data-ghost="1"` : ''} style="left:${it.start * dw + 2}px;width:${Math.max(it.len * dw - 4, 30)}px;top:${opts.top}px;--c:${c.color}" title="${esc(it.name)} · ${range(it)}">
    ${opts.ghost ? `<span class="ghost-tag">✦ AI ${opts.ghost}</span>` : canEdit() ? '<div class="rh l"></div><div class="rh r"></div>' : ''}
    <div class="nm">${m.viol && m.viol.length && !opts.ghost ? '⛔ ' : ''}${esc(it.name)}</div>
    <div class="ln">${sub} · ${it.disc}% ${it.mech === '% off' ? 'off' : '· ' + it.mech} · ${audTxt} · ${L(it.budget)}</div>
    <div class="bd"><span class="chip ${STATUS_CLS[it.status] || ''}">${it.status}</span><span class="chip ${soCls}">SO ${pct(so)}</span><span class="chip ${mCls}">M ${pct(m.marginPct)}</span></div>
  </div>`;
}

function renderTL() {
  const wrap = $('#tlwrap'); if (!wrap) return;
  const sl = wrap.scrollLeft, st = wrap.scrollTop;
  const dw = S.zoom, W = DAYS * dw;
  const T = planTotals(S.plan);
  const pend = pendingChanges();
  const gp = pend.length ? withPending(S.plan) : null;
  const gT = gp ? planTotals(gp) : null;
  const pendIds = new Set(), delIds = new Set();
  pend.forEach(c => { if (c.type === 'update') pendIds.add(c.id); if (c.type === 'delete') delIds.add(c.id); if (c.type === 'transfer') { const t = changeTarget(c); if (t) pendIds.add(t); } });

  // axis
  let axis = '';
  for (let w = 0; w < DAYS / 7; w++) axis += `<div class="tl-week" style="left:${w * 7 * dw}px;width:${7 * dw}px">Wk ${w + 1} · ${ds(w * 7)}</div>`;
  for (let d = 0; d < DAYS; d++) { const dd = dayDate(d); const we = dd.getDay() === 0 || dd.getDay() === 6; axis += `<div class="tl-day ${we ? 'we' : ''}" style="left:${d * dw}px;width:${dw}px">${dw >= 20 ? dd.getDate() : (dd.getDate() % 2 ? '' : dd.getDate())}</div>`; }
  EVENTS.forEach(e => axis += `<div class="tl-event" style="left:${e.d * dw + dw / 2}px">${e.n}</div>`);

  let rows = '';
  for (const k of rowKeys()) {
    // collect real + ghost items for lane layout
    const entries = [];
    visibleItems(S.plan.items).filter(i => rowOf(i) === k).forEach(it => entries.push({ it, m: T.per[it.id], opts: { pending: pendIds.has(it.id), dim: delIds.has(it.id) } }));
    if (gp) visibleItems(gp.items).filter(i => rowOf(i) === k).forEach(it => {
      const orig = item(it.id);
      if (!orig) entries.push({ it, m: gT.per[it.id], opts: { ghost: 'proposal' } });
      else if (orig.start !== it.start || orig.len !== it.len || rowOf(orig) !== rowOf(it)) entries.push({ it, m: gT.per[it.id], opts: { ghost: 'move' } });
    });
    entries.sort((a, b) => a.it.start - b.it.start);
    const lanes = [];
    entries.forEach(e => { let l = lanes.findIndex(end => end <= e.it.start); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = e.it.start + e.it.len; e.lane = l; });
    const h = Math.max(1, lanes.length) * 70 + 10;
    let lane = '';
    if (S.overlay !== 'none') for (let w = 0; w < DAYS / 7; w++) lane += `<div class="tl-heat" style="left:${w * 7 * dw}px;width:${7 * dw}px;background:${heatColor(k, w)}"></div>`;
    for (let d = 0; d <= DAYS; d++) lane += `<div class="tl-gridline ${d % 7 === 0 ? 'wk' : ''}" style="left:${d * dw}px"></div>`;
    EVENTS.forEach(e => lane += `<div class="tl-eventline" style="left:${e.d * dw + dw / 2}px"></div>`);
    lane += `<div class="tl-today" style="left:${TODAY * dw + dw / 2}px"></div>`;
    entries.forEach(e => lane += cardHtml(e.it, e.m, { ...e.opts, top: 6 + e.lane * 70 }));
    rows += `<div class="tl-row" data-row="${k}"><div class="tl-label">${rowLabel(k)}</div><div class="tl-lane" style="width:${W}px;height:${h}px">${lane}</div></div>`;
  }
  wrap.innerHTML = `<div class="tl" style="width:${W + 170}px">
    <div class="tl-head"><div class="tl-corner">${S.groupBy === 'region' ? 'Region' : 'Category'}</div><div class="tl-axis" style="width:${W}px">${axis}<div class="tl-today-lbl" style="left:${TODAY * dw + dw / 2}px;top:44px">TODAY</div></div></div>
    <div class="tl-rows">${rows}</div></div>`;
  wrap.scrollLeft = sl; wrap.scrollTop = st;
}

/* ---- drag & resize ---- */
let drag = null;
function bindCanvas() {
  document.addEventListener('pointerdown', e => {
    const card = e.target.closest && e.target.closest('#tlwrap .cc');
    if (!card) return;
    const id = card.dataset.id;
    if (card.dataset.ghost) { S.copilotOpen = true; renderSide(); scrollChatToProposal(); return; }
    const it = item(id); if (!it) return;
    const mode = e.target.classList.contains('rh') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
    drag = { id, it, mode, x0: e.clientX, y0: e.clientY, orig: { start: it.start, len: it.len, region: it.region, cat: it.cat }, card, moved: false, snap: null };
    e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if (!canEdit()) return;
    if (!drag.moved) { drag.moved = true; drag.snap = clone(S.plan); drag.card.classList.add('dragging'); drag.card.style.pointerEvents = 'none'; }
    const it = drag.it, o = drag.orig, dd = Math.round(dx / S.zoom);
    if (drag.mode === 'move') {
      it.start = clamp(o.start + dd, 0, DAYS - it.len);
      const rowEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl-row');
      if (rowEl) {
        const k = rowEl.dataset.row;
        if (S.groupBy === 'region') it.region = k; else it.cat = k;
        const lane = rowEl.querySelector('.tl-lane');
        if (drag.card.parentElement !== lane) { lane.appendChild(drag.card); drag.card.style.top = '6px'; }
      }
    } else if (drag.mode === 'r') it.len = clamp(o.len + dd, 2, DAYS - it.start);
    else { const ns = clamp(o.start + dd, 0, o.start + o.len - 2); it.len = o.len + (o.start - ns); it.start = ns; }
    drag.card.style.left = it.start * S.zoom + 2 + 'px';
    drag.card.style.width = it.len * S.zoom - 4 + 'px';
    const m = sim(it, S.plan), v = violations(it, m);
    drag.card.classList.toggle('viol', v.length > 0);
    showTip(e, `<b>${esc(it.name)}</b> · ${range(it)} (${it.len}d) · ${REGIONS[it.region].city} · ${CATS[it.cat].n}<br>Stockout ${pct(m.pStock * 100)} · Margin ${pct(m.marginPct, 1)} · ${v.length ? '⛔ ' + v.length + ' rule' + (v.length > 1 ? 's' : '') : '✓ rules OK'}`);
    renderKpis();
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null; hideTip();
    if (!d.moved) { S.sel = d.id; renderPlanning(); $('#detailCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const it = d.it, o = d.orig;
    const changed = it.start !== o.start || it.len !== o.len || it.region !== o.region || it.cat !== o.cat;
    if (changed) {
      S.undo.push(d.snap); S.redo = [];
      const parts = [];
      if (it.start !== o.start) parts.push(`${Math.abs(it.start - o.start)} day${Math.abs(it.start - o.start) > 1 ? 's' : ''} ${it.start < o.start ? 'earlier' : 'later'}`);
      if (it.len !== o.len) parts.push(`duration ${o.len}→${it.len}d`);
      if (it.region !== o.region) parts.push(`region ${REGIONS[o.region].city}→${REGIONS[it.region].city}`);
      if (it.cat !== o.cat) parts.push(`category ${CATS[o.cat].n}→${CATS[it.cat].n}`);
      audit(role().n, 'Moved on canvas', `${it.name}: ${parts.join(', ')}`);
      explainChange(d.snap, [it.id], 'Moved on canvas');
      toast(`${esc(it.name)} · ${parts.join(', ')} · see “What changed & why”`);
    }
    S.sel = d.id; renderPlanning();
  });
}
function showTip(e, html) { let t = $('#dragtip'); if (!t) { t = document.createElement('div'); t.id = 'dragtip'; t.className = 'drag-tip'; document.body.appendChild(t); } t.innerHTML = html; t.style.left = e.clientX + 14 + 'px'; t.style.top = e.clientY + 16 + 'px'; }
function hideTip() { const t = $('#dragtip'); if (t) t.remove(); }

function newCampaign() {
  if (!canEdit()) return;
  pushUndo();
  const region = S.groupBy === 'region' ? rowKeys()[0] : 'TS', cat = S.groupBy === 'category' ? 'AP' : 'AP';
  const it = { id: nid('c'), name: 'New campaign', region, cat, start: 14, len: 7, disc: 15, aud: S.tier >= 2 ? 'uplift' : 'all', budget: 50000, status: 'Draft', mech: '% off', excl: false };
  S.plan.items.push(it); S.sel = it.id;
  audit(role().n, 'Created campaign', it.name);
  explainChange(lastUndo(), [it.id], 'New campaign');
  renderPlanning();
}

/* ---- AI copilot: floating button + slide-out drawer ---- */
function renderSide() {
  let fab = $('#fab'), side = $('#side');
  if (!fab) {
    fab = document.createElement('button'); fab.id = 'fab'; fab.className = 'fab'; fab.onclick = () => toggleCopilot();
    side = document.createElement('aside'); side.id = 'side'; side.className = 'copilot';
    document.body.append(fab, side);
  }
  const onPlan = S.screen === 'planning';
  const pend = pendingChanges().length;
  fab.style.display = onPlan && !S.copilotOpen ? '' : 'none';
  fab.innerHTML = `✦ AI Copilot${pend ? `<span class="n">${pend}</span>` : ''}`;
  side.classList.toggle('open', onPlan && !!S.copilotOpen);
  side.innerHTML = `
    <div class="copilot-h"><div><b>✦ AI Copilot</b><div class="muted" style="font-size:11.5px">Drafts only. You accept every change.</div></div><button class="btn sm" onclick="toggleCopilot(false)" title="Close">✕</button></div>
    <div class="side-body" id="sidebody">${chatHtml()}</div>
    ${composerHtml()}`;
  const b = $('#sidebody'); b.scrollTop = b.scrollHeight;
}
function toggleCopilot(v) { S.copilotOpen = v ?? !S.copilotOpen; renderSide(); }
function scrollChatToProposal() { const el = document.querySelector('.proposal:last-of-type'); if (el) el.scrollIntoView({ block: 'center' }); }

function chatHtml() {
  return `<div class="chat">${S.chat.map(m => m.who === 'user'
    ? `<div class="msg user">${m.html}</div>`
    : `<div class="msg ai"><div class="who">✦ Copilot ${m.evidence ? `<span class="chip ${m.evidence === 'Strong' ? 'green' : m.evidence === 'Moderate' ? 'amber' : 'red'}">evidence: ${m.evidence}</span>` : ''}</div>${m.html}${m.prop ? proposalHtml(S.proposals[m.prop]) : ''}${m.tools ? `<div class="tools"><b>tools:</b> ${m.tools.join(' · ')}</div>` : ''}</div>`).join('')}
    ${S.thinking ? `<div class="msg ai"><div class="who">✦ Copilot</div><span class="typing"><i></i><i></i><i></i></span> <span class="muted">calling forecast, inventory &amp; simulator…</span></div>` : ''}</div>`;
}
function proposalHtml(p) {
  if (!p) return '';
  const open = p.changes.some(c => c.st === 'pending');
  return `<div class="proposal">
    <div class="ph">✦ ${esc(p.title)} <span style="flex:1"></span>${p.validViol === 0 ? '<span class="chip green">✓ validated · 0 rule breaks</span>' : `<span class="chip amber">⚠ ${p.validViol} rule issue after apply</span>`}</div>
    ${p.changes.map(c => `<div class="change ${c.st}">
      <div class="ct"><div class="t">${c.label}</div>
      ${c.st === 'pending' ? `<button class="btn sm green" onclick="decide('${c.cid}',true)" title="Accept">✓</button><button class="btn sm" onclick="editChange('${c.cid}')" title="Edit before applying">✎</button><button class="btn sm danger" onclick="decide('${c.cid}',false)" title="Reject">✕</button>` : ''}</div>
      <div class="why">${c.why || ''}</div>
      ${c.st === 'pending' ? `<div class="diff">${diffFor(c)}</div>` : ''}
    </div>`).join('')}
    ${open ? `<div class="pf"><button class="btn sm green" onclick="decideAll('${p.id}',true)">Accept all</button><button class="btn sm" onclick="decideAll('${p.id}',false)">Reject all</button><span class="faint" style="font-size:11px;margin-left:auto">AI cannot approve or publish</span></div>` : ''}
  </div>`;
}
function editChange(cid) {
  const c = pendingChanges().find(x => x.cid === cid); if (!c) return;
  if (c.type === 'update' && c.patch.disc != null) {
    const v = prompt('Edit discount % before applying:', c.patch.disc); if (v == null) return;
    c.patch.disc = clamp(parseInt(v) || c.patch.disc, 1, 60); c.label = c.label.replace(/→ \d+%/, `→ ${c.patch.disc}%`) + ' <span class="chip">edited</span>';
  } else if (c.type === 'transfer') {
    const v = prompt('Edit transfer units:', c.t.units); if (v == null) return;
    c.t.units = Math.max(50, parseInt(v) || c.t.units); c.label = c.label.replace(/\d[\d,]* units/, `${c.t.units} units`) + ' <span class="chip">edited</span>';
  } else if (c.type === 'update' && c.patch.budget != null) {
    const v = prompt('Edit budget (₹):', c.patch.budget); if (v == null) return;
    c.patch.budget = Math.max(5000, parseInt(v) || c.patch.budget); c.label += ' <span class="chip">edited</span>';
  } else if (c.type === 'update' && c.patch.start != null) {
    const v = prompt('Edit start date offset (days from Sep 28):', c.patch.start); if (v == null) return;
    c.patch.start = clamp(parseInt(v) || c.patch.start, 0, DAYS - 2); c.label += ' <span class="chip">edited</span>';
  } else { toast('This change has no editable parameters. Accept or reject it.'); return; }
  audit(role().n, 'Edited AI change before applying', c.label.replace(/<[^>]+>/g, ''));
  render();
}
function composerHtml() {
  const sel = item(S.sel);
  const chips = ['Critique my plan', sel ? `Make ${sel.name} margin-safe` : 'Make Diwali Footwear margin-safe', 'Fill gaps', 'Why 16%?', 'Budget ₹10L → ₹6L?', 'Move the beauty campaign a week earlier', 'Split budget 60/40 between Telangana and Karnataka', 'Draft copy', '₹2L, clear aging jackets in Delhi before Diwali, margin ≥ 22%'];
  return `<div class="composer">
    <div class="chips">${chips.map(c => `<button onclick="ask(this.textContent)">${esc(c)}</button>`).join('')}</div>
    <form onsubmit="event.preventDefault();const v=this.q.value.trim();if(v){ask(v);}">
      <input name="q" placeholder="Ask or instruct… e.g. “₹10L, clear excess footwear in Telangana before Diwali, margin ≥ 22%”" autocomplete="off">
      <button class="btn ai">Send</button>
    </form>
    <div class="autonomy">Autonomy: <span class="chip">Read</span>›<span class="chip">Recommend</span>›<span class="chip ai">Draft</span>›<span class="chip">Request approval</span><span class="faint">· never approves/publishes</span></div>
  </div>`;
}
function detailsHtml() {
  const it = item(S.sel);
  if (!it) return `<div class="empty">Select a campaign card on the canvas to see details.</div>`;
  const m = sim(it, S.plan), v = violations(it, m), ed = canEdit() ? '' : 'disabled';
  const conf = conflicts(S.plan).filter(c => c.ids.includes(it.id));
  const hideCust = role().noCustomer;
  const opt = (arr, cur) => arr.map(([k, n]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${n}</option>`).join('');
  return `<div class="details">
    <div class="row between"><div class="h2" style="margin:0">${esc(it.name)}</div><span class="chip ${STATUS_CLS[it.status]}">${it.status}</span></div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">${REGIONS[it.region].n} · ${CATS[it.cat].n} · ${range(it)} · ${it.len} days</div>
    ${v.length ? `<div class="banner red" style="margin-bottom:8px"><div>⛔</div><div><b>Hard rules violated</b> — can't go to review until fixed or overridden with a reason.<div class="vlist">${v.map(x => `<div>• ${x.t}</div>`).join('')}</div><button class="btn sm ai" onclick="ask('Make ${esc(it.name)} margin-safe')">✦ Ask copilot to fix</button></div></div>` : `<div class="banner green" style="margin-bottom:8px">✓ All hard rules pass for this campaign.</div>`}
    ${conf.map(c => `<div class="banner amber" style="margin-bottom:6px">⚠ <div><b>${c.type}:</b> ${c.t}</div></div>`).join('')}
    <div class="mgrid" id="dmetrics">${metricBoxes(it, m)}</div>
    <div class="field"><label>Name</label><input value="${esc(it.name)}" ${ed} onchange="updateItem('${it.id}',{name:this.value},'renamed')"></div>
    <div class="f2">
      <div class="field"><label>Region</label><select ${ed} onchange="updateItem('${it.id}',{region:this.value},'region')">${opt(Object.entries(REGIONS).map(([k, r]) => [k, r.n]), it.region)}</select></div>
      <div class="field"><label>Category</label><select ${ed} onchange="updateItem('${it.id}',{cat:this.value},'category')">${opt(Object.entries(CATS).map(([k, c]) => [k, c.n]), it.cat)}</select></div>
    </div>
    <div class="f2">
      <div class="field"><label>Audience</label>${hideCust ? `<input disabled value="Hidden for Store Manager role">` : `<select ${ed} onchange="updateItem('${it.id}',{aud:this.value},'audience')">${Object.entries(AUD).map(([k, a]) => `<option value="${k}" ${k === it.aud ? 'selected' : ''} ${a.tier > S.tier ? 'disabled' : ''}>${a.n}${a.tier > S.tier ? ' 🔒 tier 2' : ''}</option>`).join('')}</select>`}</div>
      <div class="field"><label>Offer mechanic</label><select ${ed} onchange="updateItem('${it.id}',{mech:this.value},'mechanic')">${opt(MECH.map(x => [x, x]), it.mech)}</select></div>
    </div>
    <div class="field"><label>Discount · <b id="discv">${it.disc}%</b> <span class="faint">(cap ${S.guard.discountCap[it.cat]}%)</span></label>
      <input type="range" min="0" max="50" value="${it.disc}" ${ed} oninput="liveDisc('${it.id}',this.value)" onchange="commitDisc('${it.id}',this.value)"></div>
    <div class="f2">
      <div class="field"><label>Budget (₹)</label><input type="number" step="10000" value="${it.budget}" ${ed} onchange="updateItem('${it.id}',{budget:Math.max(0,+this.value)},'budget')"></div>
      <div class="field"><label>Status</label><select ${ed} onchange="setStatus('${it.id}',this.value)">${opt(STATUSES.map(s => [s, s]), it.status)}</select></div>
    </div>
    <label class="row" style="font-size:12.5px;margin-bottom:10px"><input type="checkbox" ${it.excl ? 'checked' : ''} ${ed} onchange="updateItem('${it.id}',{excl:this.checked},'exclude low-stock SKUs')"> Exclude low-stock SKUs / sizes</label>
    <div class="row wrap">
      <button class="btn sm primary" ${ed} onclick="sendToReview('${it.id}')">Send to review →</button>
      <button class="btn sm" onclick="S.sim.id='${it.id}';go('sim')">∿ Simulate</button>
      <button class="btn sm ai" onclick="ask('Why ${it.disc}%?')">✦ Explain</button>
      <button class="btn sm danger" ${ed} onclick="delItem('${it.id}')">Delete</button>
    </div>
    <div class="sec-t">Operational risks</div>
    ${risksHtml(opsRisks(it, m))}
    <div class="sec-t">Store view · ${REGIONS[it.region].city}</div>
    <div class="stores">${storeGrid(it, m)}</div>
    <div class="sec-t">Evidence</div>
    <div class="muted" style="font-size:12px">Forecast ${Math.round(m.B)} baseline units + ${Math.round(m.I)} incremental (elasticity ${CATS[it.cat].elast}, reach ${AUD[it.aud].reach}). ${Math.round(m.stk)} units available · inventory confidence 0.92. 23 similar past campaigns found.</div>
  </div>`;
}
function metricBoxes(it, m) {
  const G = S.guard;
  const box = (l, v, s, bad) => `<div class="mbox"><div class="l">${l}</div><div class="v" style="color:${bad ? 'var(--red)' : 'inherit'}">${v}</div><div class="s">${s}</div></div>`;
  return box('Stockout risk', pct(m.pStock * 100), `${Math.round(m.D)} units demand vs ${Math.round(m.stk)} stock`, m.pStock * 100 > G.stockoutMax)
    + box('Margin', pct(m.marginPct, 1), `after discount & spend · floor ${G.marginFloor}%`, m.marginPct < G.marginFloor)
    + box('Incremental revenue', L(m.incRev), `range ${L(m.incRev - m.sd * CATS[it.cat].price * .6)} – ${L(m.incRev + m.sd * CATS[it.cat].price * .6)}`)
    + box('Days of supply', m.dos.toFixed(1), `discount waste ${L(m.waste)}`, m.dos < it.len);
}
function storeGrid(it, m) {
  const r = rng(it.id.charCodeAt(1) * 31 + it.start);
  return REGIONS[it.region].stores.map(s => {
    const p = clamp(m.pStock + (r() - .5) * .35, 0, 1);
    const c = p > .4 ? 'r' : p > .15 ? 'a' : 'g';
    return `<div class="store ${c}" title="Stockout ${pct(p * 100)}">${s}<br><span style="font-weight:500">${pct(p * 100)}</span></div>`;
  }).join('');
}
function liveDisc(id, v) {
  const it = item(id);
  if (!drag && !S._discSnap) S._discSnap = clone(S.plan);
  it.disc = +v; $('#discv').textContent = v + '%';
  $('#dmetrics').innerHTML = metricBoxes(it, sim(it, S.plan));
  renderKpis(); renderTL();
}
function commitDisc(id, v) {
  if (S._discSnap) { S.undo.push(S._discSnap); S.redo = []; explainChange(S._discSnap, [id], 'Discount changed'); S._discSnap = null; }
  audit(role().n, 'Edited campaign', `${item(id).name}: discount → ${v}%`);
  renderPlanning();
}
function setStatus(id, st) {
  const it = item(id);
  if (['In review', 'Approved', 'Live'].includes(st)) {
    const v = violations(it, sim(it, S.plan));
    if (v.length && !S.overrides[id]) {
      const reason = prompt(`⛔ ${it.name} violates ${v.length} hard rule(s):\n• ${v.map(x => x.t).join('\n• ')}\n\nEnter an override reason to continue (recorded in audit log):`);
      if (!reason) { toast('Blocked by guardrails. Fix the campaign or give an override reason.'); renderPlanning(); return; }
      S.overrides[id] = reason; audit(role().n, 'Guardrail override', `${it.name}: "${reason}"`);
    }
  }
  if (st === 'Approved' || st === 'Live') { toast('Approval happens in Readiness & Approval (separation of duties).'); renderPlanning(); return; }
  updateItem(id, { status: st }, 'status → ' + st);
  if (st === 'In review') S.approvals[id] = S.approvals[id] || 0;
}
function sendToReview(id) { setStatus(id, 'In review'); }
function delItem(id) {
  if (!confirm('Delete this campaign? (You can undo.)')) return;
  pushUndo(); const it = item(id);
  S.plan.items = S.plan.items.filter(i => i.id !== id); audit(role().n, 'Deleted campaign', it.name);
  explainChange(lastUndo(), [id], 'Deleted campaign');
  S.sel = null; render();
}
function historyHtml() {
  return `<div class="details">
    <div class="row between"><div class="h2">Version history</div><div class="row"><button class="btn sm" onclick="undo()" ${S.undo.length ? '' : 'disabled'}>↶ Undo</button><button class="btn sm" onclick="redo()" ${S.redo.length ? '' : 'disabled'}>↷ Redo</button></div></div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Plan v${S.undo.length + 1} · ${S.undo.length} earlier version${S.undo.length === 1 ? '' : 's'} kept · data snapshot 30 Sep 06:00 · model v0.3</div>
    <div class="sec-t">Audit log</div>
    <div class="history">${S.audit.slice(0, 60).map(a => `<div><span class="faint">${a.t}</span> · <b>${esc(a.who)}</b> ${a.src === 'ai' ? '<span class="chip ai">AI</span>' : ''} ${esc(a.action)}<br><span class="muted">${esc(a.detail)}</span></div>`).join('')}</div>
  </div>`;
}

/* =====================================================================
   COPILOT (deterministic intent parser + tool calls)
   ===================================================================== */
function ask(text) {
  if (S.screen !== 'planning') { S.screen = 'planning'; render(); }
  S.chat.push({ who: 'user', html: esc(text) });
  S.copilotOpen = true; S.thinking = true; renderSide();
  audit(role().n, 'Asked copilot', text);
  setTimeout(() => {
    S.thinking = false;
    let r;
    try { r = route(text); } catch (err) { console.error(err); r = { html: 'Sorry — I could not complete that request.' }; }
    S.chat.push({ who: 'ai', ...r });
    renderPlanning();
  }, 700);
}
function findRegion(t) {
  const map = { TS: /telangana|hyderabad|\bts\b/, KA: /karnataka|bengaluru|bangalore/, MH: /maharashtra|pune|mumbai/, DL: /delhi|ncr|gurgaon|noida/ };
  return Object.keys(map).find(k => map[k].test(t));
}
function findCat(t) {
  const map = { FW: /footwear|shoe|sneaker|kicks/, AP: /apparel|fashion|jacket|ethnic|wear|clothing/, BT: /beauty|glow|cosmetic/, EL: /electronic|gadget|laptop|phone/, GR: /grocery|staples|food/ };
  return Object.keys(map).find(k => map[k].test(t));
}
function findItem(t) {
  const its = visibleItems(S.plan.items);
  const byName = its.find(i => t.includes(i.name.toLowerCase()));
  if (byName) return byName;
  const c = findCat(t), r = findRegion(t);
  const cand = its.filter(i => (!c || i.cat === c) && (!r || i.region === r));
  if ((c || r) && cand.length) return cand.sort((a, b) => sim(b, S.plan).pStock - sim(a, S.plan).pStock)[0];
  if (/this|selected|it\b/.test(t) && item(S.sel)) return item(S.sel);
  return null;
}
function route(text) {
  const t = text.toLowerCase();
  if (/critique|review my|check (the|my) plan|what.*wrong|issues|problems/.test(t)) return critique();
  if (/what.?if|budget.*(→|->|to)\s*₹?\s*\d/.test(t) && /budget/.test(t) && !/split/.test(t)) return whatIfBudget(t);
  if (/split/.test(t)) return splitBudget(t);
  if (/(₹|rs\.?|inr)?\s*\d+(\.\d+)?\s*(l|lakh|lac)\b/.test(t) && /clear|plan|launch|campaign|promot|sell/.test(t)) return brief(t);
  if (/why/.test(t)) return explain(t);
  if (/move|shift|earlier|later|postpone|prepone/.test(t)) return moveCmd(t);
  if (/margin.?safe|fix|optimi[sz]e|improve|safer/.test(t)) { const it = findItem(t) || worstItem(); return fixFor(it); }
  if (/gap|fill|idle|aging|ageing|overstock/.test(t)) return fillGaps();
  if (/copy|headline|whatsapp|message|creative|draft/.test(t)) return draftCopy(t);
  if (/conflict/.test(t)) return critique();
  return { html: `I can help with:<ul><li><b>Critique</b> the plan</li><li><b>Fix</b> a campaign (“make it margin-safe”)</li><li><b>Plan from a brief</b> (“₹2L, clear jackets in Delhi before Diwali, margin ≥ 22%”)</li><li><b>Move / split</b> (“move beauty a week earlier”)</li><li><b>What-if</b> (“budget ₹10L → ₹6L?”)</li><li><b>Explain</b> (“why 16%?”) and <b>draft copy</b></li></ul>` };
}
function worstItem() { const T = planTotals(S.plan); const v = visibleItems(S.plan.items).filter(i => T.per[i.id].viol.length); return (v.sort((a, b) => T.per[b.id].pStock - T.per[a.id].pStock)[0]) || T.worst.it; }

function critique() {
  const T = planTotals(S.plan);
  const lines = [];
  visibleItems(S.plan.items).forEach(it => {
    const m = T.per[it.id];
    if (m.viol.length) lines.push(`<li>⛔ <b>${esc(it.name)}</b> (${REGIONS[it.region].city}): ${Math.round(m.stk)} units in stock (${m.dos.toFixed(1)} days of supply) but demand is forecast at <b>${Math.round(m.D)}</b> units → <b>${pct(m.pStock * 100)} stockout risk</b>; margin ${pct(m.marginPct, 1)} vs ${S.guard.marginFloor}% floor. ${AUD[it.aud].n === 'All shoppers' ? `A blanket ${it.disc}% gives away ${L(m.waste)} to shoppers who would buy anyway.` : ''}</li>`);
  });
  T.conf.forEach(c => lines.push(`<li>⚠ <b>${c.type}:</b> ${c.t}</li>`));
  const gap = gapCandidate();
  if (gap) lines.push(`<li>💡 <b>Gap:</b> ${gap.text}</li>`);
  const target = worstItem();
  const fix = target && T.per[target.id].viol.length ? buildFix(target) : null;
  return {
    html: `I checked all ${S.plan.items.length} campaigns against live inventory, forecast and guardrails. <b>${T.nViol} campaign${T.nViol === 1 ? '' : 's'} break hard rules and ${T.conf.length} conflict${T.conf.length === 1 ? '' : 's'} found:</b><ul>${lines.join('')}</ul>${fix ? `Here's a change set for <b>${esc(target.name)}</b>. Each change is validated by the simulator. Accept, edit or reject each one:` : ''}`,
    prop: fix ? newProposal(fix.title, fix.changes, fix.evidence) : null,
    evidence: 'Moderate',
    tools: ['get_forecast(all)', 'get_inventory(all)', 'check_constraints', 'find_conflicts', fix ? 'optimize(c)' : '', fix ? 'suggest_transfer' : '', 'simulate'].filter(Boolean)
  };
}
function buildFix(it) {
  const changes = [];
  // optimize assuming a transfer is available from the best donor
  const donor = donorFor(S.plan, it.region, it.cat);
  const p2 = clone(S.plan); if (donor) p2.transfers.push({ from: donor.r, to: it.region, cat: it.cat, units: donor.surplus });
  const best = optimize({ ...it }, p2);
  if (!best) return null;
  const b = best.it;
  if (b.disc !== it.disc) changes.push({ type: 'update', id: it.id, patch: { disc: b.disc }, label: `Cut discount ${it.disc}% → ${b.disc}%`, why: `Highest incremental profit that clears the ${S.guard.marginFloor}% margin floor. Deeper discounts mostly subsidise shoppers who would buy anyway.` });
  if (b.aud !== it.aud) changes.push({ type: 'update', id: it.id, patch: { aud: b.aud }, label: `Target “${AUD[b.aud].n}” instead of “${AUD[it.aud].n}”`, why: `Uplift model: this segment responds ${Math.round(AUD[b.aud].reach / AUD[it.aud].reach * 100)}% as strongly while receiving only ${Math.round(AUD[b.aud].share * 100)}% of discounted units. That cuts discount waste.` });
  if (b.excl !== it.excl) changes.push({ type: 'update', id: it.id, patch: { excl: b.excl }, label: `Exclude low-stock SKUs / sizes`, why: 'Removes sizes with under 3 units per store, which avoids stranded demand.' });
  // budget trim if over cap or on the flat part of the response curve
  const ref = BASE[it.region][it.cat][0] * it.len * CATS[it.cat].price * .025;
  const eff = Math.ceil(ref * 1.44 / 10000) * 10000;
  const spend = S.plan.items.reduce((s, x) => s + x.budget, 0);
  if (it.budget > eff * 1.05) changes.push({ type: 'update', id: it.id, patch: { budget: eff }, label: `Trim budget ${L(it.budget)} → ${L(eff)}`, why: `Response curve is flat above ${L(eff)} (diminishing reach). ${spend > S.guard.budgetCap ? `Also brings the plan back toward the ${L(S.guard.budgetCap)} cap.` : ''}` });
  // transfer needed for the chosen config
  const pAfter = clone(S.plan); changes.forEach(c => applyChange(pAfter, c));
  const need = transferNeed(pAfter, pAfter.items.find(x => x.id === it.id));
  if (need > 0 && donor) {
    const units = Math.min(need, donor.surplus);
    changes.push({ type: 'transfer', t: { from: donor.r, to: it.region, cat: it.cat, units }, label: `Transfer ${units} units from ${REGIONS[donor.r].city} → ${REGIONS[it.region].city}`, why: `${REGIONS[donor.r].city} holds ${stockOf(S.plan, donor.r, it.cat)} ${CATS[it.cat].n.toLowerCase()} units with ${Math.round(donor.surplus)} surplus after its own plans. 2-day lead time; arrives before ${ds(it.start)}.` });
  }
  // merge overlapping same-SKU campaign
  S.plan.items.filter(x => x.id !== it.id && x.region === it.region && x.cat === it.cat && overlap(x, it)).forEach(x =>
    changes.push({ type: 'delete', id: x.id, label: `Merge “${esc(x.name)}” into this campaign`, why: `Overlaps ${x.len} days on the same SKUs and audience, which cannibalizes demand and adds contact pressure.` }));
  return { title: `Fix: ${it.name}`, changes, evidence: 'Moderate' };
}
function fixFor(it) {
  if (!it) return { html: 'I could not find that campaign. Try selecting it on the canvas first.' };
  const m = sim(it, S.plan), v = violations(it, m);
  const fix = buildFix(it);
  if (!fix || !fix.changes.length) return { html: `<b>${esc(it.name)}</b> is already close to optimal: margin ${pct(m.marginPct, 1)}, stockout ${pct(m.pStock * 100)}. No changes suggested.`, tools: ['simulate', 'optimize'] };
  return {
    html: `<b>${esc(it.name)}</b> today: stockout ${pct(m.pStock * 100)}, margin ${pct(m.marginPct, 1)}${v.length ? `, <span class="chip red">${v.length} rule${v.length > 1 ? 's' : ''} broken</span>` : ''}. I searched ${S.tier >= 2 ? 4 : 1} audiences × ${S.guard.discountCap[it.cat] - 4} discount levels × SKU scope under your guardrails. Proposed change set (shown as ghost cards on the canvas):`,
    prop: newProposal(fix.title, fix.changes, fix.evidence), evidence: 'Moderate',
    tools: ['get_inventory(' + it.region + ',' + it.cat + ')', 'get_forecast', 'get_segments', 'optimize(constraints)', 'suggest_transfer', 'simulate ×' + (S.guard.discountCap[it.cat] - 4) * 8, 'check_constraints']
  };
}
function gapCandidate() {
  let best = null;
  for (const r of rowKeysAll('region')) for (const c in CATS) {
    const cov = stockOf(S.plan, r, c) / BASE[r][c][0];
    const active = S.plan.items.some(i => i.region === r && i.cat === c && i.start < 41);
    if (!active && cov > 55 && (!best || cov > best.cov)) best = { r, c, cov };
  }
  if (!best) return null;
  const units = stockOf(S.plan, best.r, best.c);
  best.text = `${REGIONS[best.r].city} has ${units.toLocaleString('en-IN')} ${best.c === 'AP' ? 'aging jackets / apparel' : CATS[best.c].n.toLowerCase()} units (${Math.round(best.cov)} days of cover) and no campaign before Diwali. Weeks 3–4 are empty for this row.`;
  return best;
}
function fillGaps() {
  const gap = gapCandidate();
  if (!gap) return { html: 'No meaningful gaps: every overstocked row already has a campaign before Diwali.' , tools: ['get_inventory(all)', 'find_gaps'] };
  const base = { id: nid('c'), name: gap.c === 'AP' ? `Aging Jacket Clearance · ${REGIONS[gap.r].city}` : `${CATS[gap.c].n} Clearance · ${REGIONS[gap.r].city}`, region: gap.r, cat: gap.c, start: 14, len: 8, disc: 20, aud: 'all', budget: 60000, status: 'Proposed', mech: '% off', excl: false };
  const best = optimize(base, S.plan);
  const it = best ? { ...best.it, excl: false } : base;
  const m = sim(it, S.plan);
  return {
    html: `💡 ${gap.text}<br>Suggested clearance in week 3 (before the Dussehra peak):`,
    prop: newProposal('Fill gap: clearance', [{ type: 'create', item: it, label: `Create “${esc(it.name)}” · ${range(it)} · ${it.disc}% · ${AUD[it.aud].n}`, why: `Clears ~${Math.round(m.sold)} units (${Math.round(m.sold / m.stk * 100)}% of stock) at ${pct(m.marginPct, 1)} margin. Budget ${L(it.budget)} still fits under the cap.` }], 'Moderate'),
    evidence: 'Moderate', tools: ['get_inventory(all)', 'find_gaps', 'optimize', 'simulate', 'check_constraints']
  };
}
function brief(t) {
  const bm = t.match(/(\d+(?:\.\d+)?)\s*(l|lakh|lac)\b/); const budget = bm ? parseFloat(bm[1]) * 1e5 : 100000;
  const region = findRegion(t) || 'TS', cat = findCat(t) || 'FW';
  const mm = t.match(/margin\s*(?:≥|>=|>|of|at least|above)?\s*(\d+)/); const floor = mm ? +mm[1] : S.guard.marginFloor;
  const beforeDiwali = /before diwali/.test(t);
  const parsed = `<div class="banner ai" style="margin-bottom:8px">Parsed brief → budget <b>${L(budget)}</b> · <b>${REGIONS[region].n}</b> · <b>${CATS[cat].n}</b> · goal <b>${/clear/.test(t) ? 'clear stock' : 'grow revenue'}</b> · margin ≥ <b>${floor}%</b>${beforeDiwali ? ' · end before <b>Diwali (8 Nov)</b>' : ''}</div>`;
  const existing = S.plan.items.find(i => i.region === region && i.cat === cat && i.start < 41 && i.start + i.len > 25);
  if (existing) {
    const r = fixFor(existing);
    r.html = parsed + `There's already <b>${esc(existing.name)}</b> for this scope, so I'll improve it instead of adding a duplicate.<br>` + r.html;
    return r;
  }
  const len = 10, start = beforeDiwali ? 41 - len : TODAY + 10;
  const base = { id: nid('c'), name: `${/clear/.test(t) ? 'Clearance' : 'Festive'} ${CATS[cat].n} · ${REGIONS[region].city}`, region, cat, start, len, disc: 15, aud: 'uplift', budget: Math.min(budget, Math.max(20000, S.guard.budgetCap - S.plan.items.reduce((s, x) => s + x.budget, 0)), 150000), status: 'Proposed', mech: '% off', excl: false };
  const best = optimize(base, S.plan, { floor });
  if (!best) return { html: parsed + `⛔ No feasible plan: every discount/audience combination breaks margin ≥ ${floor}% or the stockout limit. Consider a smaller scope or a stock transfer first.`, evidence: 'Strong', tools: ['optimize', 'check_constraints'] };
  const it = best.it, m = best.m;
  const changes = [{ type: 'create', item: it, label: `Create “${esc(it.name)}” · ${range(it)} · ${it.disc}% · ${AUD[it.aud].n} · ${L(it.budget)}`, why: `Optimizer pick. Sells ~${Math.round(m.sold)} units, margin ${pct(m.marginPct, 1)}, stockout ${pct(m.pStock * 100)}.` }];
  if (it.budget < budget) changes[0].why += ` Budget capped at ${L(it.budget)}: returns flatten above that and the plan budget is nearly used.`;
  return { html: parsed + 'Draft plan (ghost cards on the canvas). Validated against guardrails:', prop: newProposal('Brief → draft plan', changes, 'Moderate'), evidence: 'Moderate', tools: ['parse_brief', 'get_forecast(' + region + ',' + cat + ')', 'get_inventory', 'get_segments', 'optimize(constraints)', 'simulate', 'check_constraints'] };
}
function explain(t) {
  const it = findItem(t) || item(S.sel) || item('c1');
  const nm = t.match(/(\d+)\s*%/);
  const ask = nm ? +nm[1] : it.disc;
  const levels = [...new Set([10, ask, 16, 20, 25, it.disc])].filter(x => x <= 40).sort((a, b) => a - b);
  const aud = it.aud === 'all' && S.tier >= 2 ? 'uplift' : it.aud;
  const rows = levels.map(d => { const x = { ...it, disc: d, aud }; const m = sim(x, S.plan); const v = violations(x, m); return { d, m, v }; });
  const best = rows.filter(r => !r.v.length).sort((a, b) => b.m.incProfit - a.m.incProfit)[0];
  return {
    html: `Why ${ask}% for <b>${esc(it.name)}</b> (audience: ${AUD[aud].n})? Simulated alternatives:
    <table class="t" style="margin:6px 0;font-size:11.5px"><tr><th>Disc.</th><th>Inc. profit</th><th>Margin</th><th>Stockout</th><th>Waste</th></tr>
    ${rows.map(r => `<tr style="${best && r.d === best.d ? 'background:var(--green-bg);font-weight:600' : ''}"><td>${r.d}%${r.d === ask ? ' ←' : ''}</td><td>${L(r.m.incProfit)}</td><td style="color:${r.m.marginPct < S.guard.marginFloor ? 'var(--red)' : ''}">${pct(r.m.marginPct, 1)}</td><td style="color:${r.m.pStock * 100 > S.guard.stockoutMax ? 'var(--red)' : ''}">${pct(r.m.pStock * 100)}</td><td>${L(r.m.waste)}</td></tr>`).join('')}</table>
    <b>What drives it:</b><ul><li>Price elasticity ${CATS[it.cat].elast} (fit on 14 past ${CATS[it.cat].n.toLowerCase()} promos): each extra point of discount adds less volume</li><li>Discount waste: ${Math.round(AUD[aud].share * 100)}% of buyers in the window get the discount whether or not they're incremental</li><li>Stock ceiling: ${Math.round(stockOf(S.plan, it.region, it.cat))} units. Above ~${best ? best.d : '?'}% demand outruns stock and extra discount only adds cost</li><li>Constraints: margin ≥ ${S.guard.marginFloor}%, stockout ≤ ${S.guard.stockoutMax}%, cap ${S.guard.discountCap[it.cat]}%</li></ul>
    ${best ? `Best feasible option: <b>${best.d}%</b>.` : 'No level is feasible at current stock, so consider a transfer.'} Confidence is moderate: the elasticity comes from a small sample. For a first run, I'd <b>pilot</b> in 2 stores.`,
    evidence: 'Moderate', tools: ['simulate ×' + levels.length, 'explain_features', 'check_constraints']
  };
}
function moveCmd(t) {
  const it = findItem(t);
  if (!it) return { html: 'Which campaign? Mention it by name, category or region (e.g. “move the beauty campaign a week earlier”).' };
  let n = /week/.test(t) ? 7 : 1; const dm = t.match(/(\d+)\s*(day|week)/); if (dm) n = +dm[1] * (dm[2] === 'week' ? 7 : 1);
  const dir = /earlier|prepone|back|before/.test(t) ? -1 : 1;
  const ns = clamp(it.start + dir * n, 0, DAYS - it.len);
  const m0 = sim(it, S.plan), m1 = sim({ ...it, start: ns }, S.plan);
  return {
    html: `Moving <b>${esc(it.name)}</b> ${n} day${n > 1 ? 's' : ''} ${dir < 0 ? 'earlier' : 'later'} → ${ds(ns)} – ${ds(ns + it.len - 1)}. Demand forecast changes ${Math.round(m0.D)} → ${Math.round(m1.D)} units (${m1.D > m0.D ? 'closer to' : 'further from'} the festive peak).`,
    prop: newProposal('Reschedule', [{ type: 'update', id: it.id, patch: { start: ns }, label: `Move “${esc(it.name)}” to ${ds(ns)} – ${ds(ns + it.len - 1)}`, why: `Ghost card shows the new position. ${EVENTS.filter(e => e.d >= ns && e.d < ns + it.len).map(e => e.n).join(', ') || 'No festival'} in window.` }], 'Strong'),
    evidence: 'Strong', tools: ['get_forecast', 'simulate', 'find_conflicts']
  };
}
function splitBudget(t) {
  const nums = t.match(/(\d+)\s*\/\s*(\d+)/); const a = nums ? +nums[1] / 100 : .6, b = nums ? +nums[2] / 100 : .4;
  const regs = []; const map = { TS: /telangana|hyderabad/, KA: /karnataka|bengaluru|bangalore/, MH: /maharashtra|pune/, DL: /delhi/ };
  const order = Object.keys(map).map(k => ({ k, i: t.search(map[k]) })).filter(x => x.i >= 0).sort((x, y) => x.i - y.i).map(x => x.k);
  regs.push(...order); if (regs.length < 2) return { html: 'Please name two regions, e.g. “split budget 60/40 between Telangana and Karnataka”.' };
  const [r1, r2] = regs;
  const its1 = S.plan.items.filter(i => i.region === r1), its2 = S.plan.items.filter(i => i.region === r2);
  const pool = [...its1, ...its2].reduce((s, x) => s + x.budget, 0);
  const changes = [];
  const alloc = (its, share) => { const tot = its.reduce((s, x) => s + x.budget, 0) || 1; its.forEach(x => { const nb = Math.round(pool * share * x.budget / tot / 5000) * 5000; if (nb !== x.budget) changes.push({ type: 'update', id: x.id, patch: { budget: nb }, label: `${esc(x.name)}: budget ${L(x.budget)} → ${L(nb)}`, why: `${REGIONS[x.region].n} share ${Math.round(share * 100)}%` }); }); };
  alloc(its1, a); alloc(its2, b);
  return { html: `Pooled ${L(pool)} across ${REGIONS[r1].n} and ${REGIONS[r2].n}, split ${Math.round(a * 100)}/${Math.round(b * 100)} and allocated in proportion to each campaign's current budget:`, prop: newProposal(`Split budget ${Math.round(a * 100)}/${Math.round(b * 100)}`, changes, 'Strong'), evidence: 'Strong', tools: ['get_plan', 'allocate_budget', 'simulate', 'check_constraints'] };
}
function whatIfBudget(t) {
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(l|lakh)/g)].map(m => parseFloat(m[1]) * 1e5);
  const target = nums.length ? nums[nums.length - 1] : 600000;
  const T0 = planTotals(S.plan);
  // greedy: trim lowest incremental-profit-per-rupee first; never touch Live/Approved
  const p = clone(S.plan); const changes = [];
  let spend = p.items.reduce((s, x) => s + x.budget, 0);
  const ranked = p.items.filter(i => !['Live', 'Approved'].includes(i.status)).map(i => ({ i, r: sim(i, p).incProfit / i.budget })).sort((a, b) => a.r - b.r);
  for (const { i } of ranked) {
    if (spend <= target) break;
    const cut = Math.min(i.budget - 20000, spend - target);
    if (cut <= 0) continue;
    const nb = Math.round((i.budget - cut) / 5000) * 5000;
    changes.push({ type: 'update', id: i.id, patch: { budget: nb }, label: `${esc(i.name)}: ${L(i.budget)} → ${L(nb)}`, why: `Lowest return per ₹ (${(sim(i, p).incProfit / i.budget).toFixed(2)}×)` });
    spend -= i.budget - nb; i.budget = nb;
  }
  const T1 = planTotals(p);
  return {
    html: `What-if: budget ${L(S.guard.budgetCap)} → <b>${L(target)}</b>. I cut the lowest-return campaigns first and left Live and Approved ones alone.
    <table class="t" style="margin:6px 0;font-size:11.5px"><tr><th></th><th>Now</th><th>At ${L(target)}</th></tr>
    <tr><td>Spend</td><td>${L(T0.spend)}</td><td>${L(T1.spend)}</td></tr>
    <tr><td>Inc. revenue</td><td>${L(T0.inc)}</td><td>${L(T1.inc)}</td></tr>
    <tr><td>Plan margin</td><td>${pct(T0.margin, 1)}</td><td>${pct(T1.margin, 1)}</td></tr>
    <tr><td>Rule violations</td><td>${T0.nViol}</td><td>${T1.nViol}</td></tr></table>
    ${spend > target ? `<span class="chip amber">Can't reach ${L(target)} without cutting approved campaigns (floor ${L(spend)}).</span>` : ''} Trade-off: less reach means lower volume, but margin improves because spend is lower.`,
    prop: changes.length ? newProposal(`What-if: budget ${L(target)}`, changes, 'Moderate') : null, evidence: 'Moderate', tools: ['simulate(plan)', 'rank_roi', 'optimize(budget)']
  };
}
function copyFor(it, tone) {
  const city = REGIONS[it.region].city, c = CATS[it.cat].n, off = it.disc;
  const sets = {
    standard: { head: `${c} for the festive season, up to ${off}% off`, push: `Your Diwali look starts here: ${off}% off selected ${c.toLowerCase()} at ${city} stores & online. Offer ends ${ds(it.start + it.len - 1)}.`, wa: `Hi! 🪔 Diwali is almost here. Enjoy ${off}% off selected ${c.toLowerCase()} till ${ds(it.start + it.len - 1)}. T&C apply.`, banner: `Up to ${off}% off ${c} · Till ${ds(it.start + it.len - 1)}` },
    premium: { head: `Crafted for celebration. ${c}, now ${off}% off`, push: `An invitation to celebrate: the festive ${c.toLowerCase()} edit, ${off}% off for a limited period.`, wa: `Namaste 🪔 Our festive ${c.toLowerCase()} edit is ${off}% off until ${ds(it.start + it.len - 1)}. T&C apply.`, banner: `The Festive Edit · ${off}% off` },
    hindi: { head: `त्योहार की ख़ुशियाँ, ${c} पर ${off}% तक की छूट`, push: `इस दिवाली ${city} में चुनिंदा ${c} पर ${off}% की छूट। ऑफ़र ${ds(it.start + it.len - 1)} तक।`, wa: `नमस्ते 🪔 दिवाली ऑफ़र: चुनिंदा ${c} पर ${off}% छूट। नियम व शर्तें लागू।`, banner: `${c} पर ${off}% तक छूट` },
    telugu: { head: `పండుగ సంబరాలు, ${c} పై ${off}% వరకు తగ్గింపు`, push: `ఈ దీపావళికి ${city}లో ఎంపిక చేసిన ${c} పై ${off}% తగ్గింపు.`, wa: `నమస్తే 🪔 దీపావళి ఆఫర్: ${c} పై ${off}% తగ్గింపు. షరతులు వర్తిస్తాయి.`, banner: `${c} పై ${off}% తగ్గింపు` }
  };
  return sets[tone] || sets.standard;
}
function draftCopy(t) {
  const it = findItem(t) || item(S.sel) || item('c1');
  const tone = /premium/.test(t) ? 'premium' : /hindi/.test(t) ? 'hindi' : /telugu/.test(t) ? 'telugu' : 'standard';
  const cp = copyFor(it, tone);
  return {
    html: `Draft copy for <b>${esc(it.name)}</b> (${tone} tone):<div class="copybox" style="margin-top:6px"><div class="ch">Headline</div>${esc(cp.head)}</div><div class="copybox"><div class="ch">Push</div>${esc(cp.push)}</div><div class="copybox"><div class="ch">WhatsApp (template)</div>${esc(cp.wa)}</div>
    <span class="chip green">✓ Guardrails: no fake urgency · honest reference price · T&amp;C present</span><br><span class="muted" style="font-size:11.5px">Copy auto-changes are pre-approved as low-risk, but they're still logged. Final sign-off happens in Readiness &amp; Approval.</span>`,
    evidence: 'Strong', tools: ['draft_copy', 'check_claims', 'check_forbidden_terms']
  };
}

/* =====================================================================
   CONTROL TOWER
   ===================================================================== */
function renderControl() {
  const T = planTotals(S.plan), P = PROFILES[S.profile];
  const risky = visibleItems(S.plan.items).filter(i => T.per[i.id].viol.length);
  const inReview = S.plan.items.filter(i => i.status === 'In review');
  const overBudget = T.spend > S.guard.budgetCap;
  const dateTxt = dayDate(TODAY).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const todos = [];
  if (risky.length) { const w = risky[0], m = T.per[w.id]; todos.push({ t: `Resolve risk on ${esc(w.name)}`, s: `${pct(m.pStock * 100)} stockout risk · margin ${pct(m.marginPct, 1)}`, a: `S.sel='${w.id}';ask('Make ${esc(w.name)} margin-safe')`, b: 'Fix with AI' }); }
  if (overBudget) todos.push({ t: 'Bring the plan within budget', s: `${L(T.spend)} planned against a ${L(S.guard.budgetCap)} cap`, a: `go('planning')`, b: 'Open plan' });
  if (inReview.length) todos.push({ t: `Approve ${inReview.length} campaign${inReview.length > 1 ? 's' : ''}`, s: inReview.map(i => esc(i.name)).join(' · '), a: `S.apprSel='${inReview[0].id}';go('approvals')`, b: 'Review' });
  const n = todos.length;
  const headline = n ? `${['No', 'One', 'Two', 'Three'][n]} decision${n > 1 ? 's' : ''} <em>need${n > 1 ? '' : 's'} you</em> today.` : `Your plan is <em>on track</em>.`;
  const dot = ok => `<span class="dot ${ok ? 'g' : 'r'}"></span>`;
  $('#content').innerHTML = `
  <div class="home">
    <div class="eyebrow">${dateTxt} · Diwali in ${41 - TODAY} days</div>
    <h2>Good morning. ${headline}</h2>
    <p class="lead">Your ${P.n.toLowerCase()} Diwali plan at a glance. Every figure is simulated against live stock, margin and budget.</p>
    <div class="cta">
      <button class="btn primary" onclick="go('planning')">Open Planning Canvas →</button>
      <button class="btn" onclick="showBrief()">Read 30-second brief</button>
    </div>

    <div class="metrics">
      <div class="metric"><div class="l">${dot(T.inc > 0)} Incremental revenue</div><div class="v">${L(T.inc)}</div><div class="s">likely ${L(T.incLo)} – ${L(T.incHi)}</div></div>
      <div class="metric"><div class="l">${dot(T.margin >= S.guard.marginFloor)} Plan margin</div><div class="v">${pct(T.margin, 1)}</div><div class="s">floor ${S.guard.marginFloor}%</div></div>
      <div class="metric"><div class="l">${dot(!overBudget)} Budget committed</div><div class="v">${L(T.spend)}</div><div class="s">of ${L(S.guard.budgetCap)}</div></div>
    </div>

    ${n ? `<div class="home-sec"><h3>Needs your attention</h3>
      ${todos.map((x, i) => `<div class="todo"><div class="n">${i + 1}</div><div class="t"><b>${x.t}</b><span>${x.s}</span></div><button class="btn sm" onclick="${x.a}">${x.b} →</button></div>`).join('')}
    </div>` : ''}

    <div class="home-sec"><h3>Go to</h3>
      <div class="tiles">
        <button class="tile" onclick="go('planning')"><div class="i">▦</div><b>Plan</b><span>Build campaigns with the AI copilot</span></button>
        <button class="tile" onclick="go('sim')"><div class="i">∿</div><b>Simulate</b><span>Test decisions before committing</span></button>
        <button class="tile" onclick="go('approvals')"><div class="i">✓</div><b>Approve</b><span>Readiness and sign-off</span></button>
        <button class="tile" onclick="go('war')"><div class="i">◉</div><b>Monitor</b><span>Live results and learning</span></button>
      </div>
    </div>
  </div>`;
}
function showBrief() {
  const T = planTotals(S.plan);
  const el = document.createElement('div');
  el.className = 'modal-bg';
  el.onclick = e => { if (e.target === el) el.remove(); };
  el.innerHTML = `<div class="modal brief-modal" style="width:520px">
    <div class="eyebrow" style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--gold);font-weight:600">Executive brief</div>
    <h3 style="font-family:Fraunces,Georgia,serif;font-weight:500;font-size:22px;margin:6px 0 14px;color:var(--navy)">Diwali 2026 plan</h3>
    <p><b>Recommendation.</b> Replace blanket discounts with targeted offers, and move footwear stock from Pune to Hyderabad before 31 Oct.</p>
    <p><b>Main risk.</b> ${T.worst ? `${esc(T.worst.it.name)}: ${pct(T.worst.m.pStock * 100)} stockout risk.` : 'None.'}</p>
    <p><b>Action.</b> Accept the copilot's change set, then route it to Merchandising and Supply Chain.</p>
    <p><b>Confidence.</b> Moderate. The elasticity comes from 14 past promotions, so pilot in two stores first.</p>
    <p><b>Decision required.</b> Approve ${L(T.spend)} of plan spend (cap ${L(S.guard.budgetCap)}).</p>
    <div style="text-align:right;margin-top:14px"><button class="btn primary" onclick="this.closest('.modal-bg').remove()">Done</button></div>
  </div>`;
  document.body.appendChild(el);
}

/* =====================================================================
   SIMULATION LAB
   ===================================================================== */
function monteCarlo(it, plan, n = 2000, o = {}) {
  const r = rng(42), out = [];
  for (let k = 0; k < n; k++) {
    const dm = Math.max(.3, 1 + normal(r) * sigma()) * (o.demandMult ?? 1);
    const lm = Math.max(0, 1 + normal(r) * .15) * (o.liftMult ?? 1);
    const sm = (.92 + r() * .08) * (o.stockMult ?? 1);
    const m = sim(it, plan, { demandMult: dm, liftMult: lm, stockMult: sm });
    out.push({ rev: m.revenue, margin: m.marginPct, so: m.D > m.stk, inc: m.incRev });
  }
  return out;
}
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
function renderSim() {
  const it = item(S.sim.id) || S.plan.items[0];
  S.sim.id = it.id;
  const st = S.sim.stress;
  const o = { demandMult: st.demand ? 1.3 : 1, stockMult: st.supplier ? .7 : 1, liftMult: st.competitor ? .65 : 1 };
  const mc = monteCarlo(it, S.plan, 2000, o);
  const revs = mc.map(x => x.rev), pSO = mc.filter(x => x.so).length / mc.length, pMB = mc.filter(x => x.margin < S.guard.marginFloor).length / mc.length;
  const lo = q(revs, .02), hi = q(revs, .98), bins = 36, h = new Array(bins).fill(0);
  revs.forEach(v => { const b = clamp(Math.floor((v - lo) / (hi - lo) * bins), 0, bins - 1); h[b]++; });
  const mx = Math.max(...h), p10 = q(revs, .1), p50 = q(revs, .5), p90 = q(revs, .9);
  const cf = [...new Set([10, 16, 20, 25, it.disc])].sort((a, b) => a - b).map(d => { const x = { ...it, disc: d }; const m = sim(x, S.plan, o); return { d, m, v: violations(x, m) }; });
  const bestCf = cf.filter(r => !r.v.length).sort((a, b) => b.m.incProfit - a.m.incProfit)[0];
  // resilience: pass rate across stress scenarios
  const scen = [{ n: 'Base', o: {} }, { n: 'Demand +30%', o: { demandMult: 1.3 } }, { n: 'Supplier delay 5d', o: { stockMult: .7 } }, { n: 'Competitor promo', o: { liftMult: .65 } }, { n: 'Demand −20%', o: { demandMult: .8 } }];
  const scenR = scen.map(s => { const m = sim(it, S.plan, s.o); const v = violations(it, m); return { ...s, m, ok: !v.length }; });
  const resil = Math.round(scenR.filter(s => s.ok).length / scenR.length * 100);
  const m0 = sim(it, S.plan, o);
  const agents = agentViews(it, m0);
  $('#content').innerHTML = `
  <div class="row wrap" style="margin-bottom:14px">
    <label class="pill-select">Campaign <select onchange="S.sim.id=this.value;renderSim()">${S.plan.items.map(i => `<option value="${i.id}" ${i.id === it.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
    <span class="muted">${REGIONS[it.region].city} · ${CATS[it.cat].n} · ${range(it)} · ${it.disc}% · ${AUD[it.aud].n}</span>
    <div style="flex:1"></div>
    <span class="chip">2,000 Monte Carlo runs · σ ${sigma()}</span>
  </div>
  <div class="grid" style="grid-template-columns:2fr 1fr">
    <div class="card"><div class="card-h">Digital twin: revenue distribution <span class="muted">· ranges, not point estimates</span></div><div class="card-b">
      <div class="hist">${h.map((c, i) => { const v = lo + (i + .5) * (hi - lo) / bins; return `<i class="${v >= p10 && v <= p90 ? 'p' : ''}" style="height:${c / mx * 100}%" title="${L(v)}: ${c} runs"></i>`; }).join('')}</div>
      <div class="row between muted" style="font-size:11px;margin-top:4px"><span>${L(lo)}</span><span>P10 ${L(p10)} · <b style="color:var(--text)">P50 ${L(p50)}</b> · P90 ${L(p90)}</span><span>${L(hi)}</span></div>
      <div class="grid g4" style="margin-top:14px">
        <div class="mbox"><div class="l">P(stockout)</div><div class="v" style="color:${pSO * 100 > S.guard.stockoutMax ? 'var(--red)' : ''}">${pct(pSO * 100)}</div><div class="s">limit ${S.guard.stockoutMax}%</div></div>
        <div class="mbox"><div class="l">P(margin breach)</div><div class="v" style="color:${pMB > .3 ? 'var(--red)' : ''}">${pct(pMB * 100)}</div><div class="s">below ${S.guard.marginFloor}%</div></div>
        <div class="mbox"><div class="l">Fulfillment load</div><div class="v">${Math.round(m0.sold / it.len)}/day</div><div class="s">units across ${REGIONS[it.region].stores.length} stores</div></div>
        <div class="mbox"><div class="l">Pull-forward</div><div class="v">−${Math.round(m0.I * .12)}</div><div class="s">units borrowed from next 2 wks</div></div>
      </div>
    </div></div>
    <div class="card"><div class="card-h">Confidence panel</div><div class="card-b" style="font-size:12.5px">
      <div class="sec-t" style="margin-top:0">Known</div><div>✓ Stock by store (confidence 0.92)</div><div>✓ Baseline demand: 2 yrs of POS</div><div>✓ Festive seasonality</div>
      <div class="sec-t">Uncertain</div><div>~ Elasticity (14 promos, CI ±25%)</div><div>~ Competitor response</div><div>✗ Weather impact (no data)</div>
      <div class="sec-t">Recommendation</div>
      <div class="banner ${pSO * 100 > S.guard.stockoutMax || pMB > .4 ? 'red' : pMB > .15 ? 'amber' : 'green'}">${pSO * 100 > S.guard.stockoutMax || pMB > .4 ? '⛔ Do not proceed as-is. Fix it on the canvas first.' : pMB > .15 ? '🧪 <b>Pilot</b> in 2 stores for 3 days, then scale.' : '✓ <b>Proceed.</b> Risk is within guardrails.'}</div>
    </div></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-h">Counterfactual: “Why not ${cf.find(x => x.d === 20) ? '20' : cf[cf.length - 1].d}%?”</div><div class="card-b" style="padding:0">
      <table class="t cf-table"><tr><th>Discount</th><th>Revenue</th><th>Inc. profit</th><th>Margin</th><th>Stockout</th><th>Rules</th></tr>
      ${cf.map(r => `<tr><td class="${bestCf && r.d === bestCf.d ? 'best' : ''}">${r.d}%${r.d === it.disc ? ' (current)' : ''}${bestCf && r.d === bestCf.d ? ' ★' : ''}</td><td>${L(r.m.revenue)}</td><td>${L(r.m.incProfit)}</td><td>${pct(r.m.marginPct, 1)}</td><td>${pct(r.m.pStock * 100)}</td><td>${r.v.length ? `<span class="chip red">${r.v.length} broken</span>` : '<span class="chip green">OK</span>'}</td></tr>`).join('')}</table>
      <div style="padding:10px 14px;font-size:12px" class="muted">👻 <b>Ghost campaign replay:</b> last year's Diwali footwear ran 25% off to everyone and stocked out on day 6. Replaying it through today's model would have flagged <b>71% stockout risk</b>. This is an estimated counterfactual.</div>
    </div></div>
    <div class="card"><div class="card-h">Red-team & crisis injection <span style="flex:1"></span><span class="chip ${resil >= 80 ? 'green' : resil >= 50 ? 'amber' : 'red'}">Resilience ${resil}/100</span></div><div class="card-b">
      <div class="stress" style="margin-bottom:10px">
        ${[['demand', 'Demand +30%'], ['supplier', 'Supplier delay 5 days'], ['competitor', 'Competitor promo']].map(([k, n]) => `<button class="btn sm ${st[k] ? 'primary' : ''}" onclick="S.sim.stress.${k}=!S.sim.stress.${k};renderSim()">${st[k] ? '✓ ' : ''}${n}</button>`).join('')}
        <button class="btn sm danger" onclick="injectCrisis()">⚡ Inject crisis: supplier delayed</button>
      </div>
      <table class="t"><tr><th>Scenario</th><th>Stockout</th><th>Margin</th><th></th></tr>
      ${scenR.map(s => `<tr><td>${s.n}</td><td>${pct(s.m.pStock * 100)}</td><td>${pct(s.m.marginPct, 1)}</td><td>${s.ok ? '<span class="chip green">pass</span>' : '<span class="chip red">fail</span>'}</td></tr>`).join('')}</table>
    </div></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-h">🤝 Agent Decision Room <span class="muted">· each agent reports from model outputs; the orchestrator returns one feasible proposal</span></div><div class="card-b">
    ${S.sim.crisis ? `<div class="banner red" style="margin-bottom:10px">⚡ <div><b>Crisis injected:</b> ${S.sim.crisis}. Agents renegotiated and the proposal below was recomputed.</div></div>` : ''}
    <div class="grid g4">${agents.map(a => `<div class="mbox"><div class="l">${a.n}</div><div style="font-size:12.5px;margin-top:4px">${a.t}</div><div style="margin-top:6px"><span class="chip ${a.s}">${a.v}</span></div></div>`).join('')}</div>
    <div class="banner ai" style="margin-top:12px">🎯 <div style="flex:1"><b>Orchestrator:</b> ${agents.orch}</div><button class="btn sm ai" onclick="S.sel='${it.id}';ask('Make ${esc(it.name)} margin-safe')">Send to canvas as change set</button></div>
  </div></div>`;
}
function agentViews(it, m) {
  const G = S.guard, donor = donorFor(S.plan, it.region, it.cat);
  const a = [
    { n: 'Customer agent', t: `${AUD[it.aud].n}: ${Math.round(AUD[it.aud].share * 100)}% of buyers discounted. Discount waste ${L(m.waste)}.`, v: it.aud === 'all' ? 'wants targeting' : 'OK', s: it.aud === 'all' ? 'amber' : 'green' },
    { n: 'Demand agent', t: `Forecast ${Math.round(m.D)} units (80% band ${Math.round(m.D * (1 - 1.28 * sigma()))}–${Math.round(m.D * (1 + 1.28 * sigma()))}).`, v: 'forecast ready', s: 'blue' },
    { n: 'Inventory agent', t: `${Math.round(m.stk)} units, ${m.dos.toFixed(1)} days of supply. ${donor ? `${REGIONS[donor.r].city} can spare ${donor.surplus}.` : 'No donor available.'}`, v: m.pStock * 100 > G.stockoutMax ? 'objects: stockout' : 'OK', s: m.pStock * 100 > G.stockoutMax ? 'red' : 'green' },
    { n: 'Finance agent', t: `Margin ${pct(m.marginPct, 1)} vs floor ${G.marginFloor}%. Inc. profit ${L(m.incProfit)}.`, v: m.marginPct < G.marginFloor ? 'objects: margin' : 'OK', s: m.marginPct < G.marginFloor ? 'red' : 'green' },
    { n: 'Operations agent', t: `${Math.round(m.sold / it.len)} units/day pick load. Store staffing OK. Signage lead time 3 days.`, v: 'OK', s: 'green' },
    { n: 'Market agent', t: `${EVENTS.filter(e => e.d >= it.start && e.d < it.start + it.len).map(e => e.n).join(', ') || 'No festival'} in window. Competitor promo likely (0.6).`, v: 'watch', s: 'amber' },
    { n: 'Risk agent', t: `${violations(it, m).length} hard-rule breaks. Resilience depends on stock transfer.`, v: violations(it, m).length ? 'blocks review' : 'OK', s: violations(it, m).length ? 'red' : 'green' }
  ];
  const fix = buildFix(it);
  a.orch = fix && fix.changes.length ? fix.changes.map(c => c.label.replace(/<[^>]+>/g, '')).join(' · ') : 'Current plan is feasible. No changes.';
  return a;
}
function injectCrisis() {
  S.sim.stress.supplier = true;
  S.sim.crisis = 'Supplier for ' + CATS[item(S.sim.id).cat].n + ' delayed 5 days (−30% inbound stock)';
  audit('System', 'Crisis injected', S.sim.crisis);
  toast('⚡ Crisis injected. Agents are recomputing…');
  renderSim();
}

/* =====================================================================
   READINESS, APPROVAL & CREATIVE
   ===================================================================== */
const READY_ITEMS = [['stock', 'Stock in place', 'Supply Chain'], ['price', 'Price loaded in POS', 'Merchandising'], ['creative', 'Creative approved', 'Marketing'], ['channels', 'Channels scheduled', 'Marketing'], ['supplier', 'Supplier confirmed', 'Supply Chain'], ['stores', 'Stores briefed (signage, shelf price)', 'Store Ops'], ['consent', 'Consent & compliance check', 'Legal']];
function readiness(id) {
  if (!S.readiness[id]) S.readiness[id] = { price: true, channels: id !== 'c3', supplier: true, stores: false, consent: true, creative: false };
  const it = item(id), m = sim(it, S.plan), r = S.readiness[id];
  r.stock = m.pStock * 100 <= S.guard.stockoutMax;
  return r;
}
function renderApprovals() {
  const list = S.plan.items.filter(i => i.status !== 'Draft');
  if (!list.find(i => i.id === S.apprSel)) S.apprSel = list[0] && list[0].id;
  const it = item(S.apprSel);
  if (!it) { $('#content').innerHTML = '<div class="empty">No campaigns beyond Draft yet.</div>'; return; }
  const r = readiness(it.id), score = Math.round(READY_ITEMS.filter(([k]) => r[k]).length / READY_ITEMS.length * 100);
  const chain = PROFILES[S.profile].chain, stepIdx = S.approvals[it.id] ?? 0;
  const m = sim(it, S.plan), v = violations(it, m);
  const myStep = role().step, canApprove = it.status === 'In review' && stepIdx < chain.length && chain[stepIdx] === myStep;
  const cp = S.unsafeCopy ? { head: `LOWEST PRICE EVER! ${CATS[it.cat].n} ${it.disc + 30}% off. Guaranteed best deal`, push: `Last chance!!! Only today, hurry, stock running out forever`, wa: `Miracle offer, guaranteed results. Buy now before it's gone`, banner: `Was ₹9,999 now ₹${Math.round(CATS[it.cat].price * (1 - it.disc / 100))}` } : copyFor(it, S.creativeTone);
  const forbidden = /(lowest price ever|guaranteed|last chance|miracle|forever|only today|hurry|was ₹9,999)/gi;
  const flag = s => esc(s).replace(forbidden, x => `<mark class="bad">${x}</mark>`);
  const bad = Object.values(cp).some(s => new RegExp(forbidden.source, 'i').test(s));
  $('#content').innerHTML = `
  <div class="grid" style="grid-template-columns:260px 1fr 1fr">
    <div class="card"><div class="card-h">Campaigns</div><div class="list-sel">
      ${list.map(i => { const rr = readiness(i.id), sc = Math.round(READY_ITEMS.filter(([k]) => rr[k]).length / READY_ITEMS.length * 100); return `<button class="${i.id === it.id ? 'on' : ''}" onclick="S.apprSel='${i.id}';renderApprovals()"><div style="flex:1"><b>${esc(i.name)}</b><div class="muted" style="font-size:11px">${REGIONS[i.region].city} · <span class="chip ${STATUS_CLS[i.status]}">${i.status}</span></div></div><span class="chip ${sc >= 85 ? 'green' : sc >= 60 ? 'amber' : 'red'}">${sc}</span></button>`; }).join('')}
    </div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><div class="card-h">Readiness scorecard <span style="flex:1"></span><span class="chip ${score >= 85 ? 'green' : score >= 60 ? 'amber' : 'red'}">Go/No-go ${score}%</span></div><div class="card-b">
        <div class="bar" style="margin-bottom:10px"><i style="width:${score}%;background:${score >= 85 ? 'var(--green)' : score >= 60 ? 'var(--amber)' : 'var(--red)'}"></i></div>
        ${READY_ITEMS.map(([k, n, o]) => `<label class="check"><input type="checkbox" ${r[k] ? 'checked' : ''} ${k === 'stock' ? 'disabled' : ''} onchange="S.readiness['${it.id}'].${k}=this.checked;audit(role().n,'Readiness updated','${esc(it.name)}: ${n} → '+this.checked);renderApprovals()"><span style="flex:1">${n}${k === 'stock' ? ' <span class="faint">(auto from simulator)</span>' : ''}</span><span class="muted" style="font-size:11px">${o}</span></label>`).join('')}
        ${v.length ? `<div class="banner red" style="margin-top:10px">⛔ ${v.map(x => x.t).join('; ')}${S.overrides[it.id] ? `<br><b>Override on record:</b> “${esc(S.overrides[it.id])}”` : ''}</div>` : ''}
      </div></div>
      <div class="card"><div class="card-h">Approval chain · ${PROFILES[S.profile].n}</div><div class="card-b">
        <div class="chain">${chain.map((c, i) => `<div class="step ${i < stepIdx ? 'done' : i === stepIdx && it.status === 'In review' ? 'cur' : ''}">${i < stepIdx ? '✓' : i + 1} ${c}</div>${i < chain.length - 1 ? '<span class="arrow">→</span>' : ''}`).join('')}</div>
        <div style="margin-top:12px" class="row wrap">
          ${it.status === 'Approved' || it.status === 'Live' ? `<span class="chip green">✓ ${it.status}</span>${it.status === 'Approved' ? `<button class="btn sm primary" onclick="goLive('${it.id}')">Publish (schedule go-live)</button>` : ''}` : it.status !== 'In review' ? `<span class="muted">Send to review from the Planning Canvas to start approvals.</span>` :
            `<button class="btn green" ${canApprove ? '' : 'disabled'} onclick="approve('${it.id}')">✓ Approve as ${esc(chain[stepIdx])}</button><button class="btn danger" ${canApprove ? '' : 'disabled'} onclick="rejectAppr('${it.id}')">Send back</button>
             ${!canApprove ? `<span class="muted" style="font-size:12px">Waiting for <b>${chain[stepIdx]}</b>. Switch role in the top bar to approve.</span>` : ''}`}
        </div>
        <div class="muted" style="font-size:11.5px;margin-top:10px">🔐 Separation of duties: no one person can create, approve and publish. The AI copilot cannot approve.</div>
      </div></div>
    </div>
    <div class="card" style="align-self:start"><div class="card-h">✍ Creative <span class="muted">· text only</span><span style="flex:1"></span>${bad ? '<span class="chip red">⛔ guardrail breaks</span>' : '<span class="chip green">✓ guardrails pass</span>'}</div><div class="card-b">
      <div class="seg" style="margin-bottom:10px">${[['standard', 'Standard'], ['premium', 'More premium'], ['hindi', 'हिन्दी'], ['telugu', 'తెలుగు']].map(([k, n]) => `<button class="${S.creativeTone === k && !S.unsafeCopy ? 'on' : ''}" onclick="S.creativeTone='${k}';S.unsafeCopy=false;renderApprovals()">${n}</button>`).join('')}</div>
      <div class="copybox"><div class="ch">Headline</div>${flag(cp.head)}</div>
      <div class="copybox"><div class="ch">Push notification</div>${flag(cp.push)}</div>
      <div class="copybox"><div class="ch">WhatsApp (approved template)</div>${flag(cp.wa)}</div>
      <div class="copybox"><div class="ch">Banner</div>${flag(cp.banner)}</div>
      ${bad ? `<div class="banner red">⛔ Blocked: unverifiable claims, fake urgency and an inflated reference price. Copy can't go live.</div>` : ''}
      <div class="row wrap" style="margin-top:10px">
        <button class="btn sm" onclick="S.unsafeCopy=!S.unsafeCopy;renderApprovals()">${S.unsafeCopy ? 'Restore safe copy' : 'Test: paste risky copy'}</button>
        <button class="btn sm green" ${bad ? 'disabled' : ''} onclick="readiness('${it.id}').creative=true;audit(role().n,'Creative approved','${esc(it.name)}');toast('Creative approved');renderApprovals()">✓ Approve creative</button>
      </div>
    </div></div>
  </div>`;
}
function approve(id) {
  const it = item(id), chain = PROFILES[S.profile].chain;
  const r = readiness(id), score = READY_ITEMS.filter(([k]) => r[k]).length / READY_ITEMS.length;
  const v = violations(it, sim(it, S.plan));
  if (v.length && !S.overrides[id]) { toast('⛔ Blocked: hard rules are violated and there is no override on record.'); return; }
  if (S.approvals[id] === chain.length - 1 && score < .7) { toast('⛔ Final approval needs a readiness score of at least 70%.'); return; }
  audit(role().n, 'Approved', `${it.name} · step ${chain[S.approvals[id] || 0]}`);
  S.approvals[id] = (S.approvals[id] || 0) + 1;
  if (S.approvals[id] >= chain.length) { it.status = 'Approved'; toast(`✓ ${esc(it.name)} fully approved`); }
  else toast(`Approved. Next: ${chain[S.approvals[id]]}`);
  renderApprovals();
}
function rejectAppr(id) { const reason = prompt('Reason for sending back:'); if (!reason) return; const it = item(id); it.status = 'Draft'; S.approvals[id] = 0; audit(role().n, 'Sent back', `${it.name}: ${reason}`); renderApprovals(); }
function goLive(id) { if (S.role === 'marketing') { toast('Separation of duties: the campaign creator cannot publish. Switch to Admin.'); return; } const it = item(id); it.status = 'Live'; audit(role().n, 'Published', it.name); toast('🚀 Scheduled go-live'); renderApprovals(); }

/* =====================================================================
   WAR ROOM & LEARNING
   ===================================================================== */
let warTimer = null;
function warSeries(r) {
  const W = S.war, out = [];
  for (let d = 0; d < 10; d++) {
    const pred = BASE[r].FW[0] * seasonMult(33 + d, 'FW') * 1.25;
    const rn = rng(r.charCodeAt(0) * 100 + d)();
    let obs = pred * (1 + (rn - .5) * .12);
    if (r === 'DL') obs = pred * (1 + Math.min(.37, d * .1));
    out.push({ pred, obs });
  }
  // stock allocated to the window = forecast + 8% buffer (MH holds the regional reserve)
  let stock = out.reduce((a, x) => a + x.pred, 0) * (r === 'MH' ? 1.6 : 1.08);
  if (W.transfer === 'done') { if (r === 'DL') stock += warT(); if (r === 'MH') stock -= warT(); }
  return { series: out, stock };
}
function warT() { let s = 0; for (let d = 0; d < 10; d++) s += BASE.DL.FW[0] * seasonMult(33 + d, 'FW') * 1.25; return Math.round(s * .3 / 10) * 10; }
function regionStatus(r, day) {
  const { series, stock } = warSeries(r);
  let used = 0; for (let d = 0; d < day; d++) used += series[d].obs;
  const cur = series[Math.max(0, day - 1)];
  const varPct = day ? (cur.obs / cur.pred - 1) * 100 : 0;
  const left = stock - used;
  const burn = cur.obs;
  const daysLeft = left / burn;
  const rem = 10 - day;
  const status = day && (daysLeft < rem * .9 || (varPct > 25 && daysLeft < rem * 1.15)) ? 'r' : day && (varPct > 15 || daysLeft < rem * 1.05) ? 'a' : 'g';
  return { varPct, left, daysLeft, status, cur };
}
function renderWar() {
  const W = S.war;
  const tabs = `<div class="seg" style="margin-bottom:14px"><button class="${W.tab === 'live' ? 'on' : ''}" onclick="S.war.tab='live';renderWar()">◉ Live monitor</button><button class="${W.tab === 'learn' ? 'on' : ''}" onclick="S.war.tab='learn';renderWar()">🧠 Reality check & learning</button></div>`;
  if (W.tab === 'learn') { $('#content').innerHTML = tabs + learningHtml(); return; }
  const regs = Object.keys(REGIONS);
  const st = regs.map(r => ({ r, ...regionStatus(r, W.day) }));
  const dl = st.find(x => x.r === 'DL');
  const alert = W.day >= 3 && dl.status === 'r' && W.transfer !== 'done';
  const sel = W.region;
  const { series } = warSeries(sel);
  const chart = lineChart(series, W.day);
  const before = regionStatus('DL', W.day);
  $('#content').innerHTML = tabs + `
  <div class="row wrap" style="margin-bottom:14px">
    <button class="btn ${W.running ? '' : 'primary'}" onclick="toggleWar()">${W.running ? '⏸ Pause' : W.day >= 10 ? '↺ Replay' : '▶ Run live feed'}</button>
    <button class="btn" onclick="stepWar()" ${W.day >= 10 ? 'disabled' : ''}>Step +1 day</button>
    <span class="chip blue">Diwali footwear window · day ${W.day}/10 · ${ds(33 + W.day)}</span>
    <span class="muted" style="font-size:12px">Scripted synthetic feed (simulated time-stepping)</span>
  </div>
  ${alert ? `<div class="banner red pulse" style="margin-bottom:14px">🚨 <div style="flex:1"><b>Early warning, Delhi NCR:</b> demand is <b>+${Math.round(dl.varPct)}%</b> vs forecast. At the current burn rate stock runs out in <b>${dl.daysLeft.toFixed(1)} days</b> (campaign has ${10 - W.day} days left).</div></div>` : ''}
  <div class="region-tiles">${st.map(x => `<div class="rtile ${x.status}" style="cursor:pointer;${x.r === sel ? 'outline:2px solid var(--primary)' : ''}" onclick="S.war.region='${x.r}';renderWar()">
    <div class="row between"><b>${REGIONS[x.r].city}</b><span class="dot ${x.status}"></span></div>
    <div style="font-size:20px;font-weight:700;margin:4px 0">${W.day ? (x.varPct >= 0 ? '+' : '') + Math.round(x.varPct) + '%' : '—'}</div>
    <div class="muted" style="font-size:11.5px">vs forecast · stock ${Math.max(0, Math.round(x.left))} units · ${W.day ? x.daysLeft.toFixed(1) + ' days cover' : ''}</div></div>`).join('')}</div>
  <div class="grid" style="grid-template-columns:3fr 2fr;margin-top:14px">
    <div class="card"><div class="card-h">Predicted vs observed · ${REGIONS[sel].city} footwear <span class="muted">· shaded = 80% forecast band</span></div><div class="card-b">${chart}</div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><div class="card-h">🛠 Intervention</div><div class="card-b">
        ${W.transfer === 'done' ? `<div class="banner green">✓ Transfer of ${warT().toLocaleString('en-IN')} units Pune → Delhi approved and dispatched. Delhi cover restored to ${before.daysLeft.toFixed(1)} days.</div>` :
          alert || W.transfer === 'sim' ? `<div class="banner ai" style="margin-bottom:10px">✦ <div><b>AI proposes:</b> transfer <b>${warT().toLocaleString('en-IN')} units</b> Pune → Delhi (Pune has ${Math.round(regionStatus('MH', W.day).left)} units, +${Math.round(regionStatus('MH', W.day).daysLeft)} days cover). Lead time 1 day.</div></div>
            ${W.transfer === 'sim' ? `<table class="t" style="margin-bottom:10px"><tr><th></th><th>Before</th><th>After</th></tr><tr><td>Delhi stockout risk</td><td style="color:var(--red)">78%</td><td style="color:var(--green)">9%</td></tr><tr><td>Pune stockout risk</td><td>3%</td><td>6%</td></tr><tr><td>Revenue protected</td><td>—</td><td>+${L(warT() * 2400 * .82)}</td></tr></table>` : ''}
            <div class="row"><button class="btn" onclick="S.war.transfer='sim';renderWar()">∿ Simulate before/after</button><button class="btn green" ${W.transfer === 'sim' && canEdit() ? '' : 'disabled'} onclick="approveTransfer()">✓ Approve transfer</button></div>
            ${!canEdit() ? '<div class="muted" style="font-size:11.5px;margin-top:6px">Your role cannot approve interventions.</div>' : ''}` :
          '<div class="muted">No interventions needed. Monitoring…</div>'}
      </div></div>
      <div class="card"><div class="card-h">⚡ Circuit breakers <span class="muted">· pre-approved by humans</span></div><div class="card-b" style="font-size:12.5px">
        <div class="check"><span style="flex:1">Pause offer if margin &lt; ${S.guard.marginFloor - 4}% for 2 days</span><span class="chip green">armed</span></div>
        <div class="check"><span style="flex:1">Throttle push if demand &gt; +25% vs forecast</span><span class="chip ${alert ? 'red' : 'green'}">${alert ? 'triggered · logged' : 'armed'}</span></div>
        <div class="check"><span style="flex:1">Auto-transfer ≤ 100 units between stores</span><span class="chip green">armed</span></div>
        <div class="check" style="border:0"><span style="flex:1">Anything larger → human approval</span><span class="chip blue">policy</span></div>
      </div></div>
    </div>
  </div>`;
}
function lineChart(series, day) {
  const w = 640, h = 220, pad = 34;
  const mx = Math.max(...series.map(s => Math.max(s.obs, s.pred * 1.3))) * 1.05;
  const x = i => pad + i * (w - pad - 10) / 9, y = v => h - pad + 10 - v / mx * (h - pad);
  const band = series.map((s, i) => `${x(i)},${y(s.pred * (1 + 1.28 * sigma() * .6))}`).join(' ') + ' ' + series.map((s, i) => `${x(i)},${y(s.pred * (1 - 1.28 * sigma() * .6))}`).reverse().join(' ');
  const pred = series.map((s, i) => `${x(i)},${y(s.pred)}`).join(' ');
  const obs = series.slice(0, day).map((s, i) => `${x(i)},${y(s.obs)}`).join(' ');
  const ticks = [0, .25, .5, .75, 1].map(f => `<line x1="${pad}" x2="${w - 10}" y1="${y(mx * f)}" y2="${y(mx * f)}" stroke="#eef0f5"/><text x="${pad - 6}" y="${y(mx * f) + 3}" font-size="10" fill="#98a2b3" text-anchor="end">${Math.round(mx * f)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%">${ticks}
    <polygon points="${band}" fill="rgba(31,59,115,.10)"/>
    <polyline points="${pred}" fill="none" stroke="#1f3b73" stroke-width="2" stroke-dasharray="5 4"/>
    ${day ? `<polyline points="${obs}" fill="none" stroke="#dc2626" stroke-width="2.5"/>${series.slice(0, day).map((s, i) => `<circle cx="${x(i)}" cy="${y(s.obs)}" r="3" fill="#dc2626"/>`).join('')}` : ''}
    ${series.map((s, i) => `<text x="${x(i)}" y="${h - 6}" font-size="10" fill="#98a2b3" text-anchor="middle">${ds(33 + i)}</text>`).join('')}
    <g font-size="11"><line x1="${w - 190}" x2="${w - 170}" y1="14" y2="14" stroke="#1f3b73" stroke-dasharray="5 4" stroke-width="2"/><text x="${w - 165}" y="18" fill="#667085">forecast</text><line x1="${w - 105}" x2="${w - 85}" y1="14" y2="14" stroke="#dc2626" stroke-width="2.5"/><text x="${w - 80}" y="18" fill="#667085">observed</text></g>
  </svg>`;
}
function toggleWar() {
  const W = S.war;
  if (W.running) { W.running = false; clearInterval(warTimer); renderWar(); return; }
  if (W.day >= 10) { W.day = 0; W.transfer = 'none'; }
  W.running = true;
  warTimer = setInterval(() => { if (S.screen !== 'war') { clearInterval(warTimer); W.running = false; return; } stepWar(true); }, 1100);
  renderWar();
}
function stepWar(auto) {
  const W = S.war; if (W.day >= 10) { W.running = false; clearInterval(warTimer); renderWar(); return; }
  W.day++;
  const dl = regionStatus('DL', W.day);
  if (W.day >= 3 && dl.status === 'r' && W.transfer === 'none' && !W.alerted) { W.alerted = true; W.region = 'DL'; audit('System', 'Early-warning alert', `Delhi footwear +${Math.round(dl.varPct)}% vs forecast`); audit('System', 'Circuit breaker triggered', 'Throttle push, Delhi footwear (demand > +25% vs forecast)'); if (auto) { W.running = false; clearInterval(warTimer); toast('🚨 Delhi turned red. Feed paused for your decision.'); } }
  renderWar();
}
function approveTransfer() { S.war.transfer = 'done'; audit(role().n, 'Approved intervention', `Transfer ${warT()} footwear units Pune → Delhi`); toast('✓ Transfer approved & dispatched'); renderWar(); }
function learningHtml() {
  const rows = [['Diwali Footwear Fest', 'Hyderabad', 21.4, 19.8, 14], ['Delhi Festive Kicks', 'Delhi', 14.2, 18.9, 11], ['Glow for Diwali', 'Pune', 6.1, 5.7, 9], ['Festive Ethnic Wear', 'Bengaluru', 17.5, 16.2, 12], ['Gadget Upgrade EMI', 'Delhi', 12.8, 13.4, 7]];
  const topics = [['Size availability', 38, true], ['Delivery delay', 21], ['Price / offer clarity', 14], ['Product quality', 11], ['Store experience', 9]];
  const locked = S.tier < 3;
  return `<div class="grid g2">
    <div class="card"><div class="card-h">Reality check: predicted vs actual <span class="muted">· treatment vs control (synthetic)</span></div><div class="card-b" style="padding:0">
      <table class="t"><tr><th>Campaign</th><th>Predicted inc. rev</th><th>Actual (vs control)</th><th>Error</th><th>Uplift</th></tr>
      ${rows.map(r => { const e = (r[3] - r[2]) / r[2] * 100; return `<tr><td><b>${r[0]}</b><div class="muted" style="font-size:11px">${r[1]}</div></td><td>₹${r[2]}L</td><td>₹${r[3]}L</td><td style="color:${Math.abs(e) > 15 ? 'var(--red)' : ''}">${e > 0 ? '+' : ''}${e.toFixed(0)}%</td><td>+${r[4]}%</td></tr>`; }).join('')}</table>
      <div style="padding:10px 14px" class="muted">Forecast MAPE 11.8% · 80% interval coverage 83% · model recalibrated with these actuals (v0.3 → v0.4)</div>
    </div></div>
    <div class="card ${locked ? 'lock' : ''}"><div class="card-h">💬 Feedback intelligence ${locked ? '<span class="chip">🔒 needs data tier 3</span>' : ''}</div><div class="card-b">
      ${topics.map(([t, v, spike]) => `<div style="margin-bottom:8px"><div class="row between" style="font-size:12.5px"><span>${t} ${spike ? '<span class="chip red">spike ×3 · Product C “Runner Pro”</span>' : ''}</span><span class="muted">${v}%</span></div><div class="bar"><i style="width:${v * 2}%;background:${spike ? 'var(--red)' : 'var(--primary)'}"></i></div></div>`).join('')}
      <div class="muted" style="font-size:11.5px">Sentiment −0.21 this week (from 4,812 reviews & complaints). Mostly negative on sizing.</div>
    </div></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-h">🔎 Root-cause <span class="muted">· ranked hypotheses, not facts</span></div><div class="card-b">
      ${[['Size curve mismatch: sizes 8–9 out of stock in 60% of Delhi stores', 0.62], ['Demand spike from competitor stock-out nearby', 0.21], ['Push notification sent twice (channel collision)', 0.11], ['Data lag in store inventory feed', 0.06]].map(([t, p], i) => `<div class="brief-item"><div class="ic" style="background:var(--surface-2)">${i + 1}</div><div style="flex:1">${t}<div class="bar" style="margin-top:4px"><i style="width:${p * 100}%"></i></div></div><span class="muted">${Math.round(p * 100)}%</span></div>`).join('')}
    </div></div>
    <div class="card"><div class="card-h">🔁 Learning loop</div><div class="card-b">
      <div class="banner ai" style="margin-bottom:10px">✦ <div><b>Suggested new guardrail:</b> for apparel & footwear, require <b>size coverage ≥ 80%</b> in each store before a campaign can go live.</div></div>
      ${S.learnGuardAdded ? '<div class="banner green">✓ Guardrail added and now enforced in the Readiness scorecard and optimizer.</div>' : `<button class="btn primary" ${canEdit() ? '' : 'disabled'} onclick="addLearnGuard()">＋ Add guardrail</button>`}
      <div class="sec-t">Memory</div>
      <div style="font-size:12.5px">📚 23 similar festive campaigns indexed. The planner now shows them as benchmarks.<br>📉 Elasticity for footwear updated 2.0 → 2.1 (± 0.4).<br>🧾 Every change is logged with model v0.4 and data snapshot 30 Sep.</div>
    </div></div>
  </div>`;
}
function addLearnGuard() { S.learnGuardAdded = true; S.guard.extra.push('Size coverage ≥ 80% per store (apparel & footwear)'); audit(role().n, 'Guardrail added', 'Size coverage ≥ 80% (from learning loop)'); toast('✓ New guardrail active'); renderWar(); }

/* =====================================================================
   GOVERNANCE & CONFIG
   ===================================================================== */
function renderGov() {
  const G = S.guard;
  const test = S.govTest;
  $('#content').innerHTML = `
  <div class="card"><div class="card-h">🏬 Retailer profile <span class="muted">· configurable across retail formats</span></div><div class="card-b">
    <div class="grid g3">${Object.entries(PROFILES).map(([k, p]) => `<div class="mbox" style="cursor:pointer;${k === S.profile ? 'border-color:var(--primary);background:var(--primary-2)' : ''}" onclick="setProfile('${k}')"><div class="row between"><b>${p.n}</b>${k === S.profile ? '<span class="chip blue">active</span>' : ''}</div><div class="s" style="margin-top:4px">Constraint: ${p.constraint}<br>Levers: ${p.levers}<br>KPI: ${p.kpi}</div></div>`).join('')}</div>
    <div class="row wrap" style="margin-top:12px">
      <span class="lbl muted" style="font-size:12px;font-weight:600">Data tier</span>
      <div class="seg">${[1, 2, 3].map(t => `<button class="${S.tier === t ? 'on' : ''}" onclick="setTier(${t})">Tier ${t}</button>`).join('')}</div>
      <span class="muted" style="font-size:12px">${S.tier === 1 ? 'Transactions + inventory. 🔒 Segments & feedback locked (add customer IDs to unlock).' : S.tier === 2 ? '+ customer IDs: segments & uplift unlocked. 🔒 Feedback intelligence needs clickstream/feedback.' : '+ clickstream & feedback: all features unlocked.'}</span>
    </div>
  </div></div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-h">🛡 Guardrails <span class="muted">· hard rules enforced on every human & AI edit</span></div><div class="card-b">
      <div class="f2">
        <div class="field"><label>Margin floor (%)</label><input type="number" value="${G.marginFloor}" ${canEdit() ? '' : 'disabled'} onchange="setGuard('marginFloor',+this.value)"></div>
        <div class="field"><label>Plan spend cap (₹)</label><input type="number" step="50000" value="${G.budgetCap}" ${canEdit() ? '' : 'disabled'} onchange="setGuard('budgetCap',+this.value)"></div>
        <div class="field"><label>Max stockout risk (%)</label><input type="number" value="${G.stockoutMax}" ${canEdit() ? '' : 'disabled'} onchange="setGuard('stockoutMax',+this.value)"></div>
        <div class="field"><label>Contact cap (campaigns/day/region)</label><input type="number" value="${G.contactCap}" ${canEdit() ? '' : 'disabled'} onchange="setGuard('contactCap',+this.value)"></div>
      </div>
      <div class="sec-t">Discount caps by category</div>
      <div class="grid g3" style="gap:8px">${Object.entries(CATS).map(([k, c]) => `<div class="field" style="margin:0"><label>${c.n}</label><input type="number" value="${G.discountCap[k]}" ${canEdit() ? '' : 'disabled'} onchange="S.guard.discountCap['${k}']=+this.value;audit(role().n,'Guardrail changed','${c.n} cap → '+this.value+'%');renderGov()"></div>`).join('')}</div>
      <div class="sec-t">Brand & compliance rules</div>
      <div style="font-size:12.5px;line-height:1.8">• No fake urgency or unverifiable claims (“guaranteed”, “lowest ever”)<br>• Honest reference price (30-day lowest)<br>• Regulated messaging templates for WhatsApp/SMS<br>• Personalization only via offers, never individual shelf prices<br>• Sensitive attributes & proxies excluded from targeting<br>${G.extra.map(e => `• <b>${esc(e)}</b> <span class="chip ai">learned</span>`).join('<br>')}</div>
    </div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><div class="card-h">🧪 Try to break a rule</div><div class="card-b">
        <div class="row"><select id="gtCat" class="pill-select">${Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.n}</option>`).join('')}</select><input id="gtDisc" type="number" value="40" style="width:80px;border:1px solid var(--border-2);border-radius:7px;padding:6px"> % off to everyone in Hyderabad
          <button class="btn primary" onclick="runGovTest()">Test</button></div>
        ${test ? test : '<div class="muted" style="font-size:12px;margin-top:8px">E.g. a manager tries 40% off footwear.</div>'}
      </div></div>
      <div class="card"><div class="card-h">👥 Roles & access (RBAC + ABAC)</div><div class="card-b" style="padding:0">
        <table class="t"><tr><th>Role</th><th>Edit plan</th><th>Approve</th><th>Customer data</th><th>Scope</th></tr>
        ${Object.entries(ROLES).map(([k, r]) => `<tr style="${k === S.role ? 'background:var(--primary-2)' : ''}"><td><b>${r.n}</b></td><td>${r.edit ? '✓' : '—'}</td><td>${r.step || '—'}</td><td>${r.noCustomer ? 'hidden' : 'pseudonymized'}</td><td>${r.region ? REGIONS[r.region].city + ' only' : 'all regions'}</td></tr>`).join('')}</table>
      </div></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-h">🧾 Audit trail <span class="muted">· who asked, what AI proposed, what the human changed, who approved · model v0.3</span></div><div class="card-b" style="padding:0;max-height:320px;overflow:auto">
    <table class="t"><tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr>
    ${S.audit.map(a => `<tr><td class="muted">${a.t}</td><td><b>${esc(a.who)}</b> ${a.src === 'ai' ? '<span class="chip ai">AI</span>' : ''}</td><td>${esc(a.action)}</td><td class="muted">${esc(a.detail)}</td></tr>`).join('')}</table>
  </div></div>`;
}
function setGuard(k, v) { if (!canEdit()) return; S.guard[k] = v; audit(role().n, 'Guardrail changed', `${k} → ${v}`); toast('Guardrail updated. Plan re-validated.'); renderGov(); }
function setTier(t) { S.tier = t; audit(role().n, 'Data tier changed', 'Tier ' + t); toast(`Data tier ${t}: ${t === 1 ? 'segments & feedback locked' : t === 2 ? 'segments unlocked' : 'all features unlocked'}`); renderGov(); }
function setProfile(k) {
  S.profile = k; const p = PROFILES[k];
  audit(role().n, 'Profile switched', p.n);
  toast(`Adapted to <b>${p.n}</b>: ${p.constraint.toLowerCase()} · levers: ${p.levers.toLowerCase()} · approval chain ${p.chain.length} steps`);
  render();
}
function runGovTest() {
  const cat = $('#gtCat').value, d = +$('#gtDisc').value;
  const it = { id: 'test', name: 'Test', region: 'TS', cat, start: 33, len: 10, disc: d, aud: 'all', budget: 40000, status: 'Draft', mech: '% off', excl: false };
  const m = sim(it, S.plan), v = violations(it, m);
  const best = optimize(it, S.plan);
  S.govTest = v.length
    ? `<div class="banner red" style="margin-top:10px">🛑 <div><b>Blocked.</b><br>${v.map(x => '• ' + x.t).join('<br>')}${best ? `<br><br><b>Feasible alternative:</b> ${best.it.disc}% off for “${AUD[best.it.aud].n}”${best.it.excl ? ', excluding low-stock SKUs' : ''}. Margin ${pct(best.m.marginPct, 1)}, stockout ${pct(best.m.pStock * 100)}, inc. profit ${L(best.m.incProfit)}.` : ''}</div></div>`
    : `<div class="banner green" style="margin-top:10px">✓ Allowed. Margin ${pct(m.marginPct, 1)}, stockout ${pct(m.pStock * 100)}.</div>`;
  audit(role().n, 'Guardrail test', `${d}% off ${CATS[cat].n}: ${v.length ? 'blocked' : 'allowed'}`);
  renderGov();
}

/* =====================================================================
   CHANGE EXPLAINER — every plan change says what moved and why
   ===================================================================== */
const lastUndo = () => S.undo[S.undo.length - 1];
const eventsIn = it => EVENTS.filter(e => e.d >= it.start && e.d < it.start + it.len).map(e => e.n);
function impArrow(l, x, y, f, mode) {
  if (Math.abs(y - x) < 1e-6 * (Math.abs(x) + 1)) return '';
  const cls = mode === 'neu' ? '' : (mode === 'low' ? y < x : y > x) ? 'good' : 'bad';
  return `<span class="imp ${cls}">${l} ${f(x)} → <b>${f(y)}</b></span>`;
}
function explainChange(before, ids, cause, src = 'human') {
  const after = S.plan, blocks = [];
  for (const id of [...new Set(ids)].filter(Boolean)) {
    const b = before.items.find(i => i.id === id), a = after.items.find(i => i.id === id);
    if (!a && b) { blocks.push(`<div class="why-item"><b>${esc(b.name)}</b> removed. This frees ${L(b.budget)} of budget and removes its overlap with other campaigns in ${REGIONS[b.region].city}.</div>`); continue; }
    if (!a) continue;
    const ma = sim(a, after), va = violations(a, ma);
    if (!b) {
      blocks.push(`<div class="why-item"><b>${esc(a.name)}</b> added: ${a.disc}% · ${esc(a.mech)} for ${AUD[a.aud].n} in ${REGIONS[a.region].city}, ${range(a)}.
        <ul><li>Forecast ${Math.round(ma.D).toLocaleString('en-IN')} units against ${Math.round(ma.stk).toLocaleString('en-IN')} in stock (${ma.dos.toFixed(1)} days of cover).</li><li>${eventsIn(a).length ? `Covers ${eventsIn(a).join(', ')}.` : 'No festival in window: relies on the offer itself.'}</li></ul>
        <div class="why-effects"><span class="imp">Stockout <b>${pct(ma.pStock * 100)}</b></span><span class="imp ${ma.marginPct >= S.guard.marginFloor ? 'good' : 'bad'}">Margin <b>${pct(ma.marginPct, 1)}</b></span><span class="imp">Inc. revenue <b>${L(ma.incRev)}</b></span>${va.length ? `<span class="chip red">⛔ ${va.length} rule broken</span>` : '<span class="chip green">✓ passes hard rules</span>'}</div></div>`);
      continue;
    }
    const mb = sim(b, before), vb = violations(b, mb), why = [];
    if (a.start !== b.start || a.len !== b.len) {
      const eb = eventsIn(b), ea = eventsIn(a), gained = ea.filter(e => !eb.includes(e)), lost = eb.filter(e => !ea.includes(e));
      const dB = Math.round((ma.B / mb.B - 1) * 100);
      why.push(`Dates moved ${range(b)} → ${range(a)}. ${gained.length ? `It now covers <b>${gained.join(', ')}</b>. ` : ''}${lost.length ? `It no longer covers ${lost.join(', ')}. ` : ''}Baseline demand ${dB >= 0 ? '+' : ''}${dB}% because the window sits ${dB >= 0 ? 'closer to' : 'further from'} the festive peak.`);
    }
    if (a.disc !== b.disc) why.push(`Discount ${b.disc}% → ${a.disc}%. With price elasticity ${CATS[a.cat].elast}, promoted volume ${a.disc > b.disc ? 'rises' : 'falls'} by ~${Math.abs(Math.round(ma.I - mb.I)).toLocaleString('en-IN')} units. Discount given to shoppers who'd buy anyway goes ${L(mb.waste)} → ${L(ma.waste)}.`);
    if (a.aud !== b.aud) why.push(`Audience ${AUD[b.aud].n} → <b>${AUD[a.aud].n}</b>. This group responds at ${Math.round(AUD[a.aud].reach * 100)}% strength, and ${Math.round(AUD[a.aud].share * 100)}% of buyers receive the discount (was ${Math.round(AUD[b.aud].share * 100)}%). That is why margin moves.`);
    if (a.budget !== b.budget) why.push(`Budget ${L(b.budget)} → ${L(a.budget)}. ${ma.eff >= 1.2 && mb.eff >= 1.2 ? 'Reach was already saturated, so volume is unchanged and the saving flows to margin.' : `Reach efficiency ${mb.eff.toFixed(2)} → ${ma.eff.toFixed(2)}.`}`);
    if (a.excl !== b.excl) why.push(a.excl ? 'Low-stock sizes excluded: about 10% less demand chasing thin stock, so fewer disappointed shoppers.' : 'All SKUs back in scope.');
    if (a.region !== b.region || a.cat !== b.cat) why.push(`Scope moved to ${REGIONS[a.region].city} · ${CATS[a.cat].n}, which holds ${Math.round(ma.stk).toLocaleString('en-IN')} units (${ma.dos.toFixed(1)} days of cover).`);
    else if (Math.round(ma.stk) !== Math.round(mb.stk)) why.push(`Stock ${Math.round(mb.stk).toLocaleString('en-IN')} → <b>${Math.round(ma.stk).toLocaleString('en-IN')}</b> units after the transfer. Days of cover ${mb.dos.toFixed(1)} → ${ma.dos.toFixed(1)}, which is what cuts the stockout risk.`);
    if (a.mech !== b.mech) why.push(`Offer mechanic ${esc(b.mech)} → ${esc(a.mech)}. ${MECH_WHY[a.mech] || ''}`);
    if (a.status !== b.status) why.push(`Status ${b.status} → ${a.status}.`);
    if (a.name !== b.name && !why.length) why.push(`Renamed from “${esc(b.name)}”.`);
    const eff = [impArrow('Demand', mb.D, ma.D, v => Math.round(v).toLocaleString('en-IN'), 'neu'), impArrow('Stockout', mb.pStock * 100, ma.pStock * 100, v => pct(v), 'low'),
      impArrow('Margin', mb.marginPct, ma.marginPct, v => pct(v, 1), 'high'), impArrow('Inc. revenue', mb.incRev, ma.incRev, L, 'high')].join('');
    const rules = !va.length && vb.length ? '<span class="chip green">✓ Now passes all hard rules</span>' : va.length && !vb.length ? `<span class="chip red">⛔ Now breaks: ${va.map(v => v.t).join('; ')}</span>` : va.length ? `<span class="chip red">⛔ ${va.length} rule${va.length > 1 ? 's' : ''} still broken</span>` : '<span class="chip green">✓ Hard rules still pass</span>';
    blocks.push(`<div class="why-item"><b>${esc(a.name)}</b><ul>${why.map(w => `<li>${w}</li>`).join('')}</ul><div class="why-effects">${eff}${rules}</div></div>`);
  }
  const tb = planTotals(before), ta = planTotals(after);
  const plan = [impArrow('Plan spend', tb.spend, ta.spend, L, 'low'), impArrow('Plan margin', tb.margin, ta.margin, v => pct(v, 1), 'high'), impArrow('Rule breaks', tb.nViol + tb.conf.length, ta.nViol + ta.conf.length, v => v, 'low')].join('');
  if (plan) blocks.push(`<div class="why-plan"><span class="muted">Whole plan:</span> ${plan}</div>`);
  S.lastChange = { cause: cause.replace(/<[^>]+>/g, ''), src, t: nowStr(), html: blocks.join('') };
}
function whyCardHtml() {
  const c = S.lastChange; if (!c) return '';
  return `<div class="card why-card" id="whyCard"><div class="card-h">💡 What changed & why <span class="muted">· ${c.t} · ${esc(c.cause)}</span>${c.src === 'ai' ? '<span class="chip ai">AI suggestion · accepted by you</span>' : ''}<span style="flex:1"></span><button class="btn sm" onclick="S.lastChange=null;renderPlanning()" title="Dismiss">✕</button></div><div class="card-b">${c.html}</div></div>`;
}

/* =====================================================================
   OPERATIONAL RISKS
   ===================================================================== */
function opsRisks(it, m, plan = S.plan) {
  const r = [], G = S.guard, stores = REGIONS[it.region].stores.length;
  if (m.pStock > .1) r.push({ l: m.pStock * 100 > G.stockoutMax ? 'high' : 'med', t: `Stockout risk ${pct(m.pStock * 100)}: at high-end demand the region runs ~${Math.max(0, Math.round(m.D * (1 + 1.28 * sigma()) - m.stk)).toLocaleString('en-IN')} units short` });
  const perStore = m.sold / it.len / stores;
  if (perStore > 45) r.push({ l: 'med', t: `Store pick load ~${Math.round(perStore)} units/store/day. Plan extra staff for weekends.` });
  const lead = it.start - TODAY;
  if (lead < 5 && !['Live', 'Approved'].includes(it.status)) r.push({ l: lead < 2 ? 'high' : 'med', t: `Only ${Math.max(lead, 0)} days to launch. Price loading and signage need 3 days.` });
  const b = BASE[it.region][it.cat];
  if (b[2] > 0) r.push({ l: 'med', t: `Depends on ${b[2].toLocaleString('en-IN')} inbound units still in transit (supplier ETA risk)` });
  const ov = plan.items.filter(x => x.id !== it.id && x.region === it.region && overlap(x, it)).length;
  if (ov >= G.contactCap) r.push({ l: 'med', t: `${ov} other campaigns reach ${REGIONS[it.region].city} shoppers at the same time (contact fatigue)` });
  if (m.marginPct >= G.marginFloor && m.marginPct < G.marginFloor + 3) r.push({ l: 'med', t: `Thin margin buffer: ${pct(m.marginPct, 1)} vs the ${G.marginFloor}% floor` });
  if (m.dos > 60) r.push({ l: 'low', t: `Aging stock: ${Math.round(m.dos)} days of cover, so a follow-up markdown may still be needed` });
  if (eventsIn(it).some(e => e === 'Diwali' || e === 'Dhanteras')) r.push({ l: 'low', t: 'Festive peak in window: courier capacity is tight, so book delivery slots early' });
  if (!r.length) r.push({ l: 'low', t: 'No material operational risks detected' });
  return r;
}
const risksHtml = list => `<div class="risks">${list.map(x => `<div class="risk"><span class="dot ${x.l === 'high' ? 'r' : x.l === 'med' ? 'a' : 'g'}"></span><span>${x.t}</span></div>`).join('')}</div>`;

/* =====================================================================
   PROMOTIONS — recommendations, suitability map, builder, active list
   ===================================================================== */
const MECH_WHY = {
  '% off': 'A simple price cut is easy to understand and converts well when the segment is price-sensitive.',
  'Bundle': 'Bundles lift basket size and protect the headline price.',
  'BOGO / multi-buy': 'Multi-buy suits frequently bought staples: it drives volume without cutting the shelf price.',
  'Free delivery': 'Free delivery removes the main online checkout barrier at low cost.',
  'Points boost': 'Points reward returning shoppers and cost less than cash discounts.',
  'EMI / exchange': 'EMI and exchange make big-ticket items affordable without deep discounting.',
  'Early access': 'Early access rewards loyalty with exclusivity rather than price.'
};
const MECH_FOR = (cat, aud) => cat === 'EL' ? 'EMI / exchange' : cat === 'GR' ? 'BOGO / multi-buy' : aud === 'lapsed' ? 'Points boost' : aud === 'loyal' ? 'Bundle' : '% off';
const AUD_SHORT = { all: 'Open', uplift: 'Targeted', loyal: 'Loyalty', lapsed: 'Win-back' };
const WINDOWS = { dus: { n: 'Dussehra week', start: 17, len: 7 }, pre: { n: 'Pre-Diwali', start: 31, len: 10 }, post: { n: 'Post-Diwali clearance', start: 44, len: 10 } };
const GOALS = { profit: 'Maximise profit', clear: 'Clear excess stock', revenue: 'Grow revenue', reactivate: 'Win back customers' };
function goalScore(goal, it, m) {
  if (goal === 'clear') return m.incProfit < 0 ? m.incProfit - 1e9 : m.sold / m.stk * 1e6;
  if (goal === 'revenue') return m.incRev;
  if (goal === 'reactivate') return m.incProfit + (it.aud === 'lapsed' ? 4e5 : 0);
  return m.incProfit;
}
function recFor(region, cat, aud, o = {}) {
  if (AUD[aud].tier > S.tier) return null;
  const start = o.start ?? 31, len = o.len ?? 10, goal = o.goal || 'profit';
  const budget = o.budget ?? Math.max(20000, Math.round(BASE[region][cat][0] * len * CATS[cat].price * .025 / 10000) * 10000);   // spend at the reach saturation point
  let best = null;
  for (let d = 5; d <= S.guard.discountCap[cat]; d++) {
    const it = { id: 'rec', name: '', region, cat, aud, disc: d, start, len, budget, status: 'Draft', mech: MECH_FOR(cat, aud), excl: false };
    const m = sim(it, S.plan);
    if (violations(it, m).length) continue;
    const score = goalScore(goal, it, m);
    if (!best || score > best.score) best = { it, m, score };
  }
  return best;
}
function recWhy(r, o = {}) {
  const { it, m } = r, a = AUD[it.aud], ev = eventsIn(it);
  let idx = 0; for (let d = it.start; d < it.start + it.len; d++) idx += seasonMult(d, it.cat); idx /= it.len;
  const deeper = { ...it, disc: Math.min(it.disc + 5, 50) }, md = sim(deeper, S.plan), vd = violations(deeper, md);
  const blanket = it.aud !== 'all' ? recFor(it.region, it.cat, 'all', { start: it.start, len: it.len, budget: it.budget, goal: o.goal }) : null;
  const w = [
    `<b>Demand:</b> ${idx.toFixed(2)}× normal in this window${ev.length ? ` (${ev.join(', ')})` : ''}.`,
    `<b>Stock:</b> ${Math.round(m.stk).toLocaleString('en-IN')} units, ${m.dos.toFixed(0)} days of cover${m.dos > 40 ? ', so there is room to push volume' : m.dos < 14 ? ', which is tight, so keep the offer modest' : ''}.`,
    `<b>Customer group:</b> ${a.n} responds at ${Math.round(a.reach * 100)}% strength, and only ${Math.round(a.share * 100)}% of buyers get the discount, which limits waste.`,
    `<b>Offer depth:</b> ${it.disc}% is the best feasible level. At ${deeper.disc}% ${vd.length ? `it would break a rule (${vd[0].t.toLowerCase()})` : `incremental profit changes by ${L(md.incProfit - m.incProfit)}`}.`,
    `<b>Mechanic:</b> ${MECH_WHY[it.mech]}`
  ];
  if (blanket) w.push(`<b>vs. blanket offer:</b> ${m.incProfit >= blanket.m.incProfit ? `beats` : 'trails'} the best open-to-all offer by ${L(Math.abs(m.incProfit - blanket.m.incProfit))} incremental profit.`);
  return w;
}
const confidence = it => it.aud === 'lapsed' ? { l: 'Weak', c: 'red', a: 'Run as a 2-store experiment first' } : it.cat === 'GR' || it.cat === 'EL' ? { l: 'Strong', c: 'green', a: 'Proceed' } : { l: 'Moderate', c: 'amber', a: 'Pilot in 2 stores, then scale' };
function recommendations() {
  const P = S.promo, w = WINDOWS[P.win], out = [];
  let planned = 0, hold = 0;
  const regs = role().region ? [role().region] : P.region === 'all' ? Object.keys(REGIONS) : [P.region];
  for (const r of regs) for (const c of (P.cat === 'all' ? Object.keys(CATS) : [P.cat])) {
    const clash = S.plan.items.find(i => i.region === r && i.cat === c && i.start < w.start + w.len && w.start < i.start + i.len);
    if (clash) { planned++; continue; }
    let any = false;
    for (const a of (P.aud === 'any' ? Object.keys(AUD) : [P.aud])) { const rec = recFor(r, c, a, { ...w, goal: P.goal }); if (rec && rec.m.incProfit > 0) { out.push(rec); any = true; } }
    if (!any) hold++;
  }
  // keep the best audience per region × category so the list stays varied
  const seen = new Set();
  const list = out.sort((x, y) => y.score - x.score).filter(x => { const k = x.it.region + x.it.cat; if (seen.has(k)) return false; seen.add(k); return true; });
  return { list, planned, hold };
}
function recCardHtml(r, i, o = {}) {
  const { it, m } = r, cf = confidence(it);
  const title = `${it.disc}% ${it.mech === '% off' ? 'off' : '· ' + it.mech} ${CATS[it.cat].n} for ${AUD[it.aud].n.replace(' (38%)', '')}`;
  return `<div class="card rec-card">
    <div class="card-h">${i != null ? `<span class="rank">${i + 1}</span>` : ''}<div style="flex:1;min-width:0"><div>${esc(title)}</div><div class="muted" style="font-size:12px;font-weight:400">${REGIONS[it.region].city} · ${range(it)} · budget ${L(it.budget)}</div></div><span class="chip ${cf.c}">evidence: ${cf.l}</span></div>
    <div class="card-b">
      ${m.incProfit <= 0 ? `<div class="banner amber" style="margin-bottom:10px">⚖ <div><b>Recommendation: hold price.</b> Even the best rule-safe offer loses ${L(-m.incProfit)}. Most of the discount would go to shoppers who buy anyway. Details below.</div></div>` : ''}
      <div class="rec-impact">
        <div><span>Inc. profit</span><b class="${m.incProfit > 0 ? 'up' : 'down'}">${L(m.incProfit)}</b></div>
        <div><span>Inc. revenue</span><b>${L(m.incRev)}</b></div>
        <div><span>Margin</span><b>${pct(m.marginPct, 1)}</b></div>
        <div><span>Stockout</span><b class="${m.pStock > .1 ? 'down' : ''}">${pct(m.pStock * 100)}</b></div>
      </div>
      <div class="sec-t">Why this offer</div>
      <ul class="why-list">${recWhy(r, o).map(x => `<li>${x}</li>`).join('')}</ul>
      <div class="sec-t">Operational risks</div>
      ${risksHtml(opsRisks(it, m))}
      <div class="row wrap" style="margin-top:12px">
        <button class="btn sm primary" ${canEdit() ? '' : 'disabled'} onclick="addRec('${it.region}','${it.cat}','${it.aud}',${it.disc},${it.start},${it.len},${it.budget})">＋ Add to plan as draft</button>
        <span class="muted" style="font-size:11.5px">Recommendation: ${cf.a}</span>
      </div>
    </div></div>`;
}
function addRec(region, cat, aud, disc, start, len, budget) {
  if (!canEdit()) { toast('Read-only for ' + role().n); return; }
  pushUndo();
  const it = { id: nid('c'), name: `${AUD_SHORT[aud]} ${CATS[cat].n} · ${REGIONS[region].city}`, region, cat, start, len, disc, aud, budget, status: 'Draft', mech: MECH_FOR(cat, aud), excl: false };
  S.plan.items.push(it); S.sel = it.id;
  audit(role().n, 'Added recommended promotion', `${it.name} · ${disc}% · ${AUD[aud].n}`);
  explainChange(lastUndo(), [it.id], 'Added from Promotions', 'ai');
  toast(`＋ ${esc(it.name)} added to the plan as a draft. <a href="#" style="color:var(--gold)" onclick="go('planning');return false">View in plan →</a>`);
  render();
  return it;
}
function renderPromo() {
  const P = S.promo;
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
  const regs = Object.fromEntries([['all', 'All regions'], ...Object.entries(REGIONS).map(([k, r]) => [k, r.city])]);
  const cats = Object.fromEntries([['all', 'All categories'], ...Object.entries(CATS).map(([k, c]) => [k, c.n])]);
  const auds = Object.fromEntries([['any', 'All customer groups'], ...Object.entries(AUD).filter(([, a]) => a.tier <= S.tier).map(([k, a]) => [k, a.n])]);
  const tabs = [['recs', 'Recommended'], ['map', 'Suitability map'], ['builder', 'Campaign builder'], ['active', 'Active promotions']];
  const { list, planned, hold } = recommendations();
  const top = list.slice(0, 3).reduce((s, x) => s + x.m.incProfit, 0);
  let body = '';
  if (P.tab === 'recs') {
    body = list.length ? `<div class="rec-grid">${list.slice(0, 6).map((r, i) => recCardHtml(r, i, { goal: P.goal })).join('')}</div>`
      : `<div class="card"><div class="empty">No profitable, rule-safe promotions for this filter. Try another window or goal.</div></div>`;
  } else if (P.tab === 'map') body = suitabilityHtml();
  else if (P.tab === 'builder') body = builderHtml();
  else body = activeHtml();
  $('#content').innerHTML = `<div class="plan-page">
    <div class="card"><div class="card-b promo-summary">
      <div><div class="eyebrow-s">Promotion opportunities · ${WINDOWS[P.win].n}</div>
        <div class="promo-head">${list.length} rule-safe promotions found. The top 3 add <b>${L(top)}</b> incremental profit.</div>
        <div class="muted" style="font-size:12.5px">${planned} product × location combination${planned === 1 ? ' is' : 's are'} already covered by the plan. For <b>${hold}</b> more, the smart move is to <b>hold price</b>: any promotion would lose money. Each suggestion is simulated against stock, margin floor and discount caps.</div></div>
    </div>
    <div class="promo-filters">
      <div class="seg">${tabs.map(([k, n]) => `<button class="${P.tab === k ? 'on' : ''}" onclick="S.promo.tab='${k}';renderPromo()">${n}</button>`).join('')}</div>
      <div style="flex:1"></div>
      ${P.tab === 'builder' || P.tab === 'active' ? '' : `
      <select class="pill-select" onchange="S.promo.goal=this.value;renderPromo()">${opt(GOALS, P.goal)}</select>
      <select class="pill-select" onchange="S.promo.win=this.value;renderPromo()">${opt(Object.fromEntries(Object.entries(WINDOWS).map(([k, w]) => [k, w.n])), P.win)}</select>
      ${role().region ? '' : `<select class="pill-select" onchange="S.promo.region=this.value;renderPromo()">${opt(regs, P.region)}</select>`}
      ${P.tab === 'map' ? '' : `<select class="pill-select" onchange="S.promo.cat=this.value;renderPromo()">${opt(cats, P.cat)}</select>
      <select class="pill-select" onchange="S.promo.aud=this.value;renderPromo()">${opt(auds, P.aud)}</select>`}`}
    </div></div>
    ${body}
  </div>`;
}
function suitabilityHtml() {
  const P = S.promo, w = WINDOWS[P.win];
  const region = role().region || (P.region === 'all' ? 'TS' : P.region);
  const auds = Object.keys(AUD).filter(a => AUD[a].tier <= S.tier);
  const cells = {}; let mx = 1;
  for (const c in CATS) for (const a of auds) { const r = recFor(region, c, a, { ...w, goal: P.goal }); cells[c + a] = r; if (r) mx = Math.max(mx, r.m.incProfit); }
  const focus = P.focus && cells[P.focus];
  return `<div class="card"><div class="card-h">Which promotion suits which customer group? <span class="muted">· ${REGIONS[region].city} · ${w.n} · best rule-safe offer per cell</span></div>
    <div class="card-b" style="overflow-x:auto"><table class="suit"><tr><th></th>${auds.map(a => `<th>${AUD[a].n}</th>`).join('')}</tr>
    ${Object.keys(CATS).map(c => `<tr><th><span class="dot" style="background:${CATS[c].color}"></span> ${CATS[c].n}</th>${auds.map(a => { const r = cells[c + a]; if (!r) return `<td class="none">No safe offer</td>`; const v = clamp(r.m.incProfit / mx, 0, 1); if (r.m.incProfit <= 0) return `<td class="hold ${P.focus === c + a ? 'on' : ''}" onclick="S.promo.focus='${c + a}';renderPromo()"><b>Hold price</b><span>best offer would lose ${L(-r.m.incProfit)}</span></td>`; return `<td class="${P.focus === c + a ? 'on' : ''}" style="background:rgba(18,161,80,${.08 + v * .45})" onclick="S.promo.focus='${c + a}';renderPromo()"><b>${r.it.disc}% · ${esc(r.it.mech)}</b><span>${L(r.m.incProfit)} profit · SO ${pct(r.m.pStock * 100)}</span></td>`; }).join('')}</tr>`).join('')}
    </table><div class="muted" style="font-size:12px;margin-top:8px">Green = profitable promotion, and darker means more profit. Grey “Hold price” = no promotion is the better decision, because every offer loses money. Click a cell to see why.</div></div></div>
    ${focus ? recCardHtml(focus, null, { goal: P.goal }) : '<div class="card"><div class="empty">Select a cell to see its recommendation, explanation and operational risks.</div></div>'}`;
}
function builderBest() {
  const B = S.promo.b, start = (B.week - 1) * 7 + 1;
  return Object.keys(AUD).filter(a => AUD[a].tier <= S.tier).map(a => recFor(B.region, B.cat, a, { start, len: B.len, budget: B.budget, goal: B.goal })).filter(Boolean).sort((x, y) => y.score - x.score)[0];
}
function builderHtml() {
  const B = S.promo.b, opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
  const start = (B.week - 1) * 7 + 1, len = B.len;
  const auds = Object.keys(AUD).filter(a => AUD[a].tier <= S.tier);
  const opts = auds.map(a => recFor(B.region, B.cat, a, { start, len, budget: B.budget, goal: B.goal })).filter(Boolean).sort((x, y) => y.score - x.score);
  const best = opts[0];
  const weeks = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, `Week ${i + 1} · from ${ds(i * 7 + 1)}${EVENTS.filter(e => e.d >= i * 7 + 1 && e.d < i * 7 + 8).map(e => ' · ' + e.n).join('')}`]));
  const set = (k, num) => `onchange="S.promo.b.${k}=${num ? '+this.value' : 'this.value'};renderPromo()"`;
  return `<div class="grid" style="grid-template-columns:340px 1fr;align-items:start">
    <div class="card"><div class="card-h">Describe your campaign</div><div class="card-b">
      <div class="field"><label>Goal</label><select ${set('goal')}>${opt(GOALS, B.goal)}</select></div>
      <div class="field"><label>Location</label><select ${set('region')}>${opt(Object.fromEntries(Object.entries(REGIONS).map(([k, r]) => [k, r.n + ' · ' + r.city])), B.region)}</select></div>
      <div class="field"><label>Product category</label><select ${set('cat')}>${opt(Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.n])), B.cat)}</select></div>
      <div class="field"><label>When</label><select ${set('week', true)}>${opt(weeks, String(B.week))}</select></div>
      <div class="f2"><div class="field"><label>Duration (days)</label><input type="number" min="3" max="21" value="${B.len}" ${set('len', true)}></div>
      <div class="field"><label>Budget (₹)</label><input type="number" step="10000" value="${B.budget}" ${set('budget', true)}></div></div>
      <div class="muted" style="font-size:12px">The builder tests every customer group and discount level against your guardrails, then ranks them for your goal.</div>
    </div></div>
    <div class="grid" style="align-content:start">
      ${best ? `<div class="card"><div class="card-h">Options compared <span class="muted">· ranked for “${GOALS[B.goal]}”</span></div><div class="card-b" style="padding:0">
        <table class="t"><tr><th>Customer group</th><th>Offer</th><th>Inc. profit</th><th>Inc. revenue</th><th>Margin</th><th>Stockout</th><th>Stock cleared</th></tr>
        ${opts.map((r, i) => `<tr style="${i === 0 ? 'background:var(--green-bg);font-weight:600' : ''}"><td>${i === 0 ? '★ ' : ''}${AUD[r.it.aud].n}</td><td>${r.it.disc}% · ${esc(r.it.mech)}</td><td>${L(r.m.incProfit)}</td><td>${L(r.m.incRev)}</td><td>${pct(r.m.marginPct, 1)}</td><td>${pct(r.m.pStock * 100)}</td><td>${pct(r.m.sold / r.m.stk * 100)}</td></tr>`).join('')}</table></div></div>
      <div class="builder-result">${recCardHtml(best, null, { goal: B.goal }).replace('class="card rec-card"', 'class="card rec-card" id="builderRec"').replace('<div class="card-h">', '<div class="card-h"><span class="chip green">Recommended campaign</span>')}</div>`
      : `<div class="card"><div class="empty">⛔ No offer passes the guardrails for this scope. Try a different week, a smaller budget, or move stock in first.</div></div>`}
    </div></div>`;
}
function activeHtml() {
  const T = planTotals(S.plan);
  return `<div class="card"><div class="card-h">All promotions in the plan <span class="muted">· ${S.plan.items.length} campaigns</span></div><div class="card-b" style="padding:0;overflow-x:auto">
    <table class="t"><tr><th>Promotion</th><th>Customer group</th><th>Location</th><th>Dates</th><th>Offer</th><th>Status</th><th>Impact</th><th>Top risk</th><th></th></tr>
    ${visibleItems(S.plan.items).map(i => { const m = T.per[i.id], rk = opsRisks(i, m)[0]; return `<tr><td><b>${esc(i.name)}</b><div class="muted" style="font-size:11px">${CATS[i.cat].n}</div></td><td>${role().noCustomer ? 'hidden' : AUD[i.aud].n}</td><td>${REGIONS[i.region].city}</td><td>${range(i)}</td><td>${i.disc}% · ${esc(i.mech)}</td><td><span class="chip ${STATUS_CLS[i.status]}">${i.status}</span></td>
      <td><span class="chip ${m.viol.length ? 'red' : 'green'}">${m.viol.length ? '⛔ ' + m.viol.length + ' rule' : '✓ OK'}</span> <span class="muted" style="font-size:11.5px">${L(m.incRev)} · M ${pct(m.marginPct)}</span></td>
      <td style="font-size:11.5px;max-width:260px"><span class="dot ${rk.l === 'high' ? 'r' : rk.l === 'med' ? 'a' : 'g'}"></span> ${rk.t}</td>
      <td><button class="btn sm" onclick="S.sel='${i.id}';go('planning')">Open</button></td></tr>`; }).join('')}
    </table></div></div>`;
}

/* =====================================================================
   GUIDED DEMO — step-by-step walkthrough for presenting the product
   ===================================================================== */
const cardWith = txt => [...document.querySelectorAll('.card')].find(c => { const h = c.querySelector('.card-h'); return h && h.textContent.includes(txt); });
const TOUR = [
  { go: 'control', el: () => $('.home h2'), t: 'Welcome to AI BOS',
    p: 'AI BOS is an AI Business Operations System for retail promotions. This page is the executive landing: one headline, three numbers and what needs a decision today.',
    say: 'Don’t just predict the promotion. <b>Simulate the decision.</b>' },
  { go: 'control', el: () => $('.metrics'), t: 'The plan at a glance',
    p: 'Incremental revenue, margin and budget, each shown as a range and a status dot. Every figure comes from the simulator, never from the AI’s text.',
    say: 'Right now the plan is over budget. The dot shows it instantly.' },
  { go: 'control', el: () => $('.home-sec'), t: 'Decisions that need you',
    p: 'Each item links straight to the fix: the risky campaign, the budget overrun and the approvals waiting.' },
  { go: 'planning', do: () => toggleCopilot(false), el: () => $('#kpiCard'), t: 'Planning Canvas: plan health',
    p: 'Live KPIs for the whole plan: spend vs budget, margin vs floor, revenue range, worst stockout risk, contact pressure and rule breaks.' },
  { go: 'planning', do: () => { S.sel = 'c1'; renderPlanning(); }, el: () => $('#calCard'), t: 'The campaign calendar',
    p: 'Every campaign sits on a timeline by region, with Diwali and other events marked. Cards can be dragged and resized. A red border means a hard rule is broken.',
    say: '“Diwali Footwear Fest” is red: 81% stockout risk and margin below the 22% floor.' },
  { go: 'planning', el: () => $('#fab'), t: 'AI Copilot, one click away',
    p: 'The copilot lives behind this button, so the canvas stays uncluttered. It reads the same data as the canvas and can only write to a draft layer.' },
  { go: 'planning', do: () => ask('Critique my plan'), wait: 1200, el: () => $('#side'), t: 'Ask for a critique',
    p: 'The copilot calls the forecast, inventory, optimizer and constraint tools. It then explains what’s wrong in plain language, with the tool calls listed underneath.' },
  { go: 'planning', do: () => { const p = document.querySelector('#side .proposal'); if (p) p.scrollIntoView({ block: 'start' }); }, el: () => document.querySelector('#side .proposal'), t: 'A change set, not a black box',
    p: 'Each proposed change shows a before/after diff and can be accepted, edited or rejected on its own. The set is validated against guardrails before you see it.',
    say: 'Cut 25% → 16%, target the high-uplift segment, and move stock from Pune.' },
  { go: 'planning', do: () => { const ch = pendingChanges(); pushUndo(); const snap = lastUndo(); ch.forEach(c => { if (c.type === 'delete') { c.st = 'rejected'; audit(role().n, 'Rejected AI change', c.label); } else { applyChange(S.plan, c); c.st = 'accepted'; audit(role().n, 'Accepted AI change', c.label); } }); explainChange(snap, ch.filter(c => c.st === 'accepted').map(changeTarget), 'Accepted AI change set: Fix Diwali Footwear Fest', 'ai'); S.copilotOpen = false; renderPlanning(); },
    el: () => $('#calCard'), t: 'Human in the loop',
    p: 'We accepted four changes and rejected the merge. The red border is gone and the KPIs recomputed. Nothing changed until a person clicked.' },
  { go: 'planning', el: () => $('#whyCard'), t: 'Every change explains itself',
    p: 'Whenever the plan changes, whether by an AI suggestion or a human edit, this panel says what moved and why: the driver (discount, audience, stock transfer) and the effect on demand, stockout, margin and the rules.',
    say: 'Stock went up after the Pune transfer, so the stockout risk collapsed. The AI shows its reasoning, not just the answer.' },
  { go: 'planning', do: () => { const it = item('c1'); pushUndo(); it.start -= 2; audit(role().n, 'Moved on canvas', 'Diwali Footwear Fest: 2 days earlier'); explainChange(lastUndo(), ['c1'], 'Moved on canvas'); renderPlanning(); },
    el: () => $('#whyCard'), t: 'A human edit, explained too',
    p: 'We dragged the campaign two days earlier. The simulation reruns instantly, and the explanation flags straight away that the campaign <b>no longer covers Diwali</b> and baseline demand drops. That’s a mistake a planner catches in seconds.',
    say: 'Humans make changes too, and the system explains the consequences of theirs just like the AI’s.' },
  { go: 'planning', do: () => { undo(); S.lastChange = null; renderPlanning(); }, el: () => $('#detailCard'), t: 'Undo, then check operational risks',
    p: 'We undid the move with one click. Below, each campaign lists its operational risks, such as stockout, store pick load, launch lead time, supplier dependency, contact fatigue and courier capacity at peak, alongside a store-by-store view.' },
  { go: 'planning', el: () => $('#historyCard'), t: 'Every action is audited',
    p: 'Who asked, what the AI proposed, what the human accepted or rejected. Full undo and version history.' },
  { go: 'promo', do: () => { Object.assign(S.promo, { tab: 'recs', goal: 'profit', win: 'pre', region: 'all', cat: 'all', aud: 'any' }); renderPromo(); }, el: () => document.querySelector('.rec-card'), t: 'Promotions: what to run, where, for whom',
    p: 'The Promotions tab scans every customer group × product × location, simulates each offer against the guardrails, and ranks the rule-safe ones. Each card shows its impact, why it’s recommended, and its operational risks.' },
  { go: 'promo', do: () => { S.promo.tab = 'map'; S.promo.region = 'KA'; S.promo.focus = 'APuplift'; renderPromo(); }, el: () => document.querySelector('.suit'), t: 'Suitability map',
    p: 'For one location: which offer suits which customer group and category. Green cells are profitable. Click any cell for the full explanation.' },
  { go: 'promo', do: () => { S.promo.tab = 'builder'; Object.assign(S.promo.b, { goal: 'clear', region: 'DL', cat: 'AP', week: 3, len: 8, budget: 60000 }); renderPromo(); }, el: () => $('#builderRec'), t: 'Campaign builder',
    p: 'State a goal (“clear aging jackets in Delhi, week 3”). The builder compares every customer group and discount level, then recommends the best campaign with its reasons and risks.',
    say: 'Recommended campaign, with the reasoning and risks right next to it.' },
  { go: 'planning', do: () => { const r = builderBest(); if (r) addRec(r.it.region, r.it.cat, r.it.aud, r.it.disc, r.it.start, r.it.len, r.it.budget); S.screen = 'planning'; render(); },
    el: () => $('#whyCard'), t: 'From recommendation to plan',
    p: 'One click adds it to the plan as a draft, and the explanation panel immediately says why it was added and what it does to the plan.' },
  { go: 'sim', do: () => { S.sim.id = 'c1'; S.sim.stress = {}; S.sim.crisis = null; renderSim(); }, el: () => cardWith('Digital twin'), t: 'Simulation Lab',
    p: 'A Monte Carlo digital twin runs 2,000 simulations and shows the revenue distribution, the probability of a stockout and of a margin breach. Ranges, not guesses.' },
  { go: 'sim', do: () => injectCrisis(), el: () => cardWith('Agent Decision Room'), t: 'Crisis injection',
    p: 'We inject a 5-day supplier delay. Seven specialist agents report from model outputs, and the orchestrator returns one feasible proposal.' },
  { go: 'approvals', do: () => { S.apprSel = 'c3'; S.unsafeCopy = false; renderApprovals(); }, el: () => cardWith('Approval chain'), t: 'Readiness & approval',
    p: 'A go/no-go scorecard and an approval chain set per retailer profile. No single person can create, approve and publish, and the AI can never approve.' },
  { go: 'approvals', do: () => { S.unsafeCopy = true; renderApprovals(); }, el: () => cardWith('Creative'), t: 'Creative guardrails',
    p: 'Text-only creative in several tones and languages. Risky copy (fake urgency, unverifiable claims, inflated reference prices) is flagged and blocked.' },
  { go: 'war', do: () => { S.unsafeCopy = false; clearInterval(warTimer); Object.assign(S.war, { tab: 'live', day: 0, transfer: 'none', alerted: false, running: false }); for (let i = 0; i < 4; i++) stepWar(); },
    el: () => $('.region-tiles'), t: 'War Room: live monitoring',
    p: 'Four days into Diwali, Delhi footwear demand is 30% above forecast. The early-warning alert and circuit breaker fire automatically.' },
  { go: 'war', do: () => { S.war.transfer = 'sim'; renderWar(); }, el: () => cardWith('Intervention'), t: 'Simulate, then approve',
    p: 'The AI proposes a stock transfer from Pune. We simulate before and after, and a human approves. The AI never acts on its own.' },
  { go: 'war', do: () => { S.war.tab = 'learn'; renderWar(); }, el: () => cardWith('Learning loop'), t: 'The learning loop',
    p: 'Actuals are compared with predictions, complaints are clustered and ranked by likely cause, and new guardrails are learned for next time.' },
  { go: 'gov', do: () => { renderGov(); $('#gtCat').value = 'FW'; $('#gtDisc').value = 40; runGovTest(); }, el: () => cardWith('Try to break'), t: 'Guardrails & governance',
    p: 'A manager tries 40% off footwear. It’s blocked, with the reasons and a feasible alternative. Retailer profiles, data tiers, roles and the audit trail are all configurable here.' },
  { go: 'control', el: () => $('.home'), t: 'Plan → Simulate → Approve → Act → Learn',
    p: 'That’s the full loop. Click Finish to open the 30-second executive brief.', say: 'Don’t just predict the promotion. <b>Simulate the decision.</b>', last: true }
];
const tour = { on: false, i: 0 };
function startTour() {
  endTour();
  clearInterval(warTimer); initState(); S.copilotOpen = false; render();
  tour.on = true; tour.i = 0;
  document.body.insertAdjacentHTML('beforeend', `<div class="tour-block" id="tourBlock"></div><div class="tour-spot" id="tourSpot"></div><div class="tour-card" id="tourCard"></div>`);
  showStep(true);
}
function endTour(brief) {
  tour.on = false; ['#tourBlock', '#tourSpot', '#tourCard'].forEach(s => { const e = $(s); if (e) e.remove(); });
  if (brief) showBrief();
}
function showStep(forward) {
  const st = TOUR[tour.i];
  if (S.screen !== st.go) { S.screen = st.go; render(); }
  if (forward && st.do) st.do();
  const card = $('#tourCard');
  card.innerHTML = `<div class="step">Step ${tour.i + 1} of ${TOUR.length}</div><h4>${st.t}</h4><p>${st.p}</p>${st.say ? `<div class="say">🎤 ${st.say}</div>` : ''}
    <div class="nav2"><div class="tour-dots">${TOUR.map((_, i) => `<i class="${i === tour.i ? 'on' : ''}"></i>`).join('')}</div>
    <button class="btn sm" onclick="endTour()">Exit</button>
    <button class="btn sm" onclick="tourStep(-1)" ${tour.i ? '' : 'disabled'}>Back</button>
    <button class="btn sm gold" onclick="tourStep(1)">${st.last ? 'Finish' : 'Next →'}</button></div>`;
  setTimeout(() => { const el = st.el && st.el(); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(placeTour, 400); }, st.wait || 60);
}
function tourStep(d) {
  if (d > 0 && TOUR[tour.i].last) { endTour(true); return; }
  tour.i = clamp(tour.i + d, 0, TOUR.length - 1); showStep(d > 0);
}
function placeTour() {
  if (!tour.on) return;
  const st = TOUR[tour.i], el = st.el && st.el(), spot = $('#tourSpot'), card = $('#tourCard');
  const vw = innerWidth, vh = innerHeight, cw = 360, ch = card.offsetHeight, pad = 6;
  if (!el) { spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0`; card.style.left = (vw - cw) / 2 + 'px'; card.style.top = (vh - ch) / 2 + 'px'; return; }
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top - pad, 60), bottom = Math.min(r.bottom + pad, vh - 8);
  const left = Math.max(r.left - pad, 4), right = Math.min(r.right + pad, vw - 4);
  Object.assign(spot.style, { left: left + 'px', top: top + 'px', width: right - left + 'px', height: Math.max(bottom - top, 20) + 'px' });
  let x, y;
  if (vw - right > cw + 24) { x = right + 16; y = top; }
  else if (left > cw + 24) { x = left - cw - 16; y = top; }
  else if (vh - bottom > ch + 24) { x = left; y = bottom + 14; }
  else if (top - 60 > ch + 24) { x = left; y = top - ch - 14; }
  else { x = vw - cw - 24; y = vh - ch - 24; }
  card.style.left = clamp(x, 12, vw - cw - 12) + 'px';
  card.style.top = clamp(y, 64, vh - ch - 12) + 'px';
}
addEventListener('resize', placeTour);
document.addEventListener('scroll', () => requestAnimationFrame(placeTour), true);
document.addEventListener('keydown', e => { if (!tour.on) return; if (e.key === 'ArrowRight' || e.key === 'Enter') tourStep(1); else if (e.key === 'ArrowLeft') tourStep(-1); else if (e.key === 'Escape') endTour(); });

/* ---------------- Boot ---------------- */
function boot() {
  initState();
  $('#profileSel').addEventListener('change', e => setProfile(e.target.value));
  $('#seasonSel').addEventListener('change', e => { S.season = e.target.value; audit(role().n, 'Season mode', SEASONS[S.season].n); toast(`Season mode: ${SEASONS[S.season].n}. Uncertainty σ = ${sigma()}, safety buffers updated.`); render(); });
  $('#roleSel').addEventListener('change', e => { S.role = e.target.value; audit('System', 'Role switched', role().n); toast(`Viewing as <b>${esc(role().n)}</b>${canEdit() ? '' : ' (read-only)'}`); render(); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });
  bindCanvas();
  render();
}
boot();
