# ReadyForge — AI Production-Readiness Operating System

**The pre-flight check for AI content campaigns.** ReadyForge helps solo creators and teams turn
scattered intent, facts, assets, brand rules and budgets into a verified **Production Contract**
*before* expensive AI generation — then generates progressively, verifies output against the
contract, and keeps a full provenance and audit trail.

Core loop:

```
Create campaign → collect role-based inputs → detect conflicts & rights issues → resolve
→ readiness + cost-at-risk → approve Production Contract → generate script/storyboard
→ verify output → approve/reject → Provenance Passport
```

## Architecture

```
React SPA (Vite :5173)  ──REST/JSON──►  Express API (:4000)  ──►  MongoDB
                                             │
                                             └──OpenAI-compatible HTTP──►  FastAPI AI service (:8001)
                                                                            ├── Qwen2.5-0.5B-Instruct (generation)
                                                                            └── DistilBERT-MNLI (contradiction detection)
```

All AI is **self-hosted and keyless** — no OpenAI/Anthropic key required. If the AI service is
down, the backend fails soft to a deterministic rule engine, so the app keeps working.

## Prerequisites

- Node.js 20+ and npm
- Python 3.10+ (for the AI service)
- MongoDB — a free [Atlas](https://www.mongodb.com/atlas) cluster, **or** nothing: with no
  `MONGODB_URI` the server starts a local file-backed MongoDB automatically (`server/.data`)

## Quick start

```bash
# 1. Install JS dependencies (npm workspaces: server + client)
npm install

# 2. Configure the backend (see below)
cp .env.example server/.env   # template at repo root; the API reads server/.env

# 3. AI service (optional but recommended — see next section)

# 4. Run API + web together
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000/api/health

A fresh database is **seeded automatically on first start** with demo users, a workspace,
two projects, knowledge inputs, an open conflict, assets, an approved Production Contract,
generation history and a verification report.

## Environment variables (`server/.env`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGODB_URI` | no | local file-backed DB | MongoDB connection string (Atlas). Append `/readyforge` for the DB name. |
| `JWT_ACCESS_SECRET` | prod: yes | dev default | Access-token signing secret — generate a long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_REFRESH_SECRET` | prod: yes | dev default | Refresh-token signing secret (use a second, different string) |
| `CORS_ORIGIN` | prod: yes | `http://localhost:5173` | Allowed frontend origin(s), comma-separated |
| `PORT` | no | `4000` | API port |
| `OPENAI_BASE_URL` | no | OpenAI | Point at the local AI service: `http://127.0.0.1:8001/v1` |
| `OPENAI_API_KEY` | no | — | Any non-empty value enables the AI path when using the local service (never a real key for local use) |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Model name sent to the provider (local: `Qwen/Qwen2.5-0.5B-Instruct`) |
| `LOCAL_AI_URL` | no | — | Custom-protocol AI endpoints (NLI conflict/claim checks): `http://127.0.0.1:8001` |
| `MAX_UPLOAD_MB` | no | `25` | Upload size limit |
| `SEED_ON_START` | no | `true` | Set `false` to disable auto-seeding |

> Never commit `server/.env` — it is gitignored. Secrets stay on the server; the frontend never
> sees them.

## AI service (local, keyless)

Full details, training and model options: **[ai-service/README.md](ai-service/README.md)**.

```bash
cd ai-service
python -m venv .venv
.venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cu126  # Windows/CUDA
.venv/Scripts/python -m pip install -r requirements.txt

# train the contradiction model once (a few minutes; CPU works too)
.venv/Scripts/python train/train_nli.py --max-train-samples 60000 --epochs 2

# run
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Then point `server/.env` at it (values above). Verify with `curl http://127.0.0.1:8001/health`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (`tsx watch`) + web (`vite`) together |
| `npm run build` | Build server + client for production |
| `npm run typecheck` | `tsc --noEmit` for both workspaces |
| `npm run seed` | (Re)run the demo seed — also backfills contract/generation data into older demo DBs |
| `npx tsx seed-selftest.ts` (in `server/`) | Runs the seed against a throwaway in-memory MongoDB and asserts the demo data shape |

## Demo instructions

1. Start everything (`npm run dev` + AI service) and open http://localhost:5173.
2. Sign in with the seeded accounts:
   - **Owner:** `demo@readyforge.ai` / `demo1234`
   - **Lead:** `lead@readyforge.ai` / `demo1234`
3. **3-minute tour (Judge Mode):** Dashboard → **Simulate Risky Campaign** loads a project with
   conflicting price inputs, an unsupported growth claim, an unlicensed asset and a high Waste
   Receipt. Then:
   - **Cost at Risk** — Waste Receipt + Campaign Risk Score (rework probability × planned cost)
   - **Conflicts** — one-click recommended resolution with authority-aware routing
   - **Rights** — Rights Expiry Sentinel; unlicensed assets block final generation
   - **Contract** — approve and lock the Production Contract
   - **Draft ladder** — generate script/storyboard stage by stage (cost estimate per rung)
   - **Verify** — contract verification with evidence per check
   - **Campaign lab** — Pre-Flight Forecast, Audience Simulation, Variant Matrix, Experiment Planner
   - **Provenance** — Claim Passport + Provenance Passport (AI models, costs, approvals)

## Project structure

```
server/     Express + Mongoose API (routes, engines, models, middleware, AI client, seed)
client/     React 19 + Vite + Tailwind SPA
ai-service/ FastAPI: local Qwen generation + fine-tuned DistilBERT contradiction model
```

## Product rules the app enforces

- No invented facts: unsupported critical claims block generation
- Unlicensed / restricted / expired assets block final generation
- Critical unresolved conflicts block generation; the contract must be approved and locked first
- Warnings can be overridden by a human **with a reason** — every approval, rejection,
  resolution, override and generation is audit-logged
- AI-generated content is labelled `AI-assisted`; every AI finding shows evidence, severity and
  a suggested fix (or states that evidence is unavailable)

## Disclaimer

Rights and compliance checks are decision support, not legal advice. Model outputs are
assistance, not authority — the human keeps final control.