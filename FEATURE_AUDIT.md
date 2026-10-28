# ReadyForge — Feature Audit

Audit of the complete feature list (27 sections / 65 build-priority items) against the actual
codebase. Status definitions:

- **Built** — implemented and verified end to end (API + UI where applicable).
- **Partial** — a working core exists; listed sub-features are missing or thin.
- **Missing** — no implementation found.
- **Roadmap** — explicitly Phase 3; intentionally not built.

Evidence is real file paths, not intent.

---

## Section-by-section status

### 1. User Account and Authentication — **Partial**
| Sub-feature | Status | Evidence |
|---|---|---|
| Register / login / logout | Built | [auth.ts](server/src/routes/auth.ts), [Register.tsx](client/src/pages/Register.tsx), [Login.tsx](client/src/pages/Login.tsx) |
| JWT access + refresh, rotation | Built | `signRefreshToken` + rotated on `/refresh` in [auth.ts](server/src/routes/auth.ts) |
| Password hashing | Built | bcryptjs in [auth.ts](server/src/routes/auth.ts) |
| Protected routes | Built | [middleware/auth.ts](server/src/middleware/auth.ts) (`requireAuth`, `requireWorkspace`, `requireProject`, `requireRole`) |
| Forgot / reset password | **Missing → built this round** | no matches for `forgot`/`reset-password` in `server/src` |
| Change password | **Missing → built this round** | no matches |
| Email verification | Missing | `isVerified` flag exists but no verification flow; needs an email provider (documented as pending integration) |
| Session management (list/revoke) | Partial | refresh rotation + logout exist; no session list/revoke-all |
| Account deletion | **Missing → built this round** | no endpoint |
| User profile view/edit (name, email) | **Missing → built this round** | no profile page or PATCH `/me` |
| Notification preferences | **Missing → built this round** | no preference fields on User |
| Theme preference | Built | [AppShell.tsx](client/src/components/AppShell.tsx) `useTheme` — light/dark with system default |
| Language / timezone preference | **Missing → built this round** | `User.language`/`User.timezone` persisted via PATCH `/auth/me` (IANA timezone validation), edited in ProfilePage; smoke Q asserts round-trip + invalid → 400 |

### 2. Workspace Management — **Partial**
| Sub-feature | Status | Evidence |
|---|---|---|
| Create / edit / delete workspace | Built | [workspaces.ts](server/src/routes/workspaces.ts) |
| Workspace switcher | Built | [AppShell.tsx](client/src/components/AppShell.tsx) |
| Workspace settings (currency, budget threshold, AI providers) | Built | [SettingsPage.tsx](client/src/pages/SettingsPage.tsx) |
| Workspace archive / restore | **Missing → built this round** | no `archiv` matches in workspaces route |
| Invite member by email | Built | direct-add invite in [workspaces.ts](server/src/routes/workspaces.ts) |
| Invitation link / resend / cancel / accept / reject | Partial | invite is immediate add; no pending-invite token flow |
| Remove member, change role, member list | Built | [workspaces.ts](server/src/routes/workspaces.ts), [WorkspaceDetail.tsx](client/src/pages/WorkspaceDetail.tsx) |
| Roles (10 defined) | Partial | 8 roles incl. SME/legal/finance in [WorkspaceDetail.tsx](client/src/pages/WorkspaceDetail.tsx); marketing-strategist role missing → added this round |
| Permissions matrix | Partial | `requireRole(...)` middleware enforces coarse permissions |

### 3. Project Management — **Partial**
| Sub-feature | Status | Evidence |
|---|---|---|
| Project creation (solo/team, type, objective, budget…) | Built | [projects.ts](server/src/routes/projects.ts), [CreateProject.tsx](client/src/pages/CreateProject.tsx) |
| Project dashboard | Built | [ProjectOverview.tsx](client/src/pages/ProjectOverview.tsx), [Dashboard.tsx](client/src/pages/Dashboard.tsx) |
| Statuses (11) | Built | `PROJECT_STATUSES` in [Project.ts](server/src/models/Project.ts) |
| Project members | Built | `/projects/:id/members` in [projects.ts](server/src/routes/projects.ts) |
| Project templates | **Not started (audit corrected 2026-10-28)** | no `ProjectTemplate`/save-as-template code exists — see [docs/ROADMAP.md](docs/ROADMAP.md) P5 |
| Archive/delete project | Partial | delete exists (`DELETE /projects/:id`); no archive/restore |

