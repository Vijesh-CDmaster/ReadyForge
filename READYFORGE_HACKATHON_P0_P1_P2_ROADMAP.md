# ReadyForge — Hackathon P0/P1/P2/P3 Roadmap

**Date:** 2026-10-30
**Companion documents:** `READYFORGE_EXHAUSTIVE_FEATURE_GAP_ANALYSIS.md`, `READYFORGE_FEATURE_COMPLETENESS_MATRIX.md`, `READYFORGE_HACKATHON_BUILD_SEQUENCE.md`.
**Rule:** this is a plan, not an implementation. Nothing below has been built yet except the AI-service runtime check noted in P0-4.

## Prioritization rules

- **P0** — without it the judged story breaks, misleads, or cannot be reproduced reliably.
- **P1** — closes a visible correctness/security/UX gap with low regression risk and ≤1.5 h each.
- **P2** — valuable, but requires renderer/schema/architecture work; post-submission.
- **P3** — roadmap; not part of this submission.
- **Freeze rule:** no P2 work starts today; P1 stops 2 hours before submission.

---

## P0 — must ship before submission

| ID | Module | Change | Why now | Files likely affected | Acceptance criteria | Effort | Risk | Depends on |
|---|---|---|---|---|---|---|---|---|
| **P0-1** | Cost-at-risk | Index the stage-cost table by `project.currentStage`, not `project.projectType`; keep a safe fallback | The waste receipt is a headline demo metric and currently ignores stage | `server/src/engines/costAtRisk.ts`, `server/src/__tests__/engines.test.ts` | Unit test proves `final` planned cost > `preview` > `script` for the same project; all 211 server tests pass; `/projects/:id/cost-at-risk` changes when stage changes | 0.3 h | Low | none |
| **P0-2** | Demo data | Add an idempotent **Studio Demo** project to the normal seed: two locally generated short MP4s + an audible tone, licensed assets, approved inputs, locked contract, passing readiness, and a composition with transition + animated title + audio fades | A fresh clone currently has no video asset/composition, and the campaign demo is intentionally render-blocked. Judges cannot reach the strongest feature | `server/src/seed.ts` (or new `demoStudio.ts` + `demoPipeline.ts`), `scripts/setup-ui-verification.ts` (reuse logic), `server/seed-selftest.ts`, docs | On a **fresh** DB: login → Studio Demo → editor shows video clips + text + audio → Render succeeds → output plays. Readiness authorized. Running seed twice does not duplicate project/assets. Seed still succeeds when FFmpeg is unavailable (logs a clear warning and skips media instead of crashing) | 3–4 h | Medium | P0-1 not required; FFmpeg binary available |
| **P0-3** | Documentation | Rewrite the video section of `README.md`: add editor/render capabilities, correct the stale "MP4 generation not implemented" claim, add a 5-step editor demo, and state explicitly that rendering is local/free while Runway is optional/paid | The repo's front door currently omits and contradicts the best capability | `README.md`, `.env.example` comments if needed | A reader sees "multi-track editor + local FFmpeg MP4" before setup; no statement contradicts implemented behaviour; demo steps name the Studio Demo project | 0.5 h | None | P0-2 (project name) |
| **P0-4** | AI runtime | Start the local AI service (already verified startable) and include the exact command + env expectations in the runbook; verify one app generation returns `source: ai` | Without it, every AI action is labelled rule engine, weakening the AI story. It is running now and answered a chat completion | No code; `README.md`/runbook, optional root script | `GET :8001/health` 200; one `/v1/chat/completions` success; one app generation reports AI source (or the team consciously demos fallback) | 0.25 h | Low | cached models (present) |
| **P0-5** | Process | Full demo rehearsal on a fresh database + freeze; capture a backup screen recording of the render | Live demos fail on environment drift, not code | none | Fresh-DB run of W1→W5 completes; render appears in ≤60 s for the demo composition; backup video exists; no edits after freeze | 1 h | Low | P0-1…P0-4 |

