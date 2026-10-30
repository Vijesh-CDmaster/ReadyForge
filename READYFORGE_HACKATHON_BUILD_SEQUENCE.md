# ReadyForge — Hackathon Build Sequence

**Date:** 2026-10-30
**Purpose:** the exact, safest order to implement the approved P0/P1 work, verify it, and freeze for submission.
**Status:** planning only. Nothing in this sequence has been implemented. The exceptions already performed are read-only checks and starting the local AI service for verification.

## Ground rules

1. **Freeze the baseline first.** `HEAD` is `fdcc49f` and contains the Phase 3C editor/render work. Do not reset, rebase, stash, clean, or amend it.
2. **One branch, small commits.** Create `hackathon/p0` for the changes; commit per step only with the user's approval. Never stage unrelated files.
3. **No P2 work today.** No renderer graph rewrites, no schema migrations, no auth changes, no dependency upgrades.
4. **Every step ends with a check.** If a check fails, fix forward within the step; if it cannot be fixed in the time box, revert only that step's commit (not the baseline).
5. **Stop adding features 2 hours before submission.** After that, only demo fixes and documentation.
6. **Back up demo data before touching the database.** With the API stopped, copy `server/.data` (or take a Mongo dump if using an external URI). Never delete `server/.data` or uploaded assets.

## Preconditions (verify before the clock starts)

```bash
git log --oneline -1                 # expect fdcc49f (or a later intentional commit)
git status --short                   # expect only planning docs / no half-finished edits
npm run test:server                  # expect 211 passing
npm test                             # expect 29 passing
curl -s localhost:4000/api/health
curl -s localhost:8001/health        # AI service (started and verified today)
tools/ffmpeg/bin/ffmpeg.exe -version
```

If the API or AI service is not running, start them before any demo work:

```bash
# API + web
npm run dev
# AI service (separate terminal)
cd ai-service && ./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

---

## Sequence at a glance

| Step | Time box | Work | Gate |
|---|---|---|---|
| S0 | 0:00–0:20 | Baseline snapshot, branch, backup, record current green state | Tests green |
| S1 | 0:20–0:50 | **P0-1** cost-at-risk stage fix | Engine test + full server suite |
| S2 | 0:50–3:20 | **P0-2** Studio Demo seed (media, contract, composition, idempotency) | Fresh-DB seed + API assertions |
| S3 | 3:20–4:20 | Fresh-DB browser verification of editor → render → playback | Real MP4 plays |
| S4 | 4:20–5:00 | **P0-3/P0-4** README truth, AI runbook, demo docs | Docs review + AI generation label |
| S5 | 5:00–6:30 | **P1** deletion cascade, fingerprint, unsaved guard, render limiter, parity note, docs | Targeted tests |
| S6 | 6:30–7:15 | Optional **P1** track rename (only if S1–S5 green) | Component test |
| S7 | 7:15–8:30 | Full quality gates (server, client, typecheck, lint, build, smoke) | All exit 0 |
| S8 | 8:30–9:15 | Demo rehearsal, backup recording, freeze | Rehearsal passes twice |
| Buffer | 9:15–9:45 | Only blocker fixes; no new work | — |

---

## S0 — Baseline and safety net (20 min)

**Do**
1. Record `git log -1`, `git status --short`, test counts, and the current demo project state (readiness/authorization) in a scratch note.
2. Create the branch `hackathon/p0` (no commit yet).
3. Stop the API; copy `server/.data` to a timestamped backup outside the repo or under an ignored directory; restart.
4. Capture the current **UI Verification · Local Render** project URL and confirm it is authorized and has a composition. This is the emergency fallback demo.

**Acceptance:** baseline tests green; backup exists; fallback project identified.
**Rollback:** none needed.

---

## S1 — P0-1 cost-at-risk stage fix (30 min)

**Change**
```ts
// server/src/engines/costAtRisk.ts
const stageCosts: Record<string, number> = { concept: 50, script: 200, storyboard: 450, preview: 700, final: 900 };
const base = stageCosts[project.currentStage] ?? 300;
```
Keep all downstream formulas unchanged. Do not rename fields or change API shape.

**Test**
Add to `server/src/__tests__/engines.test.ts`: same project, stages `script` < `preview` < `final`; assert `plannedCost` increases and `waste receipt` recomputes.

**Commands**
```bash
npm run test:server -- engines
npm run test:server
npm run typecheck -w server
```

**Acceptance:** engine test fails on the old code, passes on the new; 211+ server tests pass; `/projects/:id/cost-at-risk` responds with stage-sensitive `plannedCost`.
**Risk:** low. **Rollback:** revert the single file + test.

---

## S2 — P0-2 render-ready Studio Demo seed (2.5 h)

> This is the highest-value and highest-risk step. Time-box it; if it is not green by 3:20, switch to the fallback (S3-F) and do not debug live.

### S2a — Design (15 min)

- New idempotent function `ensureDemoStudio()` called from `seed()` and `topUpDemoPipeline()`.
- Project title: **“Studio Demo — Launch Spot”** in the Inkloom workspace, owned by `demo@readyforge.ai`.
- Objective/audience/tone/CTA/deadline set; budget 5000 INR; stage `final`; status `ready`.
- Approved inputs covering objective, audience, tone, CTA, accessibility (captions). No open conflicts.
- Contract `locked`, version 1, all required approvals `approved`.
- Composition: 3 tracks / 4 clips:
  - V1: two 3 s clips (violet, amber) with `fade-black` transition, 0.6 s;
  - A1: 6 s tone, volume 0.8, fade in/out 0.8 s;
  - T1: “INKLOOM” title, 0.5–4.6 s, fade/slide entrance, fade exit.
- Assets: licensed `owned`, correct `sourceDurationSeconds`.

### S2b — Media generation (45 min)

Use the configured FFmpeg via `config.video.ffmpegPath` and `spawn` with arguments (no shell). Resolve a font through `resolveApprovedFont('sans', true, false)`; if null, generate solid-colour clips without drawtext (the editor text overlay still demos).

Suggested commands (arguments, not shell strings):
```text
-f lavfi -i color=c=0x5B4BFF:s=1280x720:d=3:r=30 -vf drawtext=... -c:v libx264 -pix_fmt yuv420p -preset veryfast -y <file1>
-f lavfi -i color=c=0xFFB347:s=1280x720:d=3:r=30 ... <file2>
-f lavfi -i sine=frequency=220:duration=6 -af volume=0.15 -c:a pcm_s16le <tone.wav>
```
- Cap generation to ~10 s each; clean partial files on failure.
- If FFmpeg is unavailable, log `[seed] studio media skipped: FFmpeg unavailable`, skip the Studio project, and keep the rest of the seed working.

### S2c — Project, contract, composition (45 min)

- Compute readiness/authorization with existing services before saving; if not authorized, log the blockers and **do not** create a misleading “ready” project.
- Use the existing `EditComposition` model; set `schemaVersion: 2`, tracks with unique order, clips with source in/out and durations consistent with the assets.
- Reuse `evaluateProductionAuthorization` in the seed self-test to assert `authorized === true`.

### S2d — Idempotency and self-test (30 min)

- Find by workspace + exact title. If it exists, only backfill missing pieces (contract or composition), never duplicate assets.
- Do not modify **Product Launch Video** (its open conflict is the governance demo).
- Extend `server/seed-selftest.ts`: run seed twice; assert one studio project, one composition, ≥2 video assets, contract locked, readiness authorized, track/clip counts stable.

**Commands**
```bash
cd server && npx tsx seed-selftest.ts
npm run seed
npm run seed           # second run: no duplicates
```

**Acceptance:** both self-test and double-seed pass; logs show no stack traces; no user data deleted.
**Rollback:** revert the seed/demo files; the existing DB is unaffected because the new function only adds a project (remove only that project if needed, with explicit approval).

### S3-F — Fallback if S2 misses its time box

Use the existing **UI Verification · Local Render** project for the demo. Do not attempt a fresh-DB demo; pre-record the render. Keep S1/S4. Document the limitation honestly.

---

## S3 — Fresh-DB browser verification (60 min)

**Do**
1. With the API stopped, move the current DB directory to a backup (do not delete).
2. Start the API; auto-seed runs.
3. Log in as `demo@readyforge.ai` / `demo1234`.
4. Open **Studio Demo — Launch Spot** → Editor.
5. Verify: 2 video clips, text clip, audio clip, transition; preview plays; change the title text; change a transition duration; save.
6. Click **Render** → wait for `succeeded` → play the protected MP4; confirm duration/status.
7. Re-run the seed and confirm the project does not duplicate.

**Acceptance:** one continuous browser pass with no console errors; MP4 plays; job status `succeeded`; output asset owned/licensed.
**Rollback:** restore the backed-up DB only if the fresh-DB run is unrecoverable; otherwise keep it.

---

## S4 — P0-3/P0-4 documentation and AI truth (40 min)

**README changes**
- New section: **Video editor & local MP4 rendering** — multi-track video/audio/text, transitions, animations, SRT, audio fades, FFmpeg, protected output.
- Replace the stale statement “Real-provider billing, MP4 generation … not implemented” with the actual split: **local MP4 rendering implemented; paid provider jobs remain mock/optional**.
- Add a 7-step demo path including the Studio Demo and the real render.
- Add the AI service start command and the honest-fallback sentence.
- State clearly: local FFmpeg and self-hosted AI are free; Runway is optional and paid.

**AI verification**
- `/health` 200; one chat completion; trigger one in-app generation and confirm the response source is `ai` (or deliberately demonstrate fallback).
- Do not modify `server/.env`.

**Acceptance:** README has no contradiction with implemented behaviour; a new reader can find the editor and render steps; AI label observed.
**Risk:** none (docs).

---

## S5 — P1 hardening (90 min, only if S1–S4 are green)

| Order | Item | Change | Test | Time |
|---|---|---|---|---|
| 5.1 | P1-1 delete cascade | Extend `DELETE /projects/:id`; unlink files safely | New integration test + full suite | 45 min |
| 5.2 | P1-2 fingerprint | Add `compositionRevision` to fingerprint input | New idempotency case | 15 min |
| 5.3 | P1-3 unsaved guard | `beforeunload` + in-app warning when dirty | Component test/manual | 20 min |
| 5.4 | P1-5 render limiter | `express-rate-limit` keyed by user id on the render route | 429 test | 15 min |
| 5.5 | P1-7 parity note | Editor note: preview approximates fonts/transitions | Manual | 5 min |
| 5.6 | P1-8 readiness docs | 7 categories/weights | Manual | 10 min |

Stop after 5.6. Do not start track rename unless ≥45 minutes remain and all gates are green.

---

## S6 — Optional P1 track rename (45 min, conditional)

- Inline rename in the track header, disabled for locked tracks.
- Update local `tracks` state; save uses existing payload.
- Test: rename persists after save/reload; locked track shows an error.
- If any editor test fails twice, revert this step; it is not worth risking the demo.

---

## S7 — Quality gates (75 min)

Run in this order, preserving exit status:

```bash
npm run test:server
npm test
npm run typecheck
npm run lint
npm run build
```

Then, with the API and a disposable/current DB running:
```bash
node scripts/smoke.mjs          # recorded 199/199; may create/clean demo data
```
If `scripts/smoke.mjs` mutates the demo DB, run it against a backed-up or disposable database, then restore the demo state.
Optional real-render check: `npx tsx scripts/verify-render.ts` if its fixture workflow is still valid.

**Acceptance:** all exit 0; new tests present; `git diff --check` clean; no secret files staged.
**If a gate fails:** fix the cause, never skip/disable a test. If the failure predates your changes, document it and revert the offending step.

---

## S8 — Rehearsal and freeze (45 min)

1. Restart from a clean state (API + web + AI).
2. Run the 7-minute demo script below twice, timing it.
3. Record a backup screen capture of the render and playback.
4. Freeze: no code changes; only notes/README typos if unavoidable.
5. Capture final evidence: test counts, render job id, output ffprobe, screenshot of editor/output.

### 7-minute demo script

| Time | Action | Talking point |
|---|---|---|
| 0:00 | Dashboard, demo login | “Production-readiness OS for AI campaigns, with a genuine local renderer.” |
| 0:30 | Product Launch Video → Conflicts | Seeded contradiction; authority-aware recommendation. |
| 1:30 | Resolve conflict → Readiness | Score/blockers change; rights and budget gates are server-side. |
| 2:15 | Cost-at-risk / Waste Receipt | Stage-aware planned cost, expected waste, after-fixes verdict. |
| 2:45 | Contract | Approve/lock; generation and render both require it. |
| 3:30 | Studio Demo → Editor | Multi-track, transitions, animated title, SRT, audio fades. |
| 4:30 | Edit → Save → Render | Progress, FFprobe validation, protected asset. |
| 5:30 | Play output; provenance | MP4 plays; claim/provenance trail and audit. |
| 6:15 | Budget/reliability + tests | Atomic reservations/refunds, 211+29 tests, AI local/free. |
| 6:45 | Close | Local FFmpeg + self-hosted AI; paid providers optional. |

**Acceptance:** two consecutive passes without a failure; backup video exists; no uncommitted experimental code.

---

## Contingency table

| Failure | Detect | Response |
|---|---|---|
| Studio seed fails | S2 acceptance | Fall back to **UI Verification · Local Render**; pre-record render; ship S1/S4. |
| Fresh DB is slow/broken | S3 | Restore backup; demo on current DB; note reproducibility limitation. |
| FFmpeg path wrong | preflight/tools endpoint | Set `FFMPEG_PATH`/`FFPROBE_PATH` in `server/.env`; restart API; never commit the path. |
| AI service down | `/health` fails | Restart from `.venv`; if it fails, demo the labelled rule-engine fallback and say so. |
| Render fails live | job `failed` | Show error code, switch to pre-rendered asset, do not debug on stage. |
| Test failure after P1 | gate | Revert the step's commit; baseline is known green. |
| Time overrun | 3:20 checkpoint | Stop P0-2; freeze scope to P0-1/P0-3/P0-4 + rehearsal. |

---

## Do-not-touch list (until after submission)

- `server/src/services/compositionRenderer.ts` filter graph (unless a P0 defect is proven).
- `EditComposition` schema and `PUT /composition` validation.
- Budget reservation/settlement logic.
- Auth/JWT/cookie behaviour.
- Worker lease/idempotency semantics (except the P1-2 fingerprint input).
- Seed's existing campaign project/conflict.
- Dependencies, lockfile, Vite/TS config, ESLint config.
- Git history; no reset/clean/force operations.
- `server/.env` (contains secrets; do not print or commit).

---

## Definition of done

- P0-1, P0-2, P0-3, P0-4 complete and verified.
- Optional P1-1…P1-5, P1-7, P1-8 complete **only if** all gates remain green.
- Fresh-DB demo produces a genuine MP4 and plays it.
- Full tests/typecheck/lint/build pass; smoke suite result documented (or its absence explained).
- Backup recording and final evidence captured.
- Working tree contains only intentional changes; baseline commit intact.