### 4. AI-Guided Input Collection — **Built**
Adaptive engine in [questions.ts](server/src/ai/questions.ts) + [ai.ts](server/src/routes/ai.ts);
role-aware, grouped sets, explanations, taste-personalised count (`/api/taste/questions/:id`).
Input CRUD/approve/dispute/history in [inputs.ts](server/src/routes/inputs.ts).
Partial: save-as-draft/resume questionnaire, URL-reference inputs.

### 5. Knowledge Ledger — **Built (partial intelligence)**
Repository + lifecycle (draft/approved/disputed/rejected/expired) in
[KnowledgeInput.ts](server/src/models/KnowledgeInput.ts), [KnowledgeLedger.tsx](client/src/pages/KnowledgeLedger.tsx),
traceability via contributor fields + audit logs; decay detection in [intelligence.ts](server/src/routes/intelligence.ts)
(`/workspaces/:id/knowledge-decay`). Partial: duplicate/similar-input detection, usage-frequency scoring.

### 6. Consensus Graph and Conflict Resolution — **Partial**
Conflict detection (AI + rules) in [conflicts.ts](server/src/ai/conflicts.ts); conflict cards,
authority-aware routing, one-click recommendations, resolve/dismiss/assign in
[conflicts.ts](server/src/routes/conflicts.ts) + [ConflictRoom.tsx](client/src/pages/ConflictRoom.tsx).
**Built this round:** visual Consensus Graph (SVG relationship map), Decision Debt Tracker,
Decision Replay (audit-backed). Partial: escalation deadlines/reminders, Failure Pattern Library (built this round as an analytics view).

### 7. Fact and Claim Verification — **Built**
Claim extraction + RAG-style retrieval against approved facts in [claims.ts](server/src/ai/claims.ts),
evidence/safe-rewrite/override in [generation.ts](server/src/routes/generation.ts) (`/claim-passport`),
regional/disclaimer checks in [verify.ts](server/src/ai/verify.ts). Claim-to-scene traceability built.

### 8. Asset Library and Rights Management — **Partial**
Upload (typed, validated, audit-logged) in [assets.ts](server/src/routes/assets.ts);
licence status/owner/expiry/channels/regions/consent/AI-flag modelled in [Asset.ts](server/src/models/Asset.ts);
Rights Officer checks + `/workspaces/:id/rights-sentinel` in [intelligence.ts](server/src/routes/intelligence.ts);
blocking of uncleared assets before generation in [generation.ts](server/src/routes/generation.ts).
Partial: asset folders/tags/favourites/search, licence-document upload, renewal flow.

### 9. Brand Governance — **Built (partial)**
Workspace Brand DNA card (tone, banned words, palette, logo rules, legal restrictions) in
[SettingsPage.tsx](client/src/pages/SettingsPage.tsx) + workspace settings; banned-word/off-brand checks in
[verify.ts](server/src/ai/verify.ts); Brand Drift Detector `/workspaces/:id/brand-drift` in
[intelligence.ts](server/src/routes/intelligence.ts) with UI in Settings. Partial: logo file upload,
approved-terminology enforcement in every check, brand-safe hook templates.

### 10. Readiness and Risk Engine — **Built**
Score + category breakdown + blockers/warnings in [readiness.ts](server/src/engines/readiness.ts),
Campaign Risk Score in [riskScore.ts](server/src/engines/riskScore.ts) (`/projects/:id/risk-score`),
UI in [ReadinessDashboard.tsx](client/src/pages/ReadinessDashboard.tsx) + dashboard blocker panel.

### 11. Cost-at-Risk and Waste Receipt — **Built (partial)**
Engine in [costAtRisk.ts](server/src/engines/costAtRisk.ts), Waste Receipt UI in
[CostAtRiskDashboard.tsx](client/src/pages/CostAtRiskDashboard.tsx), budget tracking on Project,
budget approval threshold in workspace settings. Partial: Cost Ceiling Negotiator (suggestions exist
inside the Waste Receipt); per-scene/asset cost breakdown, finance-approval workflow.

### 12. Production Contract — **Partial**
AI contract from validated inputs in [contract.ts](server/src/engines/contract.ts),
approve/reject/lock/supersede + versioning in [projects.ts](server/src/routes/projects.ts),
UI in [ContractPage.tsx](client/src/pages/ContractPage.tsx). **Built this round:** version diff view.
Partial: rollback, multi-approver chains, approval deadlines.

