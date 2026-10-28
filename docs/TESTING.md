# ReadyForge — Testing

How the project is tested, what each suite covers, and what is *not* covered.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Everything (typecheck + lint + client tests + build) | `npm run verify` | exit 0 |
| Server unit + integration tests | `npm run test:server` | 59/59 passing (6 files) |
| Client component tests | `npm test` | 18/18 passing |
| End-to-end API smoke suite | `node scripts/smoke.mjs` | 199/199 passing |
| Typecheck only | `npm run typecheck` | no errors |
| Lint only | `npm run lint` | 0 errors (warnings tolerated) |

Prerequisites: Node 20+, `npm install` at the repo root. The server must be running for the smoke
suite (see below). Server tests need **no** running server — they boot a private
`mongodb-memory-server` instance (binary already cached from normal dev use).

## Running the app

```bash
# terminal 1 — API on :4000 (uses local fallback DB when MONGODB_URI is empty)
MONGODB_URI= PORT=4000 npm run dev -w server
# terminal 2 — Vite on :5173 (proxies /api and /uploads to :4000)
npm run dev -w client
# optional: seeded demo account demo@readyforge.ai / demo1234
```

`npm run dev` at the root runs both with `concurrently`. With the committed `server/.env`
(`MONGODB_URI` pointing at an unreachable Atlas cluster) the server will not start on this
machine — leave `MONGODB_URI` empty to use the documented local fallback.

## Test architecture

Three layers, each independent:

1. **Server unit/integration** (`server/src/**/*.test.ts`, Vitest, node environment)
   - `engines.test.ts` — pure scoring logic: readiness (category weights sum to 100, blockers for
     critical conflicts and expired/restricted licences, unknown licence downgrades to warning),
     cost-at-risk (waste = planned cost × rework probability, after-fixes ≤ if-render-now),
     campaign risk (band table, per-factor caps).
   - `auth.test.ts` — bcrypt round-trip, access/refresh kind confusion rejected, 401 for missing,
     malformed and deleted-user tokens, role-gate matrix.
   - `invitations.test.ts` — full lifecycle against an isolated mongod: normalization, duplicate →
     409, member → 409, hash-only persistence, lazy expiry, resend rotation (old link dies),
     cancel/reject block later accept, wrong email → 403, idempotent accept, **concurrent accepts
     produce one membership**.
   - `ownership.test.ts` — initiate permissions, member-only target, expiry, accept demotes previous
     owner, exactly one owner, **concurrent accepts yield exactly one owner** with the loser
     failing cleanly.
   - `templates.test.ts` — built-in and custom template CRUD, membership isolation, save-as-template,
     and the create-from-template fill rule (explicit values beat template values).
   - `budget.test.ts` — atomic budget charge inside the hard limit, 402 when it would overspend,
     **6 simultaneous charges against a 100-unit budget apply exactly 3** (spent stays 90), refund
     restores after a failed run, counters never go negative, no-budget (`amount = 0`) clamp
     behaviour preserved, 404 for an unknown project.
   - Helpers: `__tests__/helpers/db.ts` (private `MongoMemoryServer`, cleared between tests).
2. **Client component tests** (`client/src/__tests__/*.test.tsx`, Vitest + jsdom + Testing Library)
   - app smoke render, command palette destinations, toast store, accessibility assertions.
3. **End-to-end API smoke** (`scripts/smoke.mjs`, plain Node, no framework)
   - 25 sections (A–Y) covering auth, workspaces, members, projects, inputs, conflicts, assets,
     readiness, contract, generation, verification, reviews, provenance, analytics/notifications,
     password reset, profile/data export, archive, contract versions, intelligence (trust score,
     failure patterns, rights sentinel, Judge Mode), taste, comments/@mentions, AI endpoints, admin
     denial and teardown (audit captured, account deleted, deleted login fails).
   - Registers its own throwaway accounts, creates a fresh workspace/project, and **deletes only its
     own data** in section Y.

### Running the smoke suite

```bash
MONGODB_URI= PORT=4000 npm run dev -w server   # leave the API running
node scripts/smoke.mjs                          # prints PASS/FAIL per assertion + SUMMARY
```

Exit code 0 and `total=199 pass=199 fail=0` is the pass condition.

### Browser/UI verification

Manual, via the dev server: registration validation (no request fired on invalid input), duplicate
registration → 409 surfaced inline, login/logout, protected-route redirect after logout, session
survives reload, invitation created in the UI → link shown with an honest "no email provider"
note → invitation page renders (signed-out, email-mismatch and pending states) → accept lands on
the workspace with the new member row. Automated browser (Playwright) tests are **not** set up.

## Environment configuration for tests

- Server tests: none (memory mongod). They never read `MONGODB_URI`.
- Smoke suite: needs only a running API; uses the local fallback DB.
- No test touches a real Atlas cluster or any external provider.

## Known limitations / not covered

- No coverage measurement is collected — do not read "59 tests" as a coverage percentage.
- Contract versioning, conflict-detection engine, AI routing fallback, taste learning and
  generation failure paths have **no dedicated unit tests** yet (smoke covers their HTTP surface).
- Email delivery cannot be tested — no provider is configured; flows assert the honest
  `delivered:false` behaviour instead.
- The local AI service (`127.0.0.1:8001`) was unreachable during this pass, so AI paths ran through
  the rule-engine fallback; a live-LLM run is untested here.
- No load/stress testing, no DAST scanning.