# AI BOS: Business Operations System

**Don't just predict the promotion. Simulate the decision.**

This is a clickable prototype of the TCS Hackathon blueprint (Retail / E-commerce, PS3). Retail teams plan promotions on a visual canvas. An AI copilot proposes edits, and every edit is checked against inventory, margin and budget and simulated with ranges. Nothing is applied until a human accepts it.

## Run

No install or build step is needed. From this folder, run:

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## Files

| File | What it holds |
|---|---|
| `index.html` | App shell: sidebar, top bar with profile, season and role |
| `styles.css` | All styling |
| `app.js` | Synthetic data, the models (forecast, stockout, margin, Monte Carlo, optimizer, constraints, conflicts), all 6 screens and the copilot |

## Modules → screens

| Blueprint | Screen |
|---|---|
| M7 Control Tower | **Control Tower**: morning brief, decisions, executive brief, KPIs |
| M2 Planning Canvas (hero) | **Planning Canvas**: timeline, drag/resize, heatmaps, live KPI bar, AI copilot, campaign inspector, store view, history/audit |
| M3 Decision Engine | Optimizer + agent room (used by the copilot, shown in Simulation Lab) |
| M4 Simulation Lab | **Simulation Lab**: Monte Carlo, counterfactuals, ghost replay, stress tests, crisis injection, confidence panel |
| M5 Readiness & Approval | **Readiness & Approval**: go/no-go scorecard, approval chain, text creative with guardrails |
| M6 War Room & Learning | **War Room & Learning**: live feed, early warning, intervention, circuit breakers, reality check, feedback, root cause, learning loop |
| Governance | **Guardrails & Config**: profiles, data tiers, guardrails, rule-break test, RBAC, audit trail |

## Built-in guided demo

Click **▶ Guided demo** in the top bar. It resets the data and walks through the whole story in 20 steps. Each step highlights one part of the screen, performs the action, and shows an explanation plus a 🎤 talking point for the presenter. Use **Next / Back** or the ← → keys, and **Esc** to exit. Clicking **Finish** on the last step opens the executive brief.

## 7-minute demo script (manual)

1. **Control Tower**: the morning brief flags the Diwali opportunity and the Hyderabad footwear risk.
2. **Profile switch** (top bar): Fashion & Footwear → Grocery → back. The brief, KPIs and approval chain adapt.
3. **Planning Canvas**: *Diwali Footwear Fest* has a red border (81% stockout, margin below floor). Click **Critique my plan**.
4. The copilot proposes a change set: 25% → 16%, target the high-uplift segment, trim budget, transfer stock from Pune, merge the overlapping flash sale. Ghost cards appear, and the KPI bar shows `→` deltas.
5. **Human in the loop**: accept the transfer and discount, reject the merge, then drag the card 2 days earlier. KPIs update live and the red border clears.
6. Try `₹2L, clear aging jackets in Delhi before Diwali, margin ≥ 22%`, *Why 16%?*, *Budget ₹10L → ₹6L?*
7. **Simulation Lab**: counterfactual table ("why not 20%?"), then **Inject crisis**. The agents recompute.
8. **Readiness & Approval**: switch role to Merchandiser → approve, then Supply Chain → approve. Click *Test: paste risky copy* to show the guardrails blocking it.
9. **War Room**: click **Run live feed**. Delhi turns red on day 4, the feed pauses, you simulate the transfer and approve it.
10. **Reality check & learning**: complaint spike on Product C, then **Add guardrail**. Close with the Executive Brief.

Use **Reset demo** in the sidebar to start over.

## Notes

- All data is synthetic, counterfactuals are estimates and root causes are hypotheses.
- The copilot is a deterministic intent parser that calls the real simulator and optimizer functions in `app.js`. Every number comes from those tools and is never made up. To swap in an LLM with tool calling (e.g. Claude), give it the same functions as tools: `simulate`, `optimize`, `check_constraints`, `find_conflicts`, `suggest_transfer`, `draft_copy`.
- The AI writes only to a draft layer and cannot approve or publish. Every action is recorded in the audit log.
