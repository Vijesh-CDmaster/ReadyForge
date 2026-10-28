# ReadyForge — Implementation Status

Feature-by-feature status for the ReadyForge specification (27 sections, 3 phases).

**Verification date:** 2026-10-28 · **Verified by:** `npm run verify` (exit 0), `npm run test:server` (63/63), `node scripts/smoke.mjs` (199/199), plus a browser walk-through of the invitation flow.

**Status vocabulary (exactly these five):**

| Status | Meaning |
|---|---|
| **Not started** | No code exists. |
| **In progress** | Partial implementation; remaining work named. |
| **Implemented** | Code exists and is wired end to end, but not yet covered by an automated acceptance test. |
| **Verified** | An acceptance test or reproducible workflow passed on the verification date. |
| **Blocked** | An external dependency prevents completion; named explicitly. |

---

## Phase 1 — Functional MVP

### 1. User account and authentication

| Feature | Status | Evidence / tests |
|---|---|---|
| Register, login, logout, protected routes | Verified | smoke B (duplicate → 409, wrong password → generic 401, validation → 400); `auth.test.ts` (401 on missing/malformed token, deleted-user token rejected) |
| Password hashing (bcrypt, cost 10) | Verified | `auth.test.ts` — plaintext never stored, verify true/false |
| JWT access + refresh rotation, refresh cookie | Verified | smoke B; refresh rotates on `/auth/logout` and `/auth/refresh` |
| Forgot / reset password (single-use, 30 min) | Verified | smoke P — reset works, old password rejected after reset |
| Change password / update profile | Verified | smoke Q (`PATCH /auth/me`) |
| Account deletion (password-confirmed) | Verified | smoke Y — deleted account can no longer log in; re-checked manually this pass |
| Data export ("Export my data") | Verified | smoke Q — profile/workspaces/inputs/reviews/notifications, no password material |
| Session management (list / revoke-all UI) | In progress | refresh rotation exists; no session list endpoint/UI |
| Email verification | In progress | `isVerified` flag exists; token flow + provider pending (see §24) |

### 2. Workspace management

| Feature | Status | Evidence / tests |
|---|---|---|
| Create / edit / delete workspace | Verified | smoke C (create returns `id`, detail resolves — regression guard for the former `Invalid id format` bug) |
| Archive / restore | Verified | smoke R |
| Workspace switcher, settings (currency, AI providers, budget threshold) | Verified | smoke C; SettingsPage bound to `PATCH /workspaces/:id` |
| **Invitation lifecycle (invite, list, resend, cancel, accept, reject, expiry)** | Verified | `invitations.test.ts` (12 tests incl. duplicate 409, token rotation, expiry, concurrent accept → single membership); live API run 31/31; browser accept flow confirmed (member count 1→2) |
| Invitation links (hashed token, 7-day TTL, dev-only link exposure) | Verified | `WorkspaceInvitation` model — only SHA-256 stored; token never persisted or logged |
| **Ownership transfer (offer → accept, exactly one owner)** | Verified | `ownership.test.ts` (8 tests incl. concurrent accept → one owner, expiry, non-target 403); Workspace schema now `optimisticConcurrency: true` |
| Last-owner protection | Verified | owner cannot be removed or demoted (`workspaces.ts` guards); transfer demotes previous owner in the same atomic write |
| Roles (10, incl. SME/legal/finance/marketing) | Verified | `WORKSPACE_ROLES` + smoke D role-based 403s |
| Permission matrix (server-side `requireRole`) | Verified | `auth.test.ts` role-check tests; smoke D/E/J/M 403s |
| Member activity history | In progress | audit log exists per member action; no member-scoped activity view |

### 3. Project management

