# ReadyForge — Roadmap

Canonical roadmap. The root-level `ROADMAP.md` is now a pointer to this file; root audit reports
(`FEATURE_AUDIT.md`, `UI_AUDIT.md`, `VERIFICATION_REPORT.md`) remain as historical snapshots —
this file and `IMPLEMENTATION_STATUS.md` are authoritative.

Status legend: **Implemented** = code exists · **Verified** = tested on 2026-10-28 ·
**In progress** = partial · **Planned** = designed, not started · **Blocked** = external dependency.

---

## Phase 1 — Functional MVP (target of this pass)

| # | Item | Status |
|---|---|---|
| 1 | Authentication, profiles, password reset, account deletion, data export | Verified |
| 2 | Workspaces, 10 roles, permission matrix, settings, archive/restore | Verified |
| 3 | **Invitation lifecycle with expiring, revocable links** | Verified |
| 4 | **Ownership transfer (offer → accept, exactly one owner)** | Verified |
| 5 | Projects, statuses, dashboard, members | Verified |
| 6 | Adaptive question engine + Knowledge Ledger | Verified |
| 7 | Consensus Graph, conflict detection, authority-aware resolution | Verified |
| 8 | Claim verification with evidence | Verified |
| 9 | Asset library + rights enforcement + expiry sentinel | Verified |
| 10 | Brand DNA + brand-fit checks (text only) | Verified |
| 11 | Readiness, Campaign Risk, Cost-at-Risk, Waste Receipt | Verified (unit + smoke) |
| 12 | Budgets and thresholds | Verified — **atomic hard-limit enforcement: Verified (P6)** |
| 13 | Versioned, approval-gated Production Contract + locking | Verified |
| 14 | Draft ladder + generation gating | Verified |
| 15 | Output verification + overrides | Verified |
| 16 | Reviews/approvals | Verified |
| 17 | Provenance Passport + JSON/PDF export | Verified |
| 18 | Notifications, comments, @mentions | Verified |
| 19 | Analytics (workspace/project/AI/team) | Verified |
| 20 | Admin + Judge Mode + guided checklist | Verified |
| 21 | **Server-side test suite (40 tests)** | Verified |
| 22 | **Six docs/ deliverables** | Verified |
| 23 | Email verification | **Blocked** — needs an email provider (`email.ts` boundary exists) |
| 24 | Project templates | **Planned** — next up (Priority 5) |
| 25 | Language / timezone preferences | **Planned** (Priority 4) |

### Phase 1 acceptance criteria (what "done" means)

- The MVP loop runs end to end with persisted data and no manual DB edits (smoke sections C→N).
- Unauthorized users cannot bypass any gate through direct API calls (smoke 401/403/404 assertions).
- A critical blocker (open critical conflict, unsupported critical claim, unlicensed asset, missing
  contract approval, insufficient budget) prevents final generation server-side.
- Warnings and blockers stay visually and structurally distinct; overrides require permission and a
  reason and are audited.
- `npm run verify`, `npm run test:server`, `node scripts/smoke.mjs` all pass.

---

## Phase 2 — Advanced intelligence (build after Phase 1 criteria hold)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Creative Taste profile (8 DNA groups), slider, overrides, reset | Verified | smoke U |
| 2 | Taste-based routing, variants, style exploration | Verified | smoke U |
| 3 | Learning from accept/edit/reject with confidence | In progress | observation capture exists |
| 4 | Claim Passport + claim-to-scene traceability | In progress | |
| 5 | Regeneration Autopsy, Decision Debt, Failure Pattern Library | Verified | smoke T |
| 6 | Model Trust Score + bargaining advice | Verified | computed from real runs |
| 7 | Reviewer load balancing, delay alerts | Implemented | advisory only |
| 8 | Campaign Lab: variants, audience simulation, forecast, fatigue, health | Implemented | labelled as estimates |
| 9 | Knowledge duplicate/similar detection, usage scoring | In progress | |
| 10 | Atomic budget reservations + concurrency tests | **Done — Priority 6** | `budget.test.ts` (10 tests, 6-way race) |
| 11 | Session list / revoke-all | Planned | |
| 12 | Asset folders, tags, favourites, licence documents | Planned | |
| 13 | Generation failure paths: cancellation, retry limits, idempotency, queue | **In progress — Priority 9** | no background queue exists |

**Security considerations for Phase 2:** taste learning must stay scoped (personal/workspace/project)
and must never override legal, rights, safety or budget blockers; simulations keep their "estimate"
labels; any new provider adapter needs the privacy review in `AI_PROVIDERS.md` §7.

---

## Phase 3 — Future roadmap (external dependencies)

| # | Item | Status | Blocked on |
|---|---|---|---|
| 51 | Real video generation | Planned | provider API + credits |
| 52 | Image-generation integration | Planned | provider API (renders simulated today) |
| 53 | Voice-generation integration | Planned | TTS API (voiceover is placeholder audio) |
| 54 | Campaign performance integrations | Blocked | ad/network APIs (needed for Fatigue Radar + loop) |
| 55 | Social-media publishing (YouTube/IG/LinkedIn/X/TikTok) | Blocked | OAuth apps |
| 56 | Ad-platform publishing (Meta/Google) | Blocked | partner access |
| 57 | Advanced localisation | Planned | translation provider; regional compliance tables |
| 58 | Enterprise SSO (SAML/OIDC) | Planned | identity provider |
| 59 | Billing, subscriptions, AI credits | Planned | payments provider |
| 60 | Marketplace (templates, assets, brand kits, voice packs) | Planned | billing + moderation |
| 61 | White-label agency mode | Planned | billing + theming |
| 62 | Mobile app | Planned | API is client-agnostic; needs a shell |
| 63 | Browser extension | Planned | publishing pipeline (55) |
| 64 | Figma / Canva integrations | Planned | partner API access |
| 65 | Slack / Teams integrations | Planned | OAuth apps; webhook infra |

Integrating a media provider means swapping the simulated step in `server/src/ai/generation.ts`;
contract gating, blockers, cost accounting and audit stay unchanged.

---

## Engineering priorities (in order)

- **P4** Email verification tokens + language/timezone preferences.
- **P5** Project templates (built-in + save-as-template + clone with membership isolation).
- **P6** Atomic budget enforcement (reservation ledger or conditional update) + concurrency tests.
  **Done** — conditional update in `server/src/services/budget.ts`; wired into generate + variant
  routes with refund-on-failure; `budget.test.ts` proves no overspend under concurrent charges.
- **P7** Configuration/startup: fail fast on missing JWT secrets in production; `.env.example`; keep
  dev fallbacks out of production; document MongoDB/transaction requirements.
  **Done** — `config.ts` throws in production without `JWT_*` (`config.test.ts`), production
  memory-DB fallback warns, `.env.example` exists, MongoDB/transaction requirements documented.
- **P8** Refactor: shared response serializers (the class of bug that caused `Invalid id format`),
  split `routes/generation.ts` and `routes/intelligence.ts`, trim overlapping root reports.
- **P9** Generation failure paths: cancellation, duplicate-retry protection, idempotent status
  updates, provider-timeout errors, safe temp-asset cleanup — or document as unsupported.

## Explicit non-goals

- No invented facts: claim verification stays evidence-based even after media generation lands.
- Rights and legal checks remain heuristics with visible "not legal advice" disclaimers.
- AI-generated content is always labelled; a human approves before publish.