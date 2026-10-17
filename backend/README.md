# RetailVerse AI · Backend

FastAPI backend for the AI Retail Decision Twin (TCS Hackathon, Retail PS3). It implements the blueprint's rule:
**LLMs do language; forecasts, optimization and simulation are deterministic services the LLM calls as tools.**

## Quick start

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # optional
.venv/bin/uvicorn app.main:app --port 8000 --reload
```

* API docs: http://localhost:8000/docs
* The repo's static prototype is also served at http://localhost:8000/
* Tests: `.venv/bin/python -m pytest -q`

## Open-source LLM (pick one)

| Option | Setup |
|---|---|
| **Groq** (hosted Llama/Qwen) | `GROQ_API_KEY=...` in `backend/.env` (default model `llama-3.3-70b-versatile`) |
| **Ollama** (local) | `ollama serve` then `ollama pull llama3.1:8b` (any tool-calling model: `qwen2.5`, `llama3.1`, `mistral-nemo`) |
| **None** | Copilot falls back to a deterministic intent router that calls the same tools |

`LLM_PROVIDER=auto` (default) uses Groq if a key is set, else Ollama if reachable, else the rules engine. Check with `GET /api/llm`.
Both providers speak the OpenAI-compatible `/chat/completions` tool-calling API, so one client (`app/llm.py`) serves both.

## Copilot design (`app/copilot.py`)

1. The LLM gets 19 tools (`get_plan`, `get_forecast`, `get_inventory`, `get_segments`, `simulate`, `check_constraints`, `find_conflicts`, `suggest_transfer`, `optimize`, `explain_discount`, `propose_*`, `draft_copy`, `check_copy`).
2. **Drafts only.** `propose_*` tools write to a draft layer (proposals → change sets with before/after diffs, validated against hard rules, with evidence strength and a proceed/pilot/experiment recommendation). There is no tool that accepts, approves or publishes.
3. **Humans decide**: `POST /api/proposals/{id}/changes/{cid}/accept|reject` (accept can carry an edit patch), or accept/reject a whole set. Undo/redo and an audit log cover every action.
4. **Grounding check**: numbers in the LLM's final answer that don't appear in any tool result are returned in `grounding.ungrounded_numbers` plus a warning.
5. ABAC/RBAC is enforced inside tools too (e.g. a Store Manager's LLM calls can't touch other regions).

`POST /api/copilot/chat` → `{reply, mode: llm|rules, provider, proposals[], tool_calls[], evidence, grounding, warnings}`

## Endpoints (all under `/api`, role via `X-Role: marketing|merch|supply|exec|store|admin`)

| Module | Endpoints |
|---|---|
| M1/M2 data & tools | `GET /plan` `PATCH /plan/items/{id}` (drag/resize → live metrics) `POST /plan/items` `DELETE` `undo` `redo` `GET /forecast` `/inventory` `/segments` `/market-pulse` `/conflicts` `/constraints` `/transfers/suggest` `/explain/discount` `POST /simulate` `/optimize` |
| Copilot / HITL | `POST /copilot/chat` `GET /copilot/history` `GET /proposals` `POST /proposals/{pid}/changes/{cid}/accept\|reject` `POST /proposals/{pid}/accept\|reject` |
| M4 Simulation Lab | `GET /simulation/{id}` (Monte Carlo ranges, counterfactual, red-team, confidence, agent room) `PUT /simulation/stress` `POST /simulation/{id}/crisis` |
| M5 Readiness & Approval | `GET /approvals` `PATCH /approvals/{id}/readiness` `POST .../submit\|override\|approve\|reject\|go-live` `POST /creative/draft\|check` |
| M6 War Room & Learning | `GET /warroom` `POST /warroom/step\|transfer/simulate\|transfer/approve\|reset` `GET /learning` `POST /learning/guardrail` |
| Governance | `GET/PUT /governance` (guardrails, profile, season, data tier) `POST /governance/test` `GET /audit` |
| M7 Control Tower | `GET /control` `GET /control/executive-brief` |

## Layout

```
app/data.py      synthetic scenario + config (ported from ../app.js)
app/models.py    forecast, stockout, margin, Monte Carlo, constraints, conflicts, optimizer
app/services.py  tool layer + proposals/change sets + accept/reject + guardrailed copy
app/ops.py       simulation lab, approvals, war room, learning, governance, control tower
app/copilot.py   tool schemas, LLM loop, grounding check, rules fallback
app/llm.py       Ollama/Groq OpenAI-compatible client
app/store.py     SQLite persistence (state JSON + audit table)
```

State lives in `backend/data/aibos.db` (SQLite). `POST /api/reset` restores the seeded scenario (the planted Hyderabad footwear stockout trap).
All data is synthetic, counterfactuals are estimates and root causes are hypotheses.
