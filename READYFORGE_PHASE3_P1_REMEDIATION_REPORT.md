# READYFORGE PHASE 3 — P1 REMEDIATION REPORT

**Date:** 2026-10-30
**Phase:** P1 remediation (BUG-005 form label)
**Affected file:** `client/src/pages/CreateProject.tsx`

---

## 1. Executive Summary

Phase 3 addressed the only remaining genuine P1 defect from the comprehensive QA audit: **BUG-005 — Project creation form label confusion**. A field labelled "One-sentence description" was wired to the `title` field, producing a confusing mismatch between the label a user reads and the data the form actually collects.

The defect was fixed with a one-word label change in `client/src/pages/CreateProject.tsx`:

- **Before:** `<Field label="One-sentence description" ...>`
- **After:** `<Field label="Project title" ...>`

All previously identified P1 issues were re-verified against the code and the four QA/remediation reports:

| Bug ID | Severity | Verdict |
|--------|----------|---------|
| BUG-004 | P1 | False positive — demo login works |
| BUG-005 | P1 | **Fixed in this phase** — label corrected |
| BUG-006 | P1 | Fixed in Phase 2 — `!= null` budget check |
| BUG-007 | P1 | Not a defect — score 0 is correct for a new project |
| BUG-008 | P1 | Not a defect — cost engines share `stageCost.ts` |

**Result:** 5 P1 issues reviewed, 1 confirmed and fixed, 1 fixed earlier (BUG-006), 3 verified as non-defects. No P1 issues remain open.

---

## 2. P1 Findings From the Original Audit

### BUG-004 — Password Validation Mismatch
- **Reported:** Login with documented demo credentials fails validation.
- **Investigation:** The auth schema requires a minimum of 8 characters. The documented demo password `demo1234` is exactly 8 characters. Login flow uses `magicLink` mode with no password in the happy path; the demo studio self-test seeds a user whose password satisfies the schema. No code path presents a demo password that violates schema validation.
- **Conclusion:** False positive.

### BUG-005 — Project Creation Form Confusion
- **Reported:** The form field labelled "One-sentence description" is wired to the `title` field, so users cannot tell what the field actually captures, and validation errors are confusing.
- **Investigation:** The CreateProject page rendered a top-level prompt saying "Describe it in one sentence — ReadyForge classifies it and generates adaptive questions next", and then a `Field` component whose `label` prop read "One-sentence description" but whose `register(...)` target was `title`. The schema field is `title: z.string().min(2, 'Title must be at least 2 characters')`. The mismatch between the semantic label and the wired field is real.
- **Conclusion:** Genuine defect — fixed in this phase.

### BUG-006 — Budget Display / Budget Mapping
- **Reported:** A project created through the form showed `budget.amount = 0` in the API response even though the form had a `budgetAmount` value.
- **Investigation:** The root cause was the JavaScript truthiness ternary `values.budgetAmount ? { amount, currency } : undefined`, which silently dropped `0`. The fix changed the condition to `values.budgetAmount != null ? { amount, currency } : undefined`.
- **Conclusion:** Fixed in Phase 2 and verified. Not re-fixed here.

### BUG-007 — Readiness Score for New Projects
- **Reported:** Readiness score shows 0 for a new project, which looks wrong.
- **Investigation:** `computeReadiness()` returns 0 when a project has no inputs, no conflicts, no assets, and no production contract. The readiness score is a measure of production readiness, not of project existence. A brand-new project that has not yet begun the production pipeline legitimately scores 0.
- **Conclusion:** Not a defect — the score is correct for the initial state.

### BUG-008 — Cost-at-Risk Alignment With Readiness
- **Reported:** Cost-at-Risk and readiness calculations were inconsistent.
- **Investigation:** Both engines call `computePlannedStageCost()` from `server/src/engines/stageCost.ts`. The stage ladder is defined in one place, and both engines read the same canonical stage and apply the same formula. Stage costs match the documented ladder exactly. No divergence exists in the current code.
- **Conclusion:** Not a defect — the earlier inconsistency has already been resolved by consolidating into a single source module.

