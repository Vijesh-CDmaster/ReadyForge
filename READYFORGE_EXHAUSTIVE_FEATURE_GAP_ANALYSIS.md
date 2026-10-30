# ReadyForge — Exhaustive Feature Gap Analysis

**Date:** 2026-10-30
**Baseline:** `READYFORGE_COMPLETE_FEATURE_INVENTORY.md`, re-verified against the repository at commit `fdcc49f` plus the working tree.
**Purpose:** decide what must change before today's hackathon submission, and what must not be touched.
**Mode:** analysis and planning only. No application code, dependencies, configuration, database schema, environment variables or Git state were changed. The only repository additions are the four planning documents (plus a correction to the inventory's Claim Passport row).

Status vocabulary: **COMPLETE**, **PARTIAL**, **MISSING**, **BROKEN**, **UNVERIFIED**, **BLOCKED**.
Priority vocabulary: **P0** must ship before submission · **P1** high value, safe and quick · **P2** post-hackathon · **P3** roadmap.

---

## 0. Re-inspection findings that change the baseline

These were verified against the running application and source, and supersede parts of the inventory.

| Finding | Evidence | Consequence |
|---|---|---|
| **Claim Passport UI exists** | `client/src/pages/ProvenancePage.tsx:70,286` renders `GET /projects/:id/claim-passport` | Inventory corrected; remove "missing UI" work. |
| **README omits the video editor and says MP4 generation is not implemented** | `grep -n "editor\|FFmpeg" README.md` → no matches; README's video-jobs section says "MP4 generation ... not implemented" | The strongest implemented capability is invisible/contradicted in the project's front door. P0 documentation fix. |
| **The seeded demo is not render-ready** | Live API: demo project readiness 73.7, `productionAuthorization.authorized=false`, blocker `high_conflict`; contract `approved`; composition 2 clips / 2 tracks in this DB only | A judge starting from a fresh clone cannot go to the editor and render. |
| **Fresh seed has no composition and no video asset** | `seed.ts` writes logo SVG, product SVG, 1 s silent WAV; `grep "new EditComposition" server/src` → only route/tests | Editor demo requires manual media import; images are not supported by the editor. |
| **The current developer DB has a render-ready project**, but it is polluted | `UI Verification · Local Render`: readiness 74, authorized true, contract locked, 3 tracks/4 clips, 30+ rendered/corrupt verification assets | Useful fallback for today, not a reproducible submission asset. |
| **AI service is operational** | Started from `ai-service/.venv`; `/health` 200 (CUDA, NLI ready); Qwen loaded in 6.9 s; chat returned `READYFORGE OK`; NLI returned `contradiction` (label) | "AI is broken" is false; "AI was not running" was true. Start it for the demo. |
| **NLI symmetric-conflict probe** | Same probe: `label=contradiction`, `is_conflict=false`, forward neutral 0.7448 / reverse contradiction 0.8939 | Quality limitation, not a blocker; rule layer covers seeded conflicts. |
| **Tests green at commit** | 211/211 server, 29/29 client (2026-10-30) | Use as the regression baseline; rerun after every P0/P1 edit. |

---

## 1. Authentication and User Management

### Existing

| Feature / subfeature | Status | Evidence or limitation |
|---|---|---|
| Register, login, logout | COMPLETE | `auth.test.ts`, smoke B, live login (`demo@readyforge.ai`) today |
| Access + rotating refresh token, persistence | COMPLETE | JWT 15 m, httpOnly refresh 7 d; client refresh-on-401 |
| Password reset / change | COMPLETE | Single-use SHA-256 tokens |
| Profile, language, timezone, notification prefs | COMPLETE | `PATCH /auth/me` |
| Data export, account deletion | COMPLETE | Smoke Q/Y |
| Email verification | BLOCKED | Token flow + page exist; no email provider |
| Sessions list / revoke-all | MISSING | No route/model/UI |
| MFA / SSO | MISSING | Roadmap only |
| Roles (10 workspace roles + platform admin) | COMPLETE | `WORKSPACE_ROLES`, role gates |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change (FE / BE / DB / API) | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| AUTH-G1 | Email verification — BLOCKED | No delivery; accounts work unverified, so verification has no enforcement value | BE: provider adapter or explicit "verification unavailable" policy; FE: status copy. Do **not** add a paid service for the hackathon | Unit test for `sendEmail` failure path (exists) | 0.5 d | Medium | P2 |
| AUTH-G2 | Session management — MISSING | Stolen refresh token lives 7 days; no logout-all | BE/DB: session/refresh-token ids with revocation; FE: sessions panel | Rotation/revocation tests | 1–2 d | Medium | P3 |
| AUTH-G3 | MFA — MISSING | Not needed for judged demo | — | — | 3+ d | High | P3 |
| AUTH-G4 | Demo credential safety — PARTIAL | Demo password is public by design; acceptable for hackathon, must not ship to production | Docs: label demo-only; production guard exists for JWT secrets | Config test (exists) | 0.1 h | Low | P2 |

---

## 2. Workspace Management

### Existing

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Create/edit/delete, settings, brand DNA | COMPLETE | Smoke C, `SettingsPage` |
| Archive/restore | COMPLETE | Smoke R |
| Members, role change, removal, last-owner guard | COMPLETE | Smoke D |
| Invitations (hashed, expiring, resend/cancel) | COMPLETE | `invitations.test.ts` (12) |
| Ownership transfer (concurrency-safe) | COMPLETE | `ownership.test.ts` (8) |
| Workspace isolation, audit log | COMPLETE | Smoke C/E/O |
| Member-scoped activity view | MISSING | Audit exists; no per-member view |
| Workspace-level spend cap | MISSING | Threshold is display-only |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| WS-G1 | Member activity — MISSING | Judges rarely ask; no correctness impact | FE filter over `/audit-logs`; no DB change | Component test | 0.5 d | Low | P3 |
| WS-G2 | Workspace spend cap — MISSING | Project limits exist; a real org control is absent | BE: workspace budget aggregate + enforcement in `budget.ts`; DB: workspace budget fields | Race tests | 2 d | Medium | P3 |

---

## 3. Invitations and Ownership Transfer

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Invite create/list/resend/cancel, accept/reject, expiry, single-pending | COMPLETE | 12 tests + smoke |
| Token hashing, dev-only link exposure | COMPLETE | `services/invitations.ts` |
| Ownership offer/accept/cancel, exactly one owner | COMPLETE | 8 tests |
| Email delivery of invites | BLOCKED | Same missing provider |

**Gaps:** only email delivery (`INV-G1`, P2, shared with AUTH-G1). The in-app link flow is sufficient for a judged demo and is already browser-verified. No P0/P1 work.

---

## 4. Project Management

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Create/edit/list/detail, 11 statuses, budget/deadline | COMPLETE | Smoke E |
| Dashboard, readiness/cost/contract sub-routes | COMPLETE | V1 |
| Members with project role | COMPLETE (roles free-form strings) | `ProjectMember` |
| Templates (built-in + workspace) | COMPLETE | 9 tests |
| Validation, activity | COMPLETE | Smoke E |
| Delete project | PARTIAL | Leaves compositions, tasks, reports, reviews, comments, notifications, reservations, AI logs, files |
| Project archive | PARTIAL | Status value only, no action/UI |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| PROJ-G1 | Delete cascade — PARTIAL | Orphaned data violates delete expectations; uploaded MP4s remain on disk (privacy/data hygiene) | BE: extend cascade in `DELETE /projects/:id` to `EditComposition`, `GenerationTask`, `VerificationReport`, `Review`, `Comment`, `Notification`, `BudgetReservation`, `AiUsageLog`, `CreativeVariant`; unlink upload files **only** for assets with no other references | New integration test asserting counts after delete + file removal; rerun existing suite | 1 h | Low–Medium | P1 |
| PROJ-G2 | Project archive — PARTIAL | No user-visible archive action | FE: archive/restore buttons; BE: use status transition (already allowed) | Component + route test | 0.5 d | Low | P3 |
| PROJ-G3 | Project role enum — PARTIAL | `projectRole` accepts any string; only workspace roles are enforced | DB: enum + migration/backfill; BE validation | Route tests | 0.5 d | Medium | P3 |

---

## 5. Knowledge Inputs and Knowledge Ledger

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Input CRUD, types, approval/dispute, version history | COMPLETE | Smoke F, `inputs.ts` |
| Role-gated approval | COMPLETE | in-handler role check |
| AI/adaptive question generation | COMPLETE (fallback verified) | Smoke W |
| Ledger listing, statuses, decay/renewal alerts | COMPLETE | `KnowledgeLedger`, intelligence |
| Per-member assignment dashboard | PARTIAL | Assignee exists; no dedicated view |
| Draft/resume questionnaire | MISSING | — |
| Semantic/embedding search | MISSING | — |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| KNOW-G1 | Assignment dashboard — PARTIAL | Demo uses one owner; no functional break | FE filter by assignee over existing data | Component test | 0.5 d | Low | P3 |
| KNOW-G2 | Draft/resume wizard — MISSING | Convenience only | FE local draft; P3 | Component test | 1 d | Low | P3 |
| KNOW-G3 | Semantic retrieval — MISSING | Rule/keyword search is adequate for demo | Needs embeddings + store | — | 3+ d | High | P3 |

---

## 6. Conflict Detection and Resolution

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Rule/NLI/AI detection, severity, types | COMPLETE | Smoke G; live NLI call returned contradiction |
| Recommendation, accept, assign, resolve/dismiss | COMPLETE | Smoke G |
| Authority-aware resolution, audit, notifications | COMPLETE | routes + audit |
| Consensus graph API + visualisation | PARTIAL | conflict room UI; no dedicated graph view |
| Symmetric NLI gating | PARTIAL | probe: label contradiction but `is_conflict=false` |

**Gaps:** `CONF-G1` graph view (P3); `CONF-G2` NLI threshold tuning (P2, model quality, risky to tune before demo). No P0/P1.

---

## 7. AI Production and Content Generation

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Local FastAPI AI service (Qwen + DistilBERT) | COMPLETE (now running) | `/health` 200; chat 200 in 0.97 s after 6.9 s load; CUDA |
| Rule-engine fallback + honest labels | COMPLETE | AI-down run 123/123 |
| Question generation, classification, claim verification | COMPLETE | Smoke W/L |
| Script/storyboard/outline/preview/final documents | COMPLETE | Smoke K, `DraftLadder` |
| Task review/regenerate with notes | COMPLETE | Smoke M |
| AI usage logging | COMPLETE | `AiUsageLog`, analytics |
| Generation queue/retry/cancel | PARTIAL | Runs inline; video jobs only for retry/cancel |
| Paid Runway video generation | UNVERIFIED/BLOCKED | No key; adapter stub-tested only |
| AI image generation | MISSING | — |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| AI-G1 | Demo AI runtime — COMPLETE but not started by default | A judge starting API+web sees rule-engine labels; "AI product" claim weakens | Operational: start `ai-service` before demo; document the two commands; optional root script `npm run demo:ai`. **Verified startable today.** | Health + one chat + one generation label (`source: ai`) | 0.25 h | Low | P0 |
| AI-G2 | Generation queue — PARTIAL | Long generations block the request; no cancellation | BE: reuse video job worker pattern; DB: task states; FE: status polling | New worker tests | 2–3 d | High | P2 |
| AI-G3 | Model quality — PARTIAL | 0.5B model; NLI false-neutral on one probe | Retrain/larger model | Eval harness | 2+ d | Medium | P3 |
| AI-G4 | Runway — UNVERIFIED | Paid, not needed | Keep behind env flags | Stub tests exist | — | High | P3 |
| AI-G5 | Image generation — MISSING | Not part of verified product | — | — | — | High | P3 |

---

## 8. Production Governance and Readiness

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Readiness score, 7 categories, blockers, recommendations | COMPLETE | 21 engine tests, smoke I |
| Production authorization (contract, approvals, conflicts, rights, budget) | COMPLETE | `productionAuthorization.ts`; live demo project correctly `authorized=false` |
| Category UI | COMPLETE | `ReadinessDashboard` |
| Documentation category count | BROKEN (docs) | Docs say 8; code has 7 |
| Claim-to-scene traceability | COMPLETE | Claim Passport in `ProvenancePage` |
| Workspace-level cap | MISSING | See WS-G2 |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| GOV-G1 | Readiness docs — BROKEN | A judge reading docs sees a different model than the UI | Docs: state 7 categories and weights; no code change | Doc review | 0.2 h | None | P1 |
| GOV-G2 | Readiness explanation on blocked render — PARTIAL | 409 lists blockers but mechanism is not obvious in UI | FE: show blockers inline next to Render when disabled; reuse `/readiness` data | Component test | 2 h | Low | P2 |

---

## 9. Production Contract and Approval Workflow

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Draft (AI/rule), versioning, supersede, diff | COMPLETE | Smoke J/S |
| Stage approvals, required approvers, reject | COMPLETE | routes + UI |
| Lock, generation/render gate | COMPLETE | `submitRenderJob` requires approved/locked |
| Contract UI | COMPLETE | `ContractPage` |

**No functional gaps required for submission.** The demo seed should include an approved+locked contract (`OPS-G1`) so the render path is immediately demonstrable. `CON-G1` per-approver comments (P3) is optional.

---

## 10. Cost-at-Risk and Waste Receipt

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Campaign risk score, bands, factors | COMPLETE | engine tests, smoke |
| Cost-at-risk probability, signals, actions | COMPLETE | `costAtRisk.ts` |
| Waste receipt (if-now vs after-fixes) | COMPLETE | engine tests |
| Planned cost stage table | BROKEN | `stageCosts[project.projectType]` instead of `project.currentStage` → always 300 base |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| COST-G1 | Stage-aware planned cost — BROKEN | The flashy "waste receipt" uses a stage-insensitive number; a judge changing stage sees no change | BE: `stageCosts[project.currentStage] ?? stageCosts.concept`; keep currency/format | Add `engines.test.ts` case asserting final > preview > script; run suite | 0.3 h | Low | **P0** |
| COST-G2 | Workspace-level aggregation — MISSING | Not needed for demo | See WS-G2 | — | — | — | P3 |

---

## 11. Budget Management

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Project budget config and display | COMPLETE | Smoke J |
| Atomic hard limit (race-tested) | COMPLETE | `budget.test.ts` |
| Reservations, settlement, refunds, idempotent operations, recovery | COMPLETE | 7 + 30 tests |
| Duplicate-charge prevention | COMPLETE | operation keys |
| Local render settles at zero | COMPLETE | worker code |
| Workspace cap | MISSING | See WS-G2 |

**No gaps needed before submission.** Budget reservation correctness is a demo strength; do not touch `budget.ts` except for the unrelated delete cascade.

---

## 12. Asset Management and Rights

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Upload (16 MIME types, 25 MB, role-gated, sanitised filename) | COMPLETE (MIME-only validation) | Smoke H |
| FFprobe media duration, trimming enablement | COMPLETE | V1/V2 |
| Metadata, licence fields, rights verification | COMPLETE | Smoke H |
| Protected streaming (workspace membership) | COMPLETE | `assetAccess.test.ts`, V1/V2 |
| Delete asset | COMPLETE | route |
| Render output registration | COMPLETE | `videoOutput.ts`, P1 probe |
| Content sniffing | PARTIAL | No magic-byte validation for non-media |
| Thumbnails | PARTIAL | No video posters |
| Folders/tags/favourites, licence document upload | MISSING | — |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| ASSET-G1 | Magic-byte validation — PARTIAL | A file with an allowed MIME header but wrong bytes is stored; security reviewers may flag it | BE: signature check for mp4/webm/wav/ogg/png/jpeg/webp/gif/pdf/woff/ttf; SVG/text checked for markup | Unit tests per format + existing upload tests | 3–4 h | Medium (false rejects) | P2 |
| ASSET-G2 | Video thumbnails — PARTIAL | Editor/library looks plain; no poster frames | BE: FFmpeg frame extraction on upload/render; DB field already exists | Worker test | 2 h | Low–Medium | P2 |
| ASSET-G3 | Folders/tags — MISSING | Library UX only | DB + UI | — | 2 d | Medium | P3 |
| ASSET-G4 | Licence document upload — MISSING | Evidence attachment is expected in rights workflows | DB/asset field + upload; FE | Upload test | 1 d | Medium | P3 |

---

## 13. Video Editor and Timeline

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Multi-track timeline (video/audio/text), ruler, playhead, zoom, scroll | COMPLETE | V1/V2 |
| Add/remove tracks | COMPLETE | V2 |
| Track hide/mute/lock, server-enforced lock | COMPLETE | composer + save validation |
| Clip add, move (time), trim, split, duplicate, delete | COMPLETE | tests + V2 |
| Undo/redo, selection, inspector | COMPLETE | `videoEditor.test.tsx` |
| Snapping (0.1 s), overlap blocking | COMPLETE | UI + server |
| Save/reopen with `If-Match` revision | COMPLETE | V1/V2 |
| Track rename | MISSING | Server accepts `name`; no control |
| Track reorder | PARTIAL | `order` persisted; no UI |
| Cross-track drag | MISSING | Drag changes time only |
| Keyboard shortcuts / copy-paste / ripple | MISSING | No key handlers |
| Unsaved-changes guard | MISSING | No `beforeunload`; navigating away loses edits |
| Composition version history/export | MISSING | Only current revision |
| Preview of >2 video layers | PARTIAL | Two-layer composite |
| Audio monitoring | MISSING | Video element muted |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| ED-G1 | Unsaved-changes guard — MISSING | A judge can lose a carefully built timeline by clicking a nav link; demo reliability | FE: `beforeunload` when dirty + in-app confirm on route change (React Router blocker or link intercept); no BE change | Component test that dirty state registers handler; manual nav check | 0.5 h | Low | P1 |
| ED-G2 | Track rename — MISSING | Visible incompleteness in a "professional" editor; server already supports it | FE: inline rename in track header; update `tracks`; save | Component test rename + save payload | 1 h | Low | P1 |
| ED-G3 | Track reorder — PARTIAL | Track order determines compositing; no way to change it after creation | FE: up/down controls swapping `order` for all tracks (server requires unique order); no BE change | Component test order swap + save | 2 h | Low–Medium | P2 |
| ED-G4 | Cross-track drag — MISSING | Moving clips between tracks is expected | FE: hit-test track under pointer, change `trackId` + compatible type, preserve source offsets; server overlap validation already rejects conflicts | Component test; manual | 4–6 h | Medium–High | P2 |
| ED-G5 | Keyboard shortcuts — MISSING | Speed; judges may try Delete/Space | FE: keydown handler for Delete, Space, Ctrl/Cmd+Z, S, arrows; avoid inputs | Component tests | 3–4 h | Medium | P2 |
| ED-G6 | Composition history — MISSING | No restore after bad save | DB: composition snapshots; FE history panel | Route tests | 1–2 d | Medium | P3 |
| ED-G7 | Copy/paste, ripple delete — MISSING | Convenience | FE only | — | 1 d | Medium | P3 |

---

## 14. Video and Audio Editing

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Video preview from protected asset | COMPLETE | V1/V2 |
| Multi-track compositing (render) | COMPLETE | V2 combined render |
| Transitions (7 types) | COMPLETE | V2 frame inspection |
| Per-clip volume, fade in/out; track volume/mute | COMPLETE | V2 audio levels |
| Audio mixing (render) | COMPLETE | `amix` + limiter |
| Transition timeline drag/resize | MISSING | Inspector only |
| Speed/crop/transform/opacity | MISSING | — |
| Image overlays / image clips | MISSING | Editor filters to video/audio; renderer has no image inputs |
| Browser audio monitoring / waveforms | MISSING | — |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| VA-G1 | Image overlays — MISSING | A logo/watermark is a common expectation; seed contains images that cannot be used | BE: image inputs, loop/scale/overlay with timing; DB: clip type/transform; FE: image track/clip UI | Renderer test + real frame check | 1–2 d | High | P2 |
| VA-G2 | Browser audio monitoring — MISSING | Judges cannot hear the mix before rendering | FE: Web Audio graph with per-clip gain/fades synced to playhead; autoplay policy handling | Hard to unit test; manual | 2–3 d | High | P2 |
| VA-G3 | Transition editing on timeline — MISSING | Inspector-only is usable but not "professional" | FE: draggable transition block; update duration | Component test | 1 d | Medium | P3 |
| VA-G4 | Speed/crop/transform — MISSING | Not required by current workflows | Schema + filter graph + UI | Render tests | 3+ d | High | P3 |

---

## 15. Text and Subtitle Editing

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Text clips with position/width/alignment/family/size/colours | COMPLETE | V2 |
| Background opacity, text opacity, bold/italic, shadow, outline, z-index | COMPLETE | V2 |
| Add/edit/move/resize/duplicate/delete text clips | COMPLETE | V2 |
| 7 entrance + 6 exit animations, delay, duration, 4 easings | COMPLETE | 8 animation tests, V2 frames |
| SRT import through the editor | COMPLETE | V2 |
| Animation region visualisation | PARTIAL | Clip indicator; no curve/region editor |
| Subtitle presets / caption styling library | MISSING | — |
| Custom uploaded fonts | MISSING | Registry families only (`sans/serif/mono`) |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| TXT-G1 | Animation timeline regions — PARTIAL | Hard to see when a title animates | FE: shaded in/out regions on text clips using existing animation math | Component test | 2 h | Low | P2 |
| TXT-G2 | Caption presets — MISSING | Speed only | FE presets writing existing fields | Component test | 3 h | Low | P3 |
| TXT-G3 | Custom fonts — MISSING | Brand typography is a selling point, but arbitrary font paths are a security risk | BE: font asset registry with allowlist + validation; FE picker | Security + render tests | 1–2 d | High | P3 |

---

## 16. Video Transitions and Animations

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Crossfade, fade black/white, wipe L/R, slide L/R | COMPLETE | V2 renders + frames |
| Duration validation against adjacent clips | COMPLETE | compositions tests |
| Invalid transition rejection | COMPLETE | 400/409 messages |
| Per-transition easing | MISSING | Not in schema |
| Transition preview parity | PARTIAL | Opacity/mask approximation; colour fades approximated |

**Gaps:** `TR-G1` preview parity documentation in the editor (P1, 0.25 h); `TR-G2` per-transition easing (P3); `TR-G3` cross-track/at-cut transitions on separate tracks (P3). No renderer changes before submission.

---

## 17. FFmpeg Rendering Engine

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Tool discovery, version/encoder validation, actionable errors | COMPLETE | 8 + 5 tests; live FFmpeg N-128198 |
| Safe spawning, no shell, timeouts, temp isolation, cleanup | COMPLETE | code + V2 |
| Trimming, offsets, compositing, transitions, text/animation, audio mix | COMPLETE | V2 renders |
| Output validation with FFprobe | COMPLETE | P1 probes |
| Protected storage/retrieval, progress | COMPLETE | V1/V2 |
| Fixed 1280×720/30, H.264/AAC | COMPLETE (limitation) | measured |
| Configurable presets/resolution | MISSING | constants |
| Render rate limiting | MISSING | no limiter on `/renders` |
| Maximum total duration guard | PARTIAL | Per-clip max 3600 s; total composition length not separately capped |
| Hardware encoding | MISSING | CPU only |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| REN-G1 | Render rate limiting — MISSING | A permitted editor can queue renders repeatedly and exhaust CPU; security reviewers notice | BE: small `express-rate-limit` on `POST /projects/:id/renders` (e.g., 6/min per user/IP), 429 with friendly message | Route test for 429 | 0.5 h | Low | P1 |
| REN-G2 | Presets — MISSING | 720p only; social formats impossible | BE: preset enum (720p/1080p/vertical), schema field; FE selector; renderer parameterization | Render tests per preset | 1–2 d | Medium–High | P2 |
| REN-G3 | Duration guard — PARTIAL | A very long timeline could run to timeout/disk | BE: reject compositions > N minutes (e.g., 10) with clear 400 | Route test | 0.5 h | Low | P2 |
| REN-G4 | GPU encoding — MISSING | Not needed | — | — | — | High | P3 |

---

## 18. Job Processing and Reliability

| Feature / subfeature | Status | Evidence |
|---|---|---|
| In-process worker, atomic claim, 30 s lease, heartbeat | COMPLETE | 30 job tests |
| Retries (3), backoff, expiry recovery | COMPLETE | tests |
| Idempotency key + fingerprint | PARTIAL | Fingerprint excludes composition revision; UI key includes revision, so mitigated |
| Publication guard, duplicate-output cleanup | COMPLETE | V2 reliability |
| Refund/settlement, reconciliation | COMPLETE | tests |
| Cancel queued job | COMPLETE | route |
| Durable queue / multi-instance CPU control | PARTIAL | No queue service; leases prevent double publication, not double work |
| Stale temp-dir sweeper | MISSING | Abrupt kill can leave dirs |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| JOB-G1 | Idempotency fingerprint — PARTIAL | Reusing a key across composition revisions could return a stale job; UI key includes revision so unlikely | BE: include `compositionRevision` (and project id) in `fingerprintJob` input | Existing idempotency tests + new case | 0.25 h | Low | P1 |
| JOB-G2 | Stale temp cleanup — MISSING | Disk hygiene after crashes | BE: startup sweep of `renders/*` older than N hours | Unit test with temp dirs | 1 h | Low | P2 |
| JOB-G3 | Durable queue — PARTIAL | Jobs only progress while an API process runs; not a judged-flow problem | Infrastructure | — | 3+ d | High | P3 |

---

## 19. Verification and Review

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Claim/scene verification, evidence, severity, suggested fixes | COMPLETE | Smoke L |
| Failed verification gates approval; documented override | COMPLETE | Smoke L |
| Review approve/reject/regenerate with notes | COMPLETE | Smoke M |
| Notifications/audit on decisions | COMPLETE | Smoke |

**No gaps needed.** Keep as-is for submission.

---

## 20. Provenance Passport

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Provenance passport, claim passport UI | COMPLETE | `ProvenancePage`, smoke N |
| JSON + PDF export | COMPLETE | Smoke N |
| Decision replay, autopsy | COMPLETE | Smoke N/T |

**No gaps.** The inventory's earlier "Claim Passport = backend only" was wrong and has been corrected.

---

## 21. Taste and Intelligence

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Taste profile, overrides, moodboards, presets, learning, routing | COMPLETE | Smoke U (20 endpoints) |
| Risk score, variants, forecasts, brand drift, decay, rights sentinel, workloads, model trust/bargain, decision debt/replay, failure patterns | COMPLETE (heuristics) | Smoke T/O + UI |
| Real audience/ad-performance data | MISSING | Simulations are labelled estimates |

**Gaps:** all P3 (external data). Do not touch before submission; the estimates are already labelled.

---

## 22. Analytics and Admin

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Workspace/project/AI-usage analytics, isolation | COMPLETE | Smoke O |
| Admin stats + admin-only denial | COMPLETE | Smoke X |
| Export of analytics | MISSING | P3 |

No submission-critical gaps.

---

## 23. Notifications and Comments

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Notifications list/unread/mark-read/preferences | COMPLETE | Smoke O |
| Comments, replies, @mentions → notification | COMPLETE | Smoke V |
| Email notifications/digests | BLOCKED | No provider |
| Realtime updates | MISSING | Polling/refetch only |

No submission-critical gaps.

---

## 24. Security and Data Protection

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Authn/authz, workspace re-read, role gates, tenant isolation | COMPLETE | tests + live checks |
| Zod validation, safe spawn, path guards, font registry | COMPLETE | code/tests |
| Protected media delivery | COMPLETE | tests/V1 |
| Secrets, production JWT fail-fast, headers, CORS, rate limits | COMPLETE | config test/smoke |
| Audit trail | COMPLETE | smoke |
| MFA, session revocation | MISSING | — |
| Upload magic-byte validation | PARTIAL | MIME only |
| Render rate limiting | MISSING | See REN-G1 |
| Project deletion file cleanup | PARTIAL | See PROJ-G1 |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| SEC-G1 | Upload sniffing — PARTIAL | Stored content may not match declared type | See ASSET-G1 | — | 3–4 h | Medium | P2 |
| SEC-G2 | MFA/sessions — MISSING | Enterprise claim only; not demo-critical | See AUTH-G2/G3 | — | days | High | P3 |
| SEC-G3 | Render limiter — MISSING | DoS/cost protection even for free renders | See REN-G1 | — | 0.5 h | Low | P1 |

---

## 25. Dashboard and User Interface

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Landing, auth, dashboard, navigation, command palette | COMPLETE | V1, tests |
| Forms, toasts, loading/empty/error states, error boundary | COMPLETE | smoke + tests |
| Accessibility (focus traps, ARIA, reduced motion) | COMPLETE (shared components) | 8 tests |
| Responsive editor | PARTIAL | Desktop-oriented |
| Judge Mode / risky-campaign demo | COMPLETE | `Dashboard.tsx` |
| Local/free vs paid disclosure | PARTIAL | Editor note exists; README contradicts/misses it |
| Demo readiness indicator/preflight UI | MISSING | No single "demo ready" check |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| UI-G1 | README/product truth — BROKEN | The front door omits the editor and denies MP4 output; judges may never see the best feature | Docs: new "Video editor & local rendering" section, corrected video-jobs section, demo steps including editor | Manual read-through | 0.5 h | None | **P0** |
| UI-G2 | Preflight/demo check — MISSING | A silent missing FFmpeg/AI/seed ruins a live demo | Script: check API `/health`/`/ready`, AI `/health`, `video-render/tools`, seeded demo project, print pass/fail; optional FE banner | Script self-test | 1 h | Low | P1 |
| UI-G3 | Preview parity disclosure — PARTIAL | Judges may compare preview and MP4 and see differences | FE: short note in editor inspector/footer that preview approximates fonts/transitions | Manual | 0.2 h | None | P1 |
| UI-G4 | Responsive editor — PARTIAL | Mobile judges see horizontal scroll | CSS-only pass | Manual | 2–3 h | Low | P3 |

---

## 26. APIs and Integrations

| Feature / subfeature | Status | Evidence |
|---|---|---|
| 151 REST endpoints, consistent errors, 404 guard | COMPLETE | inventory |
| Local AI integration | COMPLETE (running) | live checks |
| Optional paid providers | UNVERIFIED/BLOCKED | no keys |
| Email | BLOCKED | no provider |
| Local disk storage | COMPLETE (limitation) | — |
| OpenAPI/API docs | MISSING | README only |
| Webhooks/public API | MISSING | — |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| API-G1 | Test-mode job modes exposed — PARTIAL | `POST /video-jobs` accepts failure modes in any environment; a demo visitor could enqueue failures (harmless but odd) | BE: allow failure modes only when `NODE_ENV !== 'production'`; default success otherwise | Route test | 0.5 h | Low | P2 |
| API-G2 | OpenAPI — MISSING | Judges/developers like specs; not essential | Generate from Zod or hand-written | — | 2 d | Low | P3 |

---

## 27. Testing and Deployment Readiness

| Feature / subfeature | Status | Evidence |
|---|---|---|
| Server unit/integration tests | COMPLETE | 22 files, 211 tests, re-run today |
| Client tests | COMPLETE | 6 files, 29 tests, re-run today |
| Typecheck/lint/build scripts | COMPLETE (last passed Phase 3C; rerun before submission) | `npm run verify` |
| API smoke suite | COMPLETE (recorded 199/199) | `scripts/smoke.mjs` |
| Real render verification script | COMPLETE | `scripts/verify-render.ts` |
| Browser E2E automation | MISSING | Agent-driven sessions only |
| Seed self-test | COMPLETE | `server/seed-selftest.ts` |
| Seed with render-ready studio demo | MISSING | see below |
| Preflight script | MISSING | see UI-G2 |
| CI pipeline | MISSING | no `.github` |
| Docker/deploy manifest | MISSING | no Dockerfile |
| Monitoring/log aggregation | MISSING | logs only |
| README setup accuracy | PARTIAL/BROKEN | no editor/render, stale video section |

### Gaps and required work

| ID | Subfeature & status | Missing / why it matters | Required change | Tests | Effort | Risk | Priority |
|---|---|---|---|---|---|---|---|
| OPS-G1 | Render-ready demo seed — MISSING | **The single biggest demo risk.** Fresh DB has no video asset/composition and the demo project is blocked by an open conflict; a judge cannot reach a successful render without manual setup | BE: idempotent `ensureDemoStudio()` in seed/demoPipeline: generate 2 short MP4s + tone with local FFmpeg (if available), create licensed assets, a locked contract + approved inputs (no conflicts), and a composition (2 video clips with a transition, audio with fades, animated title). Backfill on existing DBs. FE: none | Seed self-test extended (asset types, tracks, clips, contract locked, readiness authorized, composition revision); manual fresh-DB run + UI render | 3–4 h | Medium (seed only; no production path) | **P0** |
| OPS-G2 | README truth — BROKEN | See UI-G1 | Docs | Manual | 0.5 h | None | **P0** |
| OPS-G3 | AI demo preflight — PARTIAL | Service not running by default; verified startable | Operational runbook + optional npm script; no code required | Health/chat/label checks | 0.25 h | Low | **P0** |
| OPS-G4 | Preflight script — MISSING | Silent environment failures during judging | `scripts/preflight.mjs`: API, DB, AI, FFmpeg tools, render-ready project, disk space | Script output on this machine | 1 h | Low | P1 |
| OPS-G5 | Seed self-test extension — PARTIAL | Current seed test likely does not assert video assets/composition | Extend `server/seed-selftest.ts` for studio project | Test run | 0.5 h | Low | P1 |
| OPS-G6 | CI — MISSING | Regression safety for future work | GitHub Actions: install, typecheck, lint, tests, build | CI green | 2 h | Low | P2 |
| OPS-G7 | Docker — MISSING | Deployment polish; not needed for local judging | Dockerfile + compose (Mongo optional) + FFmpeg | Build/run | 4 h | Medium | P2 |
| OPS-G8 | Browser E2E — MISSING | Demo paths regress silently | Playwright smoke: login → editor → save → render → playback | E2E run | 1–2 d | Medium | P2 |

---

## 28. Confirmed defects (verified this pass)

| # | Defect | Root cause | User impact | Severity | Recommended fix | Regression test |
|---|---|---|---|---|---|---|
| D1 | Cost-at-risk planned cost ignores stage | `stageCosts[project.projectType]` at `costAtRisk.ts:50`; table is keyed by ladder stage | Waste receipt/cost-at-risk numbers do not respond to stage; credibility hit | **High for demo** | Index by `currentStage`, keep fallback | Engine test across stages |
| D2 | Project deletion leaves orphans | `DELETE /projects/:id` cascades only 5 collections; files not unlinked | Stale tasks/reports/comments/assets; disk growth; privacy concern | Medium | Extend cascade + safe file unlink | Integration test counts + files |
| D3 | Render idempotency fingerprint omits composition revision | `fingerprintJob({stage,mode,contractVersion})` | Reusing a key after edits could return an older job; UI mitigates by keying on revision | Low | Include `compositionRevision` | Idempotency conflict test |
| D4 | Email delivery always fails | `email.ts` has no provider adapter | No verification/invite email; dev link only | Medium | Provider adapter post-hackathon | Existing failure-path test |
| D5 | Upload validation is MIME-header-only | Multer `fileFilter` inspects `file.mimetype` | Wrong-content file can be stored/served | Medium | Magic-byte checks | Per-format unit tests |
| D6 | No render rate limit | No limiter on `/renders` | Repeated renders can exhaust CPU | Medium | Add limiter | 429 test |
| D7 | Demo seed is not render-ready | No composition/video asset; open conflict blocks authorization | Judge cannot demo the headline feature from a fresh clone | **Critical for demo** | OPS-G1 | Seed self-test + fresh-DB UI render |
| D8 | Demo project authorization blocked | Seeded high-severity conflict remains open | Render button/path rejects with 409 until resolved | Medium (intentional governance, bad demo default) | Demo project with no open blockers; keep conflict in the campaign project | Readiness assertion |
| D9 | README denies/omits MP4 generation and editor | Stale Phase 2 text | Judges may miss the strongest capability; contradiction with live product | **High for judging** | Rewrite video section + add editor tour | Manual review |
| D10 | Readiness docs say 8 categories, code has 7 | Documentation drift | Confusion, minor credibility | Low | Docs fix | Manual |
| D11 | Track rename/reorder, cross-track drag, audio monitoring, image overlays absent | Unimplemented UI/renderer | Visible limits vs "professional editor" claim | Medium | P1/P2 items | Per item |
| D12 | NLI `is_conflict=false` on symmetric probe despite contradiction label | Symmetric threshold in `pair_is_conflict` | AI contradiction detection may miss some pairs; rule layer compensates | Low | Tune threshold or document | NLI probe test |
| D13 | No unsaved-changes guard | No `beforeunload`/route blocker | Demo edits can be lost by navigation | Medium | ED-G1 | Component test |

---

## 29. Workflow completeness

### W1 — New user → project → invite
Register → login → workspace → project → invite link. **Complete today.** Email delivery is the only missing branch; the in-app invite link works and was browser-verified. Minimum work: none (document the link flow).

### W2 — Campaign governance
Inputs → approve → detect conflict → resolve → readiness → contract → approve → lock. **Complete.** The seeded campaign intentionally stops at an open conflict, which is excellent for a governance demo. Minimum work: none; use it as the narrative.

### W3 — AI production
Select stage → generate → review → regenerate → verify claims → approve → provenance. **Complete** with the AI service running; without it, the same flow works and is labelled rule engine. Minimum work: start the service (done/verified), include it in the runbook.

### W4 — Asset rights
Upload → probe → licence → verify rights → block final until cleared. **Complete.** Content sniffing is the only hardening gap (post-hackathon). Minimum work: ensure demo assets are licensed `owned`/`licensed`.

### W5 — Video production
Composition → import → tracks → trim/split → text/animation → transition → audio → save → render → validate → play. **Capability complete; default data incomplete.** A fresh DB has no video asset or composition, and the demo project is render-blocked. Minimum work: **OPS-G1** (render-ready studio seed) and a 60-second UI rehearsal.

### W6 — Budget and reliability
Budget → reserve → execute → settle/refund → prevent duplicates. **Complete.** No work.

### W7 — Security
Authenticate → membership → project permission → protected asset → reject unauthorized. **Complete** (tests). No work.

---

## 30. Demo readiness scorecard

| Area | Ready? | Gap / action |
|---|---|---|
| Landing + product explanation | Yes | Add a line about local FFmpeg rendering |
| Register/login | Yes | Demo credentials documented |
| Workspace/project creation | Yes | — |
| Knowledge ledger | Yes | — |
| Conflict resolution | Yes | Seeded conflict gives a story |
| Readiness score | Yes | Use a project where resolving the conflict flips authorization |
| Cost-at-risk / waste receipt | **No** | D1 bug makes it stage-insensitive; fix P0 |
| Contract approval + lock | Yes | Demo project contract approved; seed studio should lock |
| AI generation | Yes (now) | Service running; otherwise fallback labelled honestly |
| Verification + provenance | Yes | Claim passport UI exists |
| Asset rights | Yes | Use licensed assets |
| Multi-track editor | Yes | Requires media; studio seed fixes |
| Genuine FFmpeg render | Yes | Verified; studio seed makes it one click |
| Final MP4 playback | Yes | Protected blob path verified |
| Error handling | Yes | Toasts, 409/501 messages |
| Responsive presentation | Mostly | Editor is desktop-first |
| Local/free vs paid explanation | **Partial** | README contradiction; add explicit section |

---

## 31. Summary

- **Complete and safe to leave alone:** auth (except delivery), workspaces, invitations/ownership, projects (except delete cascade), knowledge, conflicts, governance, contract, budget, assets (except sniffing), verification, provenance, taste/intelligence, analytics, notifications, security controls, rendering core, worker reliability.
- **Broken and worth fixing now:** cost-at-risk stage lookup; README product truth.
- **Missing and worth fixing now:** reproducible render-ready demo data; AI service start (operational).
- **Worth fixing if time:** delete cascade, idempotency fingerprint, unsaved-changes guard, track rename, render limiter, preflight script.
- **Defer:** image overlays, audio monitoring, cross-track drag, keyboard shortcuts, track reorder (unless spare time), presets, durable queue, email, MFA/sessions, upload sniffing, CI/Docker, E2E suite.

The submission should stand on the **governance chain + genuine editor + real MP4**, with the demo data making that path one click from login.