| Feature | Status | Evidence / tests |
|---|---|---|
| Create solo/team project, all fields | Verified | smoke E |
| Status transitions (11) | Verified | smoke E/K (illegal stage skip → 409) |
| Project dashboard, readiness, timeline | Verified | smoke I; ProjectOverview |
| Project members + project-scoped permissions | Verified | smoke E |
| Project templates / save-as-template / create-from-template | Verified | `ProjectTemplate` model + `/api/workspaces/:id/templates` routes + CreateProject template picker; `templates.test.ts` (9 tests: built-in slugs, tenant isolation, save-as, fill rule) |

### 4. AI-guided input collection

| Feature | Status | Evidence / tests |
|---|---|---|
| Adaptive question generation, required/optional, explanations | Verified | smoke W-ai (questions carry explanation + required flags) |
| Input CRUD, types, approval/rejection/dispute lifecycle | Verified | smoke F (invalid type → 400) |
| Role assignment, per-member pending questions | Implemented | inputs routes expose assignee; no dedicated per-member dashboard |
| Draft/resume questionnaire | Not started | — |

### 5. Knowledge Ledger

| Feature | Status | Evidence / tests |
|---|---|---|
| Approved/rejected/disputed facts, sources, contributors | Verified | smoke F |
| Expiry, decay, renewal alerts | Verified | smoke T-intelligence (knowledge decay endpoint) |
| Duplicate/similar-input detection | In progress | similarity surfaced in intelligence routes; no embedding search |
| Vector/semantic retrieval | Not started | would require an embedding store; text search baseline only |

### 6. Consensus Graph and conflict resolution

| Feature | Status | Evidence / tests |
|---|---|---|
| Conflict detection (direct/pricing/tone/brand/legal) | Verified | smoke G; `ai/conflicts.ts` with rule-engine + AI sources |
| Authority-aware resolution, severity, escalation | Verified | smoke G (resolution written back, role checks) |
| Graph nodes/relationships API + visual graph | Implemented | intelligence routes + ConflictRoom UI; no dedicated graph unit tests |
| Decision Debt Tracker / Decision Replay / Failure Pattern Library | Verified | smoke T-intelligence (`/failure-patterns`, decision endpoints) |

### 7. Fact and claim verification

| Feature | Status | Evidence / tests |
|---|---|---|
| Claim extraction + verification vs approved facts | Verified | smoke W-ai (RAG-style check vs approved facts), smoke L |
| Statuses, evidence, citation, override with reason | Verified | smoke L (override endpoint, suggested fixes) |
| Claim Passport / claim-to-scene traceability | In progress | claims recorded on scenes; no dedicated passport export view |

### 8. Asset library and rights

| Feature | Status | Evidence / tests |
|---|---|---|
| Upload, metadata, MIME/signature validation | Verified | smoke H |
| Licence states, rights blocking final render | Verified | smoke H + readiness unit test (`unlicensed_asset` blocker) |
| Rights Expiry Sentinel (30-day window) | Verified | smoke T-intelligence |
| Folders, tags, favourites, licence-document upload | Not started | named in ROADMAP "known engineering gaps" |

### 9. Brand governance

| Feature | Status | Evidence / tests |
|---|---|---|
| Brand DNA card (tone, banned words, palette, logo rules) | Verified | smoke C (brandDna persisted on workspace) |
| Brand-fit scoring, banned-word detection | Implemented | verify engine; text-only — no image/colour/typography analysis is claimed |

### 10–11. Readiness, risk, Cost-at-Risk, Waste Receipt, budgets

| Feature | Status | Evidence / tests |
|---|---|---|
| Readiness score 0–100 with 8 weighted categories | Verified | `engines.test.ts` (weights sum to 100, blockers, bounds) + smoke I |
| Campaign Risk Score + bands | Verified | `engines.test.ts` (band table, factor caps) |
| Cost-at-Risk + Waste Receipt formula | Verified | `engines.test.ts` (waste = cost × probability; after-fixes ≤ if-render-now) |
| Project/workspace budgets, thresholds | Verified | smoke J + costAtRisk engine tests |
| **Atomic budget hard limits under concurrency** | Verified | `services/budget.ts` conditional update + `budget.test.ts` (10 tests incl. a 6-way simultaneous-charge race: only 3 of 6 fit) |
| Cost Ceiling Negotiator (cheaper-model/shorter/fewer-variants advice) | In progress | routing advice exists in taste/intelligence; no dedicated negotiator endpoint |

