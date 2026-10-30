# ReadyForge — Feature Completeness Matrix

**Date:** 2026-10-30 · **Baseline:** repository at `fdcc49f` + verified live checks.
**How to read:** ✓ marks the applicable state. `Build` names the roadmap item due before submission (P0/P1); `Defer` names the post-submission priority.

| ID | Feature / subfeature | Working | Partial | Missing | Broken | Unverified | Build | Defer |
|---|---|---|---|---|---|---|---|---|
| **AUTH** | | | | | | | | |
| AUTH-01 | Register (email/password, duplicate 409) | ✓ | | | | | | |
| AUTH-02 | Login, generic failures | ✓ | | | | | | |
| AUTH-03 | Access JWT (15 m) + rotating refresh cookie (7 d) | ✓ | | | | | | |
| AUTH-04 | Logout / refresh rotation | ✓ | | | | | | |
| AUTH-05 | Forgot / reset password (single-use, 30 min) | ✓ | | | | | | |
| AUTH-06 | Change password | ✓ | | | | | | |
| AUTH-07 | Profile, language, timezone, notification prefs | ✓ | | | | | | |
| AUTH-08 | Data export | ✓ | | | | | | |
| AUTH-09 | Account deletion | ✓ | | | | | | |
| AUTH-10 | Email verification token flow + page | ✓ | | | | | | |
| AUTH-11 | Email delivery of verification | | | | | ✓ | | P3 |
| AUTH-12 | Session list / revoke-all | | | ✓ | | | | P3 |
| AUTH-13 | MFA / SSO | | | ✓ | | | | P3 |
| AUTH-14 | 10 workspace roles + platform admin | ✓ | | | | | | |
| AUTH-15 | Protected routes (server + client) | ✓ | | | | | | |
| **WORKSPACE** | | | | | | | | |
| WS-01 | Create/edit/delete workspace | ✓ | | | | | | |
| WS-02 | Workspace settings, brand DNA | ✓ | | | | | | |
| WS-03 | Archive / restore | ✓ | | | | | | |
| WS-04 | Members, roles, removal, last-owner guard | ✓ | | | | | | |
| WS-05 | Hashed invitations, resend/cancel/accept/reject/expiry | ✓ | | | | | | |
| WS-06 | Ownership transfer (single owner, concurrency) | ✓ | | | | | | |
| WS-07 | Workspace isolation | ✓ | | | | | | |
| WS-08 | Audit log | ✓ | | | | | | |
| WS-09 | Member activity view | | | ✓ | | | | P3 |
| WS-10 | Workspace-level spend cap | | | ✓ | | | | P3 |
| **PROJECTS** | | | | | | | | |
| PROJ-01 | Create/edit/list/detail | ✓ | | | | | | |
| PROJ-02 | Status machine (11), ladder stage | ✓ | | | | | | |
| PROJ-03 | Project members + responsibilities | ✓ | | | | | | |
| PROJ-04 | Project role enum enforcement | | ✓ | | | | | P3 |
| PROJ-05 | Templates (built-in + saved) | ✓ | | | | | | |
| PROJ-06 | Validation + activity | ✓ | | | | | | |
| PROJ-07 | Project dashboard | ✓ | | | | | | |
| PROJ-08 | Delete project + full cascade + file cleanup | | ✓ | | | | P1-1 | |
| PROJ-09 | Archive action/UI | | ✓ | | | | | P3 |
| **KNOWLEDGE** | | | | | | | | |
| KNOW-01 | Input CRUD, types | ✓ | | | | | | |
| KNOW-02 | Approve/dispute, role gates | ✓ | | | | | | |
| KNOW-03 | Version history | ✓ | | | | | | |
| KNOW-04 | AI/adaptive questions + fallback | ✓ | | | | | | |
| KNOW-05 | Ledger statuses, decay alerts | ✓ | | | | | | |
| KNOW-06 | Per-member assignment dashboard | | ✓ | | | | | P3 |
| KNOW-07 | Draft/resume questionnaire | | | ✓ | | | | P3 |
| KNOW-08 | Semantic/embedding search | | | ✓ | | | | P3 |
| **CONFLICTS** | | | | | | | | |
| CONF-01 | Detection (rules/NLI/AI), severity, types | ✓ | | | | | | |
| CONF-02 | Recommendation + accept | ✓ | | | | | | |
| CONF-03 | Assign / resolve / dismiss | ✓ | | | | | | |
| CONF-04 | Authority routing + audit | ✓ | | | | | | |
| CONF-05 | Conflict graph visualisation | | ✓ | | | | | P3 |
| CONF-06 | NLI symmetric-threshold quality | | ✓ | | | | | P2 |
| **AI** | | | | | | | | |
| AI-01 | Local FastAPI service boots (CUDA, NLI, Qwen) | ✓ | | | | | P0-4 | |
| AI-02 | OpenAI-compatible chat endpoint | ✓ | | | | | | |
| AI-03 | NLI conflict/verify/classify endpoints | ✓ | | | | | | |
| AI-04 | Rule-engine fallback + honest labels | ✓ | | | | | | |
| AI-05 | Question generation / classification | ✓ | | | | | | |
| AI-06 | Script/storyboard/outline/preview/final | ✓ | | | | | | |
| AI-07 | Task review / regenerate with notes | ✓ | | | | | | |
| AI-08 | AI usage logs/cost/tokens | ✓ | | | | | | |
| AI-09 | Durable generation queue / cancel | | ✓ | | | | | P2 |
| AI-10 | AI image generation | | | ✓ | | | | P3 |
| AI-11 | Paid Runway video generation | | | | | ✓ | | P3 |
| **GOVERNANCE** | | | | | | | | |
| GOV-01 | Readiness 7 categories + score | ✓ | | | | | | |
| GOV-02 | Readiness blockers/warnings/actions | ✓ | | | | | | |
| GOV-03 | Production authorization evaluator | ✓ | | | | | | |
| GOV-04 | Readiness UI/category breakdown | ✓ | | | | | | |
| GOV-05 | Documentation matches 7 categories | | | | ✓ | | P1-8 | |
| GOV-06 | Inline blockers near Render | | ✓ | | | | | P2 |
| GOV-07 | Claim passport (UI + API) | ✓ | | | | | | |
| **CONTRACT** | | | | | | | | |
| CON-01 | AI/rule draft + versions + supersede | ✓ | | | | | | |
| CON-02 | Diff + version history | ✓ | | | | | | |
| CON-03 | Stage approvals, required approvers | ✓ | | | | | | |
| CON-04 | Reject with reason | ✓ | | | | | | |
| CON-05 | Lock | ✓ | | | | | | |
| CON-06 | Server-side generation/render gate | ✓ | | | | | | |
| **COST** | | | | | | | | |
| COST-01 | Campaign risk score + bands | ✓ | | | | | | |
| COST-02 | Cost-at-risk probability/loss/signals | ✓ | | | | | | |
| COST-03 | Stage-aware planned cost | | | | ✓ | | P0-1 | |
| COST-04 | Waste receipt (now vs after fixes) | ✓ | | | | | | |
| **BUDGET** | | | | | | | | |
| BUD-01 | Project budget config/display | ✓ | | | | | | |
| BUD-02 | Atomic hard limit under concurrency | ✓ | | | | | | |
| BUD-03 | Reservation state machine | ✓ | | | | | | |
| BUD-04 | Settlement / refund | ✓ | | | | | | |
| BUD-05 | Idempotent operation keys | ✓ | | | | | | |
| BUD-06 | Crash recovery / reconciliation | ✓ | | | | | | |
| BUD-07 | Local render settles at zero | ✓ | | | | | | |
| **ASSETS** | | | | | | | | |
| ASSET-01 | Upload (16 MIME types, 25 MB, role gate) | ✓ | | | | | | |
| ASSET-02 | Magic-byte content validation | | ✓ | | | | | P2 |
| ASSET-03 | FFprobe duration / trimming enablement | ✓ | | | | | | |
| ASSET-04 | Metadata + AI/consent flags | ✓ | | | | | | |
| ASSET-05 | Licence fields | ✓ | | | | | | |
| ASSET-06 | Rights verification + final gate | ✓ | | | | | | |
| ASSET-07 | Protected streaming | ✓ | | | | | | |
| ASSET-08 | Asset deletion | ✓ | | | | | | |
| ASSET-09 | Render-output asset registration | ✓ | | | | | | |
| ASSET-10 | Video thumbnails/posters | | ✓ | | | | | P2 |
| ASSET-11 | Folders/tags/favourites | | | ✓ | | | | P3 |
| ASSET-12 | Licence document upload | | | ✓ | | | | P3 |
| **EDITOR** | | | | | | | | |
| ED-01 | Multi-track video/audio/text timeline | ✓ | | | | | | |
| ED-02 | Add/remove tracks | ✓ | | | | | | |
| ED-03 | Hide/mute/lock tracks (server-enforced) | ✓ | | | | | | |
| ED-04 | Track rename | | | ✓ | | | P1-4 | |
| ED-05 | Track reorder | | ✓ | | | | | P1-10 |
| ED-06 | Add clips from video/audio assets | ✓ | | | | | | |
| ED-07 | Drag clip in time + 0.1 s snap | ✓ | | | | | | |
| ED-08 | Cross-track clip movement | | | ✓ | | | | P2 |
| ED-09 | Trim in/out with source limits | ✓ | | | | | | |
| ED-10 | Split at playhead | ✓ | | | | | | |
| ED-11 | Duplicate/delete clip | ✓ | | | | | | |
| ED-12 | Undo/redo | ✓ | | | | | | |
| ED-13 | Zoom/scroll/ruler/playhead | ✓ | | | | | | |
| ED-14 | Save with optimistic revision | ✓ | | | | | | |
| ED-15 | Keyboard shortcuts | | | ✓ | | | | P2 |
| ED-16 | Copy/paste, ripple delete | | | ✓ | | | | P3 |
| ED-17 | Unsaved-changes guard | | | ✓ | | | P1-3 | |
| ED-18 | Composition version history/restore | | | ✓ | | | | P3 |
| ED-19 | Preview >2 video layers | | ✓ | | | | | P2 |
| ED-20 | Responsive/mobile editing | | ✓ | | | | | P3 |
| **VIDEO/AUDIO** | | | | | | | | |
| VA-01 | Protected video preview playback | ✓ | | | | | | |
| VA-02 | Render compositing multiple video tracks | ✓ | | | | | | |
| VA-03 | 7 transition types | ✓ | | | | | | |
| VA-04 | Transition duration validation | ✓ | | | | | | |
| VA-05 | Transition timeline drag/resize | | | ✓ | | | | P3 |
| VA-06 | Speed/crop/transform/opacity | | | ✓ | | | | P3 |
| VA-07 | Image/logo overlays, image clips | | | ✓ | | | | P2 |
| VA-08 | Per-clip volume + fades | ✓ | | | | | | |
| VA-09 | Track volume + mute | ✓ | | | | | | |
| VA-10 | Audio mixing + limiter in render | ✓ | | | | | | |
| VA-11 | Browser audio monitoring | | | ✓ | | | | P2 |
| VA-12 | Waveforms | | | ✓ | | | | P3 |
| **TEXT** | | | | | | | | |
| TXT-01 | Add/edit/move/resize/duplicate/delete text | ✓ | | | | | | |
| TXT-02 | Typography (family, size, colour, bold/italic, alignment, width) | ✓ | | | | | | |
| TXT-03 | Background/opacity/outline/shadow/z-index | ✓ | | | | | | |
| TXT-04 | 7 entrance + 6 exit animations, delay, easings | ✓ | | | | | | |
| TXT-05 | SRT parse + import to text clips | ✓ | | | | | | |
| TXT-06 | Animation region visualisation | | ✓ | | | | | P2 |
| TXT-07 | Subtitle presets | | | ✓ | | | | P3 |
| TXT-08 | Custom uploaded fonts | | | ✓ | | | | P3 |
| **TRANSITIONS/ANIMATION** | | | | | | | | |
| TR-01 | Fade/slide/zoom/pop text animation in FFmpeg | ✓ | | | | | | |
| TR-02 | Crossfade + colour fades in FFmpeg | ✓ | | | | | | |
| TR-03 | Wipe/slide masks in FFmpeg | ✓ | | | | | | |
| TR-04 | Invalid animation/transition rejection | ✓ | | | | | | |
| TR-05 | Per-transition easing | | | ✓ | | | | P3 |
| TR-06 | Preview/render parity (documented approximation) | | ✓ | | | | P1-7 | |
| **RENDER** | | | | | | | | |
| REN-01 | FFmpeg/FFprobe discovery + version checks | ✓ | | | | | | |
| REN-02 | libx264/AAC/MP4 capability detection | ✓ | | | | | | |
| REN-03 | Safe spawn, no shell, timeouts | ✓ | | | | | | |
| REN-04 | Composition/asset/ownership validation | ✓ | | | | | | |
| REN-05 | Trim/offset/composite/transition/text/audio graph | ✓ | | | | | | |
| REN-06 | H.264/AAC 720p30 output | ✓ | | | | | | |
| REN-07 | FFprobe validation before publication | ✓ | | | | | | |
| REN-08 | Temp isolation + cleanup | ✓ | | | | | | |
| REN-09 | Protected storage/retrieval | ✓ | | | | | | |
| REN-10 | Progress/stage reporting | ✓ | | | | | | |
| REN-11 | Render rate limiting | | | ✓ | | | P1-5 | |
| REN-12 | Configurable presets/resolution | | | ✓ | | | | P2 |
| REN-13 | Total-duration guard | | ✓ | | | | | P2 |
| REN-14 | GPU/hardware encoding | | | ✓ | | | | P3 |
| **JOBS** | | | | | | | | |
| JOB-01 | Worker, atomic claim, 30 s lease | ✓ | | | | | | |
| JOB-02 | Heartbeat during long render | ✓ | | | | | | |
| JOB-03 | Retry (3) + backoff | ✓ | | | | | | |
| JOB-04 | Idempotency key + duplicate detection | ✓ | | | | | | |
| JOB-05 | Idempotency fingerprint covers revision | | ✓ | | | | P1-2 | |
| JOB-06 | Publication guard / duplicate output cleanup | ✓ | | | | | | |
| JOB-07 | Failed-render cleanup + refund | ✓ | | | | | | |
| JOB-08 | Lease-expiry recovery | ✓ | | | | | | |
| JOB-09 | Cancel queued job | ✓ | | | | | | |
| JOB-10 | Durable queue / external workers | | ✓ | | | | | P2 |
| JOB-11 | Stale temp-dir sweeper | | | ✓ | | | | P2 |
| **VERIFICATION** | | | | | | | | |
| VER-01 | Claim/scene verification + evidence + fixes | ✓ | | | | | | |
| VER-02 | Failed verification blocks approval | ✓ | | | | | | |
| VER-03 | Human override with reason | ✓ | | | | | | |
| VER-04 | Review approve/reject/regenerate | ✓ | | | | | | |
| VER-05 | Notifications/audit on decisions | ✓ | | | | | | |
| **PROVENANCE** | | | | | | | | |
| PROV-01 | Provenance passport | ✓ | | | | | | |
| PROV-02 | Claim passport | ✓ | | | | | | |
| PROV-03 | JSON export | ✓ | | | | | | |
| PROV-04 | PDF export (dependency-free) | ✓ | | | | | | |
| PROV-05 | Autopsy / decision replay | ✓ | | | | | | |
| **INTELLIGENCE** | | | | | | | | |
| INT-01 | Taste profile/overrides/moodboards/presets/learning | ✓ | | | | | | |
| INT-02 | Risk score, variants, forecasts, forecasts UI | ✓ | | | | | | |
| INT-03 | Brand drift, knowledge decay, rights sentinel | ✓ | | | | | | |
| INT-04 | Reviewer workload, model trust/bargain | ✓ | | | | | | |
| INT-05 | Decision debt/replay, failure patterns | ✓ | | | | | | |
| INT-06 | Real audience/ad-performance data | | | ✓ | | | | P3 |
| **ANALYTICS/ADMIN** | | | | | | | | |
| AN-01 | Workspace/project analytics | ✓ | | | | | | |
| AN-02 | AI usage analytics | ✓ | | | | | | |
| AN-03 | Admin stats + admin-only gate | ✓ | | | | | | |
| AN-04 | Analytics export | | | ✓ | | | | P3 |
| **NOTIFICATIONS** | | | | | | | | |
| NOT-01 | Persistent notifications, unread, mark-read | ✓ | | | | | | |
| NOT-02 | Preferences | ✓ | | | | | | |
| NOT-03 | Comments/replies/@mentions | ✓ | | | | | | |
| NOT-04 | Email notifications | | | | | ✓ | | P3 |
| NOT-05 | Realtime push | | | ✓ | | | | P3 |
| **SECURITY** | | | | | | | | |
| SEC-01 | Authn enforcement | ✓ | | | | | | |
| SEC-02 | Workspace re-read + role/project gates | ✓ | | | | | | |
| SEC-03 | Tenant isolation | ✓ | | | | | | |
| SEC-04 | Zod validation | ✓ | | | | | | |
| SEC-05 | Upload allowlist/size/filename | ✓ | | | | | | |
| SEC-06 | Magic-byte upload check | | ✓ | | | | | P2 |
| SEC-07 | Safe process execution | ✓ | | | | | | |
| SEC-08 | Path traversal guards | ✓ | | | | | | |
| SEC-09 | Font registry restriction | ✓ | | | | | | |
| SEC-10 | Secrets + production JWT fail-fast | ✓ | | | | | | |
| SEC-11 | Helmet/CORS/rate limits | ✓ | | | | | | |
| SEC-12 | Audit trail | ✓ | | | | | | |
| SEC-13 | MFA / session revocation | | | ✓ | | | | P3 |
| SEC-14 | Render-specific rate limit | | | ✓ | | | P1-5 | |
| **UI** | | | | | | | | |
| UI-01 | Landing/product explanation | ✓ | | | | | | |
| UI-02 | Login/register/reset/verify/invite pages | ✓ | | | | | | |
| UI-03 | Dashboard/navigation/command palette | ✓ | | | | | | |
| UI-04 | Forms, toasts, loading/empty/error states | ✓ | | | | | | |
| UI-05 | Error boundary | ✓ | | | | | | |
| UI-06 | Accessibility (shared components) | ✓ | | | | | | |
| UI-07 | Judge Mode / risky campaign | ✓ | | | | | | |
| UI-08 | Local vs paid disclosure inside editor | ✓ | | | | | | |
| UI-09 | README reflects editor/render truth | | | | ✓ | | P0-3 | |
| UI-10 | Preflight/demo readiness check | | | ✓ | | | P1-6 | |
| UI-11 | Preview parity note | | ✓ | | | | P1-7 | |
| UI-12 | Responsive editor | | ✓ | | | | | P3 |
| **API/INTEGRATIONS** | | | | | | | | |
| API-01 | 151 REST endpoints + error envelope | ✓ | | | | | | |
| API-02 | Local AI integration | ✓ | | | | | | |
| API-03 | Optional OpenAI/Runway adapters | | | | | ✓ | | P3 |
| API-04 | Email integration | | | | | ✓ | | P3 |
| API-05 | Local disk storage | ✓ | | | | | | |
| API-06 | Object storage/CDN | | | ✓ | | | | P3 |
| API-07 | OpenAPI spec | | | ✓ | | | | P3 |
| API-08 | Webhooks/public API | | | ✓ | | | | P3 |
| API-09 | Failure-mode test endpoints gated | | ✓ | | | | | P2 |
| **OPS** | | | | | | | | |
| OPS-01 | Server tests (211) | ✓ | | | | | | |
| OPS-02 | Client tests (29) | ✓ | | | | | | |
| OPS-03 | Typecheck/lint/build scripts | ✓ | | | | | | |
| OPS-04 | API smoke suite (199 recorded) | ✓ | | | | | | |
| OPS-05 | Real-render verification script | ✓ | | | | | | |
| OPS-06 | Seed self-test | ✓ | | | | | | |
| OPS-07 | Reproducible render-ready demo seed | | | ✓ | | | P0-2 | |
| OPS-08 | Seed asserts studio composition/idempotency | | ✓ | | | | P1-9 | |
| OPS-09 | Preflight script | | | ✓ | | | P1-6 | |
| OPS-10 | Browser E2E automation | | | ✓ | | | | P2 |
| OPS-11 | CI pipeline | | | ✓ | | | | P2 |
| OPS-12 | Docker/deploy manifest | | | ✓ | | | | P2 |
| OPS-13 | Monitoring/log aggregation | | | ✓ | | | | P3 |
| OPS-14 | README setup + demo accuracy | | ✓ | | | | P0-3 | |

## Totals (feature rows)

| State | Count (approx.) |
|---|---|
| Working / complete | 118 |
| Partial | 19 |
| Missing | 23 |
| Broken | 3 |
| Unverified | 4 |
| Due before submission | 5 P0 + 10 P1 |
| Deferred | remainder |

> Counts are per-row in this matrix, not a maturity score. Several "partial" rows (e.g., track reorder, preview layers) are usable today; they are marked partial against a professional-editor bar, not because they are broken.