**P0 total:** ~5–6.5 focused hours, dominated by the demo seed.

### P0 acceptance test (run once, from a clean state)

```bash
# 1. Fresh database (move/rename server/.data/mongo with the API stopped; do not delete user data without a backup)
# 2. Start API + web with FFmpeg paths configured
npm run dev
# 3. Confirm
curl -s localhost:4000/api/health
curl -s localhost:4000/api/ready
curl -s localhost:8001/health
# 4. Login demo@readyforge.ai / demo1234, open "Studio Demo — Launch Spot"
# 5. Editor: 2+ video clips, 1 text clip with animation, 1 audio clip with fades
# 6. Save → Render → output plays; status succeeded; duration/size plausible
# 7. Re-run `npm run seed` → no duplicate Studio Demo, no duplicate assets
```

---

## P1 — high value, safe, quick (in this order)

| ID | Module | Change | Why | Acceptance criteria | Effort | Risk |
|---|---|---|---|---|---|---|
| **P1-1** | Project deletion | Extend `DELETE /projects/:id` to compositions, tasks, reports, reviews, comments, notifications, reservations, AI logs, variants; unlink uploaded files safely | Orphaned data and retained files after "delete" | Integration test: create project with each dependent doc + file, delete, assert zero rows and file gone; full suite green | 1 h | Low–Medium |
| **P1-2** | Job idempotency | Include `compositionRevision` (and project id) in `fingerprintJob` | Defense-in-depth against stale replays; cheap | New test: same key + different revision → 409; same key + same revision → duplicate | 0.25 h | Low |
| **P1-3** | Editor UX | `beforeunload` guard while dirty + in-app navigation warning | Prevents losing a built timeline during judging | Dirty editor triggers browser prompt; clean editor does not; component test asserts handler registration | 0.5 h | Low |
| **P1-4** | Editor UX | Inline track rename in the timeline header (server already accepts `name`) | Visible incompleteness in a professional editor; cheap | Rename persists across save/reload; locked track blocks rename with message; component test | 1 h | Low |
| **P1-5** | Render security | Per-user/IP rate limit on `POST /projects/:id/renders` (e.g., 6/min) | CPU abuse; security reviewers check this | 7th rapid request → 429 with clear message; normal render unaffected | 0.5 h | Low |
| **P1-6** | Ops | `scripts/preflight.mjs`: check API/DB/AI/FFmpeg tools/Studio Demo/disk, print pass/fail + URLs | One command replaces demo-day guesswork | Exit 0 when all green; actionable failures; documented in README | 1 h | Low |
| **P1-7** | Demo/UX | One-line editor note: preview approximates fonts/transition motion; final MP4 is authoritative | Prevents "preview ≠ output" confusion | Note visible near preview/inspector; docs cross-link | 0.2 h | None |
| **P1-8** | Docs | Correct readiness docs (7 categories, weights) and inventory references | Removes a visible documentation error | Docs match code | 0.2 h | None |
| **P1-9** | Tests | Extend `server/seed-selftest.ts` to assert Studio Demo shape and idempotency | Protects P0-2 from silent breakage | Self-test fails if composition/assets/contract missing | 0.5 h | Low |
| **P1-10** | Editor UX (optional) | Track reorder via up/down controls (unique `order` already validated) | Compositing order is otherwise fixed at creation | Reorder persists and changes render stacking; component test | 2 h | Low–Medium |

**P1 total:** ~5–6 hours if all ten are attempted; recommended subset for today: P1-1…P1-5, P1-7, P1-8 (≈3.5 h).

---

## P2 — after the hackathon