### 12. Production Contract

| Feature | Status | Evidence / tests |
|---|---|---|
| Generation, approval, rejection, locking | Verified | smoke J (viewer approve → 403, generation requires approved contract) |
| Versioning, version history, diff, supersede | Verified | smoke S (contract versions) |
| Backend enforcement of the lock | Verified | generation route blocks rungs unless contract approved/locked (server-side) |

### 13. Draft Ladder

| Feature | Status | Evidence / tests |
|---|---|---|
| 7 stages, gating, approvals, statuses | Verified | smoke K (stage skip → 409, per-rung blockers) |
| Generation job lifecycle (queued/running/completed/failed/cancelled) | In progress | statuses modelled; no background queue — cancellation/retry limits partially covered (Priority 9) |

### 14. Multi-model AI routing

| Feature | Status | Evidence / tests |
|---|---|---|
| Provider/model registry, enable/disable, pricing | Implemented | `ai/client.ts`, config, intelligence model registry |
| Model Trust Score, cost/latency/acceptance stats | Verified | smoke T-intelligence (trust score computed from persisted runs) |
| Live LLM calls | Blocked | configured provider `127.0.0.1:8001` was **unreachable** on the verification date; `aiJson` falls back to the deterministic rule engine and labels `source: 'rule_engine'` honestly |

### 15–16. Output verification, review and approval

| Feature | Status | Evidence / tests |
|---|---|---|
| Verification report (checks, severity, evidence, fixes) | Verified | smoke L |
| Review assignment, approve/reject/regenerate with notes | Verified | smoke M (regeneration without notes → 409, unauthorised reviewer → 403) |
| Override preserves original finding | Verified | smoke L override path |

### 17. Provenance

| Feature | Status | Evidence / tests |
|---|---|---|
| Provenance Passport + JSON/PDF export | Verified | smoke N (both exports 200) |
| Decision replay, contributor split | Verified | smoke N/T |

### 18–19. Creative Taste and personalisation

| Feature | Status | Evidence / tests |
|---|---|---|
| Taste profile (visual/motion/rhythm/sound/typography/story/workflow/model) | Verified | smoke U (create, load, reset) |
| Taste slider, remember/forget, project overrides, taste-based routing + variants | Verified | smoke U (project-level override, routing advice, variants, reset) |
| Learning from accept/edit/reject with confidence decay | In progress | observation capture exists; full confidence model partial |

### 20–21. Campaign intelligence and analytics

| Feature | Status | Evidence / tests |
|---|---|---|
| Creative variants, audience simulation, pre-flight forecast, fatigue, health | Implemented | CampaignLabPage + engines; simulations are labelled estimates |
| Workspace/project/AI/team analytics | Verified | smoke O (analytics workspace-isolated → 403 cross-tenant) |
| Performance-to-production loop | Blocked | needs ad/publishing integrations (ROADMAP 54–56) |

### 22. Notifications and communication

| Feature | Status | Evidence / tests |
|---|---|---|
| Persistent notifications, unread, mark-read, preferences | Verified | smoke O; server honours `wantsNotification` prefs |
| Comments, replies, @mentions → notification | Verified | smoke V (mention raises notification, non-author delete → 4xx) |
| Email notifications / digests | Blocked | no email provider (see §24) |

### 23. Accessibility and localisation

| Feature | Status | Evidence / tests |
|---|---|---|
| Keyboard, focus, ARIA, reduced motion, contrast | Verified | `ui.a11y.test.ts` (8 assertions) + Modal focus trapping |
| Language and timezone preferences | Verified | `User.language`/`User.timezone` persisted via `PATCH /api/auth/me`, validated by Zod (IANA timezone check), edited in ProfilePage; surfaced in `publicUser` |

