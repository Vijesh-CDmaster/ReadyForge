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

The default local AI service is **self-hosted and keyless**. Any OpenAI-compatible endpoint can
be configured instead; without a reachable model, the backend fails soft to a deterministic rule
engine so the rest of the application keeps working.

## Prerequisites

- Node.js 20+ and npm
- Python 3.10+ (optional, for the local AI service)
- FFmpeg and FFprobe with `libx264` and AAC for local MP4 rendering. Non-render features work
  without them; set `FFMPEG_PATH` / `FFPROBE_PATH` if the executables are not on `PATH`.
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

A fresh database is **seeded automatically on first start** with two demo workspaces and three
projects: the Inkloom campaign demo, plus the render-ready **Studio Demo**. The seed also creates
knowledge inputs, one open campaign conflict, one resolved Studio conflict, assets, an approved
Production Contract, a locked Studio Contract, generation history and a verification report. See
[docs/STUDIO_DEMO.md](docs/STUDIO_DEMO.md) for the Studio path.

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
| `VIDEO_PROVIDER` | no | `mock` | Legacy async provider (`mock` or `runway`); local MP4 rendering uses FFmpeg directly |
| `FFMPEG_PATH` | no | `ffmpeg` on PATH | FFmpeg executable used by the local renderer |
| `FFPROBE_PATH` | no | `ffprobe` on PATH | FFprobe executable used for media validation |
| `VIDEO_RENDER_TIMEOUT_MS` | no | `300000` | Hard limit for one local FFmpeg render |
| `VIDEO_MAX_COST_USD` | no | `0` | Fail-closed cost cap for paid Runway jobs; `0` disables paid execution |

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
| `npm test` | Client component tests |
| `npm run test:server` | Server unit and integration tests |
| `npm run lint` | ESLint across the repository |
| `npm run seed` | (Re)run the demo seed — also backfills contract/generation data and reconciles Studio Demo |
| `npm run seed:studio` | Idempotently seed the render-ready Studio Demo project — see [docs/STUDIO_DEMO.md](docs/STUDIO_DEMO.md) |
| `npx tsx seed-selftest.ts` (in `server/`) | Runs the seed against a throwaway in-memory MongoDB and asserts the demo data shape |

## Video generation and local rendering

There are two distinct paths; do not confuse them.

**Local MP4 rendering (implemented).** The editor saves a multi-track composition through
`PUT /api/projects/:id/composition`, then submits `POST /api/projects/:id/renders` with an
`Idempotency-Key`. The normal worker validates readiness, the locked Production Contract, rights
and budget before running local FFmpeg. The result is H.264/AAC MP4 stored as a protected project
asset and served only through `GET /api/assets/:id/file`. Text overlays, transitions, audio fades,
multiple video/audio tracks and SRT-derived text clips are rendered by the local pipeline.
Rendering is unavailable, with a clear error, when FFmpeg/FFprobe or the required encoders are
missing.

**Legacy asynchronous provider jobs.** The API also exposes a durable provider-job flow:

- `POST /api/projects/:id/video-jobs` — enqueue a job; send an `Idempotency-Key` header
- `GET /api/projects/:id/video-jobs` — list authorized project jobs
- `GET /api/projects/:id/video-jobs/:jobId` — read authorized status and progress
- `POST /api/projects/:id/video-jobs/:jobId/retry` — retry an eligible failed job
- `POST /api/projects/:id/video-jobs/:jobId/cancel` — cancel a queued job

Jobs are atomically claimed with a lease, heartbeat updates, stale-lease recovery, bounded
retries, and lease ownership checks. `VIDEO_PROVIDER=mock` is the offline default; its output is
explicitly labelled as a non-playable mock artifact and is never treated as approved production
media. Runway is fail-closed unless `VIDEO_PROVIDER=runway`, `RUNWAY_API_KEY`,
`RUNWAY_ESTIMATED_COST_USD`, and `VIDEO_MAX_COST_USD` are explicitly set. Paid provider execution
and separate worker deployment are **not** implemented. Provider credentials are server-only and
must never be placed in client configuration or committed to `.env.example`.

Video reservations use durable per-project operation markers: the marker and budget counter change
are committed in one MongoDB update, while worker recovery repairs reservation state after a
crash. Repeated settlement and refund operations are idempotent. Runway submissions with unknown
outcomes are recorded for manual reconciliation rather than blindly retried.

## Demo instructions

1. Start everything (`npm run dev` + optional AI service) and open http://localhost:5173.
2. Sign in with the seeded accounts:
   - **Owner:** `demo@readyforge.ai` / `demo1234`
   - **Lead:** `lead@readyforge.ai` / `demo1234`
3. **Studio Demo (render path):** Open **ReadyForge Studio** → **Studio Demo — Product Launch
   Film**, review the ledger, resolved conflict, rights and locked Contract, then open **Video
   editor** and click **Render MP4**. Follow [docs/STUDIO_DEMO.md](docs/STUDIO_DEMO.md) for the
   full sequence.
4. **3-minute tour (Judge Mode):** Dashboard → **Simulate Risky Campaign** loads a project with
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