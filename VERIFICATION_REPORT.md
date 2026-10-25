# ReadyForge Feature Verification Report

## Verification Date
2026-10-25

## Overall Status
**PASS** — the full MVP loop works end to end, with AI and without it.

## Summary
- Total automated checks: **123** (backend API journey covering QA Steps 2–17 and 20)
- Working after this pass: **123 / 123**
- Frontend routes exercised in a real browser: **19** (0 console errors, 0 crashes)
- Bugs found: **14**
- Fixed during verification: **14**
- Still failing: **0**
- TypeScript: `server` ✅ clean, `client` ✅ clean

### Test runs
| Run | Result |
|---|---|
| API suite, AI service **up** (Qwen2.5-0.5B + DistilBERT NLI on :8001) | **123/123** |
| API suite, AI service **stopped** (rule-engine fallback) | **123/123** |
| Browser pass (login → dashboard → 14 project routes → workspace routes → notifications) | 0 console errors, all XHR 200 |

---

## Detailed Findings (by QA step)

| Step | Area | Result |
|---|---|---|
| 2 | Health, CORS, helmet headers, rate-limit headers | ✅ |
| 2 | Unknown route → 404 (was 401), malformed JSON → 400 (was 500), oversized upload → 4xx (was 500) | ✅ fixed |
| 3 | Register/login/refresh-rotation/logout, httpOnly refresh cookie, no password leakage, 401s | ✅ |
| 4 | Workspace CRUD, settings | ✅ |
| 5 | Invites, role changes, member removal, viewer permission walls | ✅ |
| 6 | Project CRUD, deadline/budget, cross-user isolation, `GET /projects/:id/validate` | ✅ fixed |
| 7 | Knowledge inputs CRUD, approve/dispute, **version history endpoint (spec 7.8)** | ✅ fixed |
| 8 | Conflict detection (AI + NLI + rules), one-click recommendation/accept, manual resolve, authority routing, risk drops to baseline after all conflicts resolved | ✅ fixed |
| 9 | Asset upload, licence statuses, rights blocking of final render, rights check report | ✅ |
| 10 | Readiness score + category breakdown, Cost-at-Risk, Waste Receipt, Campaign Risk Score 0–100 | ✅ fixed |
| 11 | Contract create → reject → approve → **lock (spec 10.16)**, version history, spec fields | ✅ fixed |
| 12 | Draft ladder gating (stage-wise approval, cost/budget blockers), generation logs model/tokens/cost, regeneration-after-rejection requires notes | ✅ fixed |
| 13 | Verification report (checks, evidence, severity, suggested fixes), **failed verification blocks approval (13.10)**, **human override endpoint (13.11)**, history | ✅ fixed |
| 14 | Review approve/reject/request-changes, role walls, notifications + audit per decision | ✅ |
| 15 | Provenance passport, claim passport, regeneration autopsy, **JSON + PDF export (15.6/15.7)** | ✅ fixed |
| 16 | Workspace/project/AI-usage analytics, workspace isolation | ✅ |
| 17 | Notification list, unread count, mark-one/mark-all, links, scoping | ✅ |
| 18 | Frontend: all routes render, sidebar/switcher/user menu, login, inline form validation, empty states, toasts wired on every mutation, error boundary present, no dead links | ✅ |
| 19 | AI down: app does not crash, rule fallback activates, `rule_engine` labels in responses, failures logged (`[ai] call failed, using rule engine`), no stack traces or keys exposed | ✅ fixed |
| 20 | Full journey: create campaign → inputs → detect → resolve → asset rights → readiness/cost → contract approve+lock → generate script/storyboard → verify → approve/reject → provenance → analytics/notifications/audit | ✅ 123/123 |

---

## Bugs Found and Fixed