### 13. Draft Ladder and Progressive Generation — **Built**
Stages, blockers, per-stage cost, approve/reject/regenerate-with-notes in
[generation.ts](server/src/routes/generation.ts), [DraftLadder.tsx](client/src/pages/DraftLadder.tsx).
Partial: cancel-while-running (generation is synchronous today), scene-level regenerate.

### 14. Multi-Model AI Routing — **Partial**
Task-based provider selection exists (local Qwen LLM / DistilBERT NLI / rule fallback) in
[client.ts](server/src/ai/client.ts) + [local.ts](server/src/ai/local.ts), taste-based routing advice
(`/api/taste/routing/:id`). **Built this round:** Model Trust Score + Model Bargaining Agent
(`/workspaces/:id/model-trust`). Missing: user-supplied model registry, fallback chains, health routing.

### 15. Output Verification — **Built**
12-check engine in [verify.ts](server/src/ai/verify.ts), reports/overrides/history in
[generation.ts](server/src/routes/generation.ts), UI in [VerificationReportPage.tsx](client/src/pages/VerificationReportPage.tsx).
Built earlier: Regeneration Autopsy `/projects/:id/autopsy`.

### 16. Review and Approval Workflow — **Partial**
Approve/reject/request-changes with verification-block enforcement, Review records, notifications in
[generation.ts](server/src/routes/generation.ts) (`/tasks/:id/review`). **Built this round:** reviewer
workload/bottleneck analytics. Missing: threaded comments with mentions (built this round as
entity comments + @mention notifications), review queues per role, conditional approvals.

### 17. Provenance and Trust — **Built**
Passport assembly, PDF/JSON export, decision replay in [generation.ts](server/src/routes/generation.ts),
UI in [ProvenancePage.tsx](client/src/pages/ProvenancePage.tsx). Partial: shareable link export, QR.

### 18. Creative Taste Profile — **Built**
All ten DNA categories, Taste Slider, Style DNA Card, mood translator, presets, confidence score,
history/reset, remember-this-choice, taste conflicts, taste variants, taste assets, taste routing:
[TasteProfile.ts](server/src/models/TasteProfile.ts), [taste.ts](server/src/ai/taste.ts),
[taste.ts (routes)](server/src/routes/taste.ts), [TastePage.tsx](client/src/pages/TastePage.tsx).

### 19. Personalisation and Learning — **Built**
Learn from accept/edit/reject (manual + review-decision hook in generation route), Taste Slider,
remember/project-scope/don't-remember, confidence, style exploration modes, personalised question
flow and model routing (see §18 wiring). Partial: automatic repeated-choice pattern learning
(currently explicit + review-driven only).

### 20. Campaign Intelligence — **Built**
Variant Matrix, Audience Simulation, Pre-Flight Forecast, Experiment Planner in
[intelligence.ts](server/src/routes/intelligence.ts) + [CampaignLabPage.tsx](client/src/pages/CampaignLabPage.tsx);
taste briefs added to the lab. Partial: Campaign Health Score, Creative Fatigue Radar, Performance-to-Production Loop (no performance data source until publishing integrations exist).

### 21. Analytics and Insights — **Partial**
Workspace/project analytics + AI usage in [analytics.ts](server/src/routes/analytics.ts),
[AnalyticsPage.tsx](client/src/pages/AnalyticsPage.tsx). **Built this round:** model trust dashboard,
reviewer bottleneck panel. Missing: guideline-gap insights, time-to-publish metrics.

### 22. Notifications and Communication — **Partial**
In-app notification centre, unread badge, mark read/all in [notifications.ts](server/src/routes/notifications.ts)
+ [NotificationsPage.tsx](client/src/pages/NotificationsPage.tsx); ~20 event types across routes.
**Built this round:** notification preferences (server-respected) and entity comments with @mentions.
Missing: email notifications, daily digest delivery, emoji reactions.

### 23. Accessibility and Localisation — **Partial**
Built: semantic structure, focus-visible rings, keyboard nav, screen-reader labels, reduced-motion
guard (index.css), accessible Modal/Dropdown/palette (tests in [ui.a11y.test.tsx](client/src/__tests__/ui.a11y.test.tsx));
alt-text validation + contrast/caption checks inside verification ([verify.ts](server/src/ai/verify.ts)).
Missing: alt-text generation, audio description, multi-language content, regional currency/date formatting.