### 24. Security, privacy, responsible AI

| Feature | Status | Evidence / tests |
|---|---|---|
| Helmet headers, CORS allow-list, rate limits (auth, AI, invitations) | Verified | smoke A/X (401/403s), `index.ts` middleware |
| Tenant isolation (workspace + project) | Verified | smoke C/E/O cross-tenant 403/404; `auth.test.ts` |
| Account deletion, data export | Verified | smoke Y/Q |
| Audit trail for governance actions | Verified | smoke Y (audit captured the whole session) |
| Email verification | Implemented — delivery blocked | token issue/verify endpoints + `VerifyEmailPage` verified; actual delivery requires an email provider (boundary in `email.ts` reports `delivered:false`, dev surfaces the link in-app) |
| CSRF tokens | Implemented as N/A | bearer-token auth in `Authorization` header (not cookie-authenticated API calls); refresh cookie is `SameSite`-scoped — documented in SECURITY.md |

### 25–27. Integrations, administration, demo

| Feature | Status | Evidence / tests |
|---|---|---|
| Export (script, contract, verification, provenance JSON/PDF, data) | Verified | smoke N/Q |
| Admin dashboard + stats + admin-only denial | Verified | smoke X (403/401 for normal users) |
| Judge Mode + demo data | Verified | smoke T (`/judge-mode` → 200/201) |
| Guided tour (live-state checklist) | Verified | GettingStarted reads real project state |
| Publishing/social/ads/billing/SSO/marketplace | Not started | ROADMAP.md (Phase 3) |

---

## Test coverage summary (verification date)

| Suite | Command | Result |
|---|---|---|
| Server unit + integration | `npm run test:server` | **63/63 passed** (7 files: engines, config, budget, auth, templates, ownership, invitations) |
| Client component tests | `npm test` (part of `npm run verify`) | **18/18 passed** (4 files) |
| End-to-end API smoke | `node scripts/smoke.mjs` | **199/199 passed** (25 sections A–Y) |
| Static checks + build | `npm run verify` | exit 0 (server + client typecheck, ESLint 0 errors, production build) |
| Live invitation API walk-through | ad-hoc script against `localhost:4000` | 31/31 passed |
| Browser walk-through | manual (Vite dev server) | register validation, duplicate 409, logout, protected-route redirect, invitation create → link → accept verified |

**Not covered by automated tests yet:** contract versioning internals, conflict-detection engine unit tests, generation failure paths at the HTTP layer (the budget refund path is unit-tested), email flows (no provider).

---

## Known defects fixed this pass

1. **Concurrent ownership transfers could both succeed** — Mongoose optimistic concurrency is off by default, so a racing second `save()` silently overwrote the first. Fixed by enabling `optimisticConcurrency: true` on the Workspace schema and mapping `VersionError` → HTTP 409. Regression test: `ownership.test.ts` "concurrent accepts never produce two owners".
2. **False audit entry** — `FEATURE_AUDIT.md` claimed project templates were "built this round" while no template code existed. Row corrected to *Not started*, and templates were subsequently implemented and covered by `templates.test.ts` (row now *Verified*).
3. **Budget could be overspent under concurrency** — both `POST /projects/:id/generate` and `POST /projects/:id/variants` charged the budget with a read-then-write, so two racing requests could both pass the check; the variant route additionally had no hard-limit check at all. Fixed with an atomic conditional update (`services/budget.ts`) plus refund-on-failure; regression test `budget.test.ts` "never overspends under concurrent charges".
4. **Production could boot with development JWT secrets** — `config.ts` silently fell back to `dev-access-secret`/`dev-refresh-secret` under `NODE_ENV=production`. Now fails fast at import; regression test `config.test.ts`.