| ID | Module | Change | Reason to defer | Effort |
|---|---|---|---|---|
| P2-1 | Assets | Magic-byte validation for uploads | Medium false-reject risk; not demo-visible | 3–4 h |
| P2-2 | Assets | Video poster/thumbnail generation | Polish | 2 h |
| P2-3 | Editor | Cross-track clip drag | Touches drag/validation UX; regression risk | 4–6 h |
| P2-4 | Editor | Keyboard shortcuts / copy-paste / ripple delete | Nice-to-have; interacts with inputs and undo | 3–4 h |
| P2-5 | Editor | Image/logo overlays and image clips | Requires renderer inputs, schema, UI | 1–2 d |
| P2-6 | Audio | Browser audio monitoring with fades/volume | Web Audio complexity, autoplay policies | 2–3 d |
| P2-7 | Text | Animation region visualisation | Polish | 2 h |
| P2-8 | Renderer | Configurable presets (720p/1080p/vertical) | Parameterising the graph is medium risk | 1–2 d |
| P2-9 | Renderer | Total-duration guard | Safety; demo is short | 0.5 h |
| P2-10 | Jobs | Stale temp-dir sweeper | Ops hygiene | 1 h |
| P2-11 | Jobs | Durable queue / external worker | Architecture change | 3+ d |
| P2-12 | API | Restrict failure-mode video jobs to non-production | Harness cleanup | 0.5 h |
| P2-13 | Governance | Inline readiness blockers beside Render | UX improvement | 2 h |
| P2-14 | Ops | CI (typecheck/lint/test/build) | Valuable but not judged | 2 h |
| P2-15 | Ops | Docker/compose + FFmpeg image | Deployment polish | 4 h |
| P2-16 | Test | Playwright browser E2E | Long-term safety | 1–2 d |
| P2-17 | Security | Upload sniffing + session revocation/MFA | Post-hackathon hardening | days |

---

## P3 — product roadmap

- Email provider integration (verification, invites, digests).
- Session management/revocation, MFA, SSO.
- Workspace-level spend caps and approvals.
- Real social/ad/publishing integrations and performance feedback.
- Billing/subscriptions.
- GPU encoding, distributed rendering, object storage/CDN.
- Composition version history/restore, multi-user presence/collaboration.
- Custom font asset registry with security review.
- Semantic knowledge search/embeddings.
- OpenAPI spec, webhooks, public API.

---

## Explicitly do NOT build before submission

1. No renderer filter-graph rewrites (image overlays, presets, speed/crop).
2. No new database migrations or schema redesign.
3. No auth/session/MFA changes.
4. No new paid providers or cloud services.
5. No editor gesture rework (cross-track drag, keyboard shortcuts).
6. No email provider integration.
7. No framework/state-management changes.
8. No bulk formatting/refactors; no dependency upgrades.
9. No unrequested feature additions to governance/intelligence.
10. No Git reset/rebase/clean; preserve commit `fdcc49f` and the working artifacts.

---

## Time-boxed variants

### If only 3 hours remain
1. P0-1 cost fix (0.3 h).
2. P0-4 AI service (0.25 h, already running).
3. P0-3 README truth (0.5 h).
4. Demo fallback: use the existing **UI Verification · Local Render** project (locked contract, authorized, 3 tracks/4 clips) and pre-record the render. Do **not** attempt the seed.
5. Rehearse (0.5 h), freeze.

### If 6 hours remain
P0-1, P0-2 (full Studio Demo seed), P0-3, P0-4, P1-1, P1-2, P1-3, P1-5, P1-7, P1-8, rehearsal.

### If a full day remains
All P0 + P1 (including track rename/reorder), plus P2-9 duration guard and P2-12 harness gate if P0/P1 are green.

---

## Success definition

The submission is successful when a fresh clone can run three commands, log in with the documented demo account, and within five minutes:
1. show the campaign governance story (conflict → readiness → locked contract);
2. open a populated multi-track editor and change a title/transition;
3. render a genuine MP4 locally and play it;
4. show the verification/provenance trail and the budget/authorization guarantees.

No P2/P3 item is required for that definition.