| # | Feature | Issue | Root Cause | Fix Applied | Re-test Result |
|---|---|---|---|---|---|
| 1 | Error handling | Malformed JSON → 500, oversized upload → 500, raw `err.message` leaked on 500s | `errorHandler` ignored body-parser `{status}` and Multer `LIMIT_FILE_SIZE` | Rewrote `server/src/http.ts` error handler | PASS (400/4xx, sanitized messages) |
| 2 | Contract creation | `POST /contract` crashed 500 when the LLM returned `callToAction` as an object | No type sanitization of AI draft fields | String-coercion sanitizer in `server/src/engines/contract.ts` (incl. model routing plan) | PASS |
| 3 | Conflict detection | AI returned out-of-enum `conflictType` | Missing enum mapping | Normalized mapping in `server/src/ai/conflicts.ts` | PASS |
| 4 | Spec 7.8 | No input version history | Endpoint missing | `history` snapshots on every change + `GET /inputs/:id/history` | PASS |
| 5 | Spec 10.16 | No way to lock an approved contract | Route missing | `POST /projects/:id/contract/lock`; ladder/variant engines now accept `locked` | PASS |
| 6 | Spec 13.10 | Failed verification did not block output approval | Check absent in review handler | 409 unless a documented override exists | PASS |
| 7 | Spec 13.11 | No human-override endpoint for a failed report | Route missing | `POST /verification-reports/:id/override` (+ project-scoped variant), audited | PASS |
| 8 | Spec 15.6/15.7 | Provenance export 404 | Endpoints missing | JSON export + dependency-free multi-page PDF writer | PASS |
| 9 | Infra | Unknown API paths returned **401** instead of 404 | Router-level `requireAuth` fired for unmatched paths | Route-root guard in `server/src/index.ts` | PASS |
| 10 | Conflicts UI | Serialized conflict lacked `inputAId`/`inputBId`; resolve responses had no `resolved` flag | Serialization/response gaps | Added both fields + `resolved: true` on resolve/accept | PASS |
| 11 | One-click resolve | Equal-authority, equal-confidence inputs returned `recommended: null` → 409 | Score tie produced no recommendation | Deterministic tie-break: approval → confidence → first-stated option, stated in the reason | PASS |
| 12 | Spec 13.6 | Some failing/warning checks had no `suggestedFix` | Checks emitted without fixes | Default-fix pass keyed by check type in `server/src/ai/verify.ts` | PASS |
| 13 | Override route | Always 409 “already carries an override” on fresh reports | Mongoose nested `override` object is truthy even when unset | All checks now test `override.at` (incl. the 13.10 approval gate) | PASS |
| 14 | Spec 19 (fallback) | With AI stopped, the rule engine missed the trial-eligibility contradiction | `NEGATIONS` regex didn’t match “only for enterprise customers” | Extended exclusivity pattern in `server/src/ai/conflicts.ts` | PASS (123/123 with AI down) |

Test-harness corrections (not product bugs): case-insensitive `HttpOnly` cookie assertion, `PATCH` for accept-recommendation, nested `risk.score` shape, stage-wise approval steps in the journey, and unauthenticated-401 expectation for invalid IDs.

---

## Remaining Known Issues

| # | Feature | Issue | Reason Not Fixed | Recommended Next Step |
|---|---|---|---|---|
| 1 | PDF export | Renders plain Helvetica text pages, not a styled document | No PDF library in the project; dependency-free writer chosen deliberately | Add `pdfkit` later if branded PDFs matter |
| 2 | Invite by email | Invites require the invitee to already be registered (no email delivery) | Out of MVP scope; spec marks email as optional | Add a mailer or invite links post-selection |
| 3 | NLI contradiction accuracy | Local DistilBERT scores ~0.77; one probe predicted “neutral” for the trial pair | Model quality, by design local + small | LLM + rule layers cover the miss; retrain for higher accuracy |
| 4 | Preview/Final render | Simulated render mode (documents, not encoded video) | Intended MVP behaviour, labelled in the UI | Integrate a real render API post-selection |
| 5 | Verification → approval gate | Blocks on the **latest** report only | Earlier superseded reports are historical | Acceptable; revisit if multi-report workflows appear |

**No known broken features.** Everything exercised in the 123-check suite and the browser pass works.