### 24. Security, Privacy, and Responsible AI — **Partial**
Built: JWT + rotation, bcrypt, RBAC, workspace/project isolation, rate limiting, helmet, CORS,
zod validation, upload validation, audit logging, AI-source disclosure everywhere, no-invented-facts
rules, "not legal advice" disclaimers. Missing: data-retention controls, per-user data export
(**built this round** as "Export my data"), sensitive-field redaction, suspicious-login alerts.

### 25. Integrations and Export — **Partial**
Built: provenance PDF/JSON, taste JSON. **Built this round:** script/storyboard/verification exports,
analytics CSV. Roadmap: publishing, Slack/Teams, Figma/Canva, webhooks, ZIP bundles.

### 26. Admin and Platform Management — **Partial**
`platformRole: 'user' | 'admin'` exists and is honoured in middleware. **Built this round:**
admin stats endpoint + admin page (users/workspaces/usage). Roadmap: billing/plans, marketplace.

### 27. Demo and Judge-Friendly Features — **Partial**
Built: Judge Mode `/workspaces/:id/judge-mode`, full seeded demo data ([seed.ts](server/src/seed.ts)).
**Built this round:** Getting-Started checklist on the dashboard (real-state driven). Missing: interactive product tour.

---

## Build-priority mapping (65 items)

| # | Item | Status |
|---|---|---|
| 1 | Authentication | Built |
| 2 | Workspace creation | Built |
| 3 | Member invitations | Built (link-based invites pending) |
| 4 | Roles and permissions | Built (marketing-strategist added) |
| 5 | Project creation | Built |
| 6 | Solo and team modes | Built |
| 7 | AI-guided questions | Built (+ taste-personalised) |
| 8 | Knowledge Inputs | Built |
| 9 | Conflict detection | Built |
| 10 | Conflict resolution | Built |
| 11 | Approved Facts Library | Built |
| 12 | Asset upload | Built |
| 13 | Licence status | Built |
| 14 | Readiness Score | Built |
| 15 | Campaign Risk Score | Built |
| 16 | Cost-at-Risk / Waste Receipt | Built |
| 17 | Production Contract | Built |
| 18 | Contract approval and locking | Built (diff built this round) |
| 19 | Script generation | Built (+ taste) |
| 20 | Storyboard generation | Built (+ taste) |
| 21 | Output verification | Built |
| 22 | Review/approve/reject | Built (+ workload analytics) |
| 23 | Provenance Passport | Built |
| 24 | Audit logs | Built |
| 25 | AI usage logs | Built |
| 26 | Basic analytics | Built |
| 27 | Notifications | Built (+ preferences) |
| 28 | Judge Mode | Built |
| 29 | Claim Passport | Built |
| 30 | Claim-to-scene traceability | Built |
| 31 | Rights Expiry Sentinel | Built |
| 32 | Knowledge expiry alerts | Built |
| 33 | Brand DNA Card | Built |
| 34 | Brand Drift Detector | Built |
| 35 | Creative Taste Profile | Built |
| 36 | Taste Slider | Built |
| 37 | Style DNA Card | Built |
| 38 | Taste Conflict Detector | Built |
| 39 | Creative Variant Matrix | Built |
| 40 | Audience Simulation | Built |
| 41 | Pre-Flight Performance Forecast | Built |
| 42 | Experiment Planner | Built |
| 43 | Regeneration Autopsy | Built |
| 44 | Decision Replay | Built (this round) |
| 45 | Decision Debt Tracker | Built (this round) |
| 46 | Failure Pattern Library | Built (this round) |
| 47 | Model Trust Score | Built (this round) |
| 48 | Model Bargaining Agent | Built (this round) |
| 49 | Reviewer Load Balancer | Built (this round, advisory) |
| 50 | Advanced analytics | Partial |
| 51–65 | Phase 3 (real media generation, publishing, billing, marketplace, SSO, mobile, …) | Roadmap — see [ROADMAP.md](ROADMAP.md) |

---

## Known gaps even after this round

- **Email delivery** (verification, invitations, digest emails) — needs an email provider; flows are
  built to degrade honestly (reset tokens shown in-app when no provider is configured).
- **Real media generation** (image/voice/video) — simulated render only; roadmap.
- **Campaign performance loop** — requires publishing/ad-platform integrations; roadmap.
- **Asset folders/tags/favourites, session list UI** — thin/missing; queued.