---

## 3. Issues Already Fixed Before Phase 3

| Bug ID | When Fixed | Evidence |
|--------|------------|----------|
| BUG-006 | Phase 2 | `READYFORGE_PHASE2_FIX_REPORT.md`, `client/src/pages/CreateProject.tsx` diff |
| BUG-001 (P0) | Prior work | Verified present in `server/src/services/videoJobs.ts` error handling |
| BUG-002 (P0) | Prior work | Verified present in `server/src/http.ts` global error handler |
| BUG-003 (P0) | Prior work | Verified present in `server/src/ai/client.ts` fallback logic |
| BUG-005 label fix | This phase | See Section 5 |

---

## 4. Issues Verified as False Positives

| Bug ID | Original Finding | Why It Is Not a Defect | Confidence |
|--------|------------------|------------------------|------------|
| BUG-004 | Demo password `demo1234` rejected by schema | Password is exactly 8 characters; schema minimum is 8; demo flow does not rely on the password for the documented happy path | High |
| BUG-007 | Readiness score 0 for a new project | A new project with no inputs, no conflicts, no assets and no contract is not yet production-ready; score 0 is the correct initial value | High |
| BUG-008 | Cost-at-Risk and readiness misaligned | Both engines share `computePlannedStageCost()` from `stageCost.ts`; all stage costs match the documented ladder | High |

---

## 5. Confirmed Defect Fixed During Phase 3

### BUG-005 — Project Creation Form Label Confusion

**Original finding:**
> The CreateProject form shows the label "One-sentence description" above a field that is actually the project `title`. Users cannot tell which field is the title and which is the description.

**Root cause:**
`client/src/pages/CreateProject.tsx` rendered the project title input with the label "One-sentence description" while binding it to `form.register('title')`. The top-of-form instructional copy also talked about describing the project "in one sentence", but the field being filled is the project title.

**Affected file:**
`client/src/pages/CreateProject.tsx`

**Change applied:**

```diff
-        <Field label="One-sentence description" error={form.formState.errors.title?.message}>
+        <Field label="Project title" error={form.formState.errors.title?.message}>
```

The label now matches the field's actual purpose. The placeholder text ("Make a 20-second ad for my handmade candle shop.") is already a good example of a project title and remains unchanged. The instructional paragraph above the card still describes the classification flow, which is the real "describe it in one sentence" step — that copy is not part of the labelled input and is intentionally left as-is.

**Why this is the correct fix:**
- The field is the project `title`. Renaming the label to "Project title" makes the form honest.
- No schema change is needed. The backend field is already named `title` and validated as a project title.
- "Description" exists as a separate, clearly-labelled optional field elsewhere in the form schema (`description: z.string().max(4000).optional()`), so the term "description" is not being reclaimed from the title field.
- The change is a single label string. Risk is minimal.

**Before / after behavior:**
- **Before:** A user typing "Make a 20-second ad for my handmade candle shop." under the label "One-sentence description" is submitting to `title`. Any title-validation error ("Title must be at least 2 characters") appears under a label that says "One-sentence description", which is confusing.
- **After:** The same input happens under the label "Project title", and the validation message "Title must be at least 2 characters" now appears under the label that matches the field it refers to.

---

## 6. Root-Cause and Affected Files

| Bug ID | Root Cause | File(s) | Change |
|--------|------------|---------|--------|
| BUG-005 | Label text did not match the wired field | `client/src/pages/CreateProject.tsx` | `label="One-sentence description"` → `label="Project title"` |

No backend files, schemas, tests, or other pages were changed.

---

## 7. Browser and API Verification Evidence

The fix is a static UI label change. The underlying API contract and data flow are unchanged:

- The form still submits `{ title, description, mode, projectType, objective, budget?, templateId? }` to `POST /api/projects`.
- The backend route and model are unchanged — the field is still `title`.
- The project page and API responses still use `project.title`.
- The classification mutation is still triggered on blur when the title is long enough.

Because this is a label-only change, the value the user types is identical before and after the fix; only the label the user reads changes. The existing automated test suite, which does not assert on the rendered label string, remains applicable and continues to pass.

Manual browser verification of the new label text was not performed in this phase. The change is mechanical and low-risk; the label is visible in the source and is the only modification to the working tree.

---

## 8. Regression Tests and Results

### Server
```plain
Test Files: 23 passed (23)
Tests:       221 passed (221)
Duration:    30.81s
```

### Client
```plain
Test Files: 6 passed (6)
Tests:       29 passed (29)
Duration:    4.63s
```

### Other checks
- TypeScript (`client npx tsc --noEmit`): no errors
- Root lint (`npm run lint`): 0 errors, 97 warnings (all pre-existing)
- `git diff --check`: clean

**Total: 250 tests passed, 0 new failures, 0 regressions.**

---

## 9. Updated P1 Bug Register

| Bug ID | Original Finding | Verification | Fix Applied | Tests | Final Status |
|--------|------------------|--------------|-------------|-------|--------------|
| BUG-004 | Password validation mismatch for demo credentials | Inspected auth schema and demo self-test | None — false positive | Not applicable | Closed — not a defect |
| BUG-005 | "One-sentence description" label on the project title field | Confirmed; label bound to `title` | `label="Project title"` in `CreateProject.tsx` | 250/250 pass | **Fixed** |
| BUG-006 | Budget `0` dropped by truthiness check | Confirmed and fixed earlier | `!= null` check in Phase 2 | 250/250 pass | **Fixed** |
| BUG-007 | Readiness score 0 for new project | Inspected readiness engine | None — not a defect | Not applicable | Closed — not a defect |
| BUG-008 | Cost-at-Risk / readiness misalignment | Inspected both engines and shared `stageCost.ts` | None — not a defect | engines.test.ts (27) pass | Closed — not a defect |

---

## 10. Remaining Unresolved Issues

No P1 issues remain open after this phase.

Outstanding lower-severity items from the audit are explicitly out of scope for Phase 3 and remain for later phases if authorized:

- **P2:** email verification UX, unknown endpoint handling, CORS verification, file upload limit enforcement.
- **P3:** console warnings, loading-state polish, empty-state polish.

None of these are regressions introduced by this phase.

---

## 11. Recommended Next Phase

If the user authorizes a Phase 4, the natural candidates are the P2 items from the audit that are worth closing before the project is considered polished:

1. Confirm CORS and file-upload enforcement behave as expected from a real browser.
2. Decide whether the email-verification dev-mode message should be clearer or hidden in the demo environment.
3. Optionally trim the pre-existing lint warnings if they are distracting during review.

Phase 4 should not touch the P1 area unless a new P1 defect is discovered.

---

## 12. Data Integrity

No project, user, workspace, composition, asset, budget, or governance data was modified during this phase. The only on-disk change is a static label string in the client bundle. Existing submitted data is preserved.

---

## 13. Final Status

- **P1 issues discovered:** 5
- **Already fixed before Phase 3:** 1 (BUG-006)
- **Confirmed defects:** 1 (BUG-005)
- **Fixed during Phase 3:** 1 (BUG-005)
- **False positives / not defects:** 3 (BUG-004, BUG-007, BUG-008)
- **Remaining open P1 issues:** 0
- **Files changed:** 1 — `client/src/pages/CreateProject.tsx`
- **Server tests:** 221/221 passed
- **Client tests:** 29/29 passed
- **TypeScript check:** passed
- **Lint:** 0 errors, 97 pre-existing warnings
- **`git diff --check`:** clean
- **Report location:** `READYFORGE_PHASE3_P1_REMEDIATION_REPORT.md`

**Phase 3 complete. P1 remediation is finished. Awaiting authorization before any further phase.**
