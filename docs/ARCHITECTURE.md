# ReadyForge — Architecture

This describes the system **as built**, not as intended. Where a boundary is a stub, it says so.

## 1. Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 6, TanStack Query, Zustand, react-hook-form + Zod, Tailwind (client/) |
| Backend | Node.js + Express 4, TypeScript (CommonJS), Zod request validation (server/) |
| Database | MongoDB via Mongoose 8. Dev falls back to `mongodb-memory-server` with a persistent `server/.data/mongo` when `MONGODB_URI` is empty. |
| Auth | JWT access token (15 m, `Authorization: Bearer`) + refresh token in an `rf_refresh` httpOnly-style cookie (7 d, rotated) |
| AI | OpenAI-compatible chat-completions client + optional local FastAPI `ai-service/` + deterministic rule-engine fallback |
| Tests | Vitest (client component tests, server unit/integration tests) + `scripts/smoke.mjs` end-to-end API suite |
| Tooling | ESLint (flat config), `npm run verify` = typecheck → lint → test → build |

Monorepo: npm workspaces (`client`, `server`) with a root script surface.

## 2. Request/response lifecycle

```
browser → Vite dev proxy (/api → localhost:4000)
       → helmet → CORS allow-list → express.json → cookieParser
       → known-root 404 guard (typo'd paths never reach auth)
       → router (auth → validation → authorization → handler)
       → errorHandler (ApiError | 11000→409 | CastError→400 | VersionError→409 | else 500, no internals leaked)
```

- **Validation:** Zod via `validateBody()` in `http.ts`; failures become `400` with per-field detail.
- **Authorization:** layered middleware in `middleware/auth.ts` — `requireAuth` (token → user), `requireWorkspace()` (active membership only, re-read from the DB **every request**, so revoked/stale memberships die immediately), `requireRole(...)`, `requireProject(...)`.
- **Audit:** `audit()` is fire-and-forget (`AuditLog`) for governance actions; failures log, never break the request.

## 3. Directory map

```
server/src/
  index.ts            createApp() (exported for tests) + main()
  config.ts           env parsing, single source of truth
  db.ts               MongoMemoryServer fallback, connect/disconnect
  http.ts             ApiError, asyncHandler, validateBody, errorHandler
  audit.ts            audit(), clientIp()
  crypto.ts           generateToken() / hashToken() (SHA-256) — shared by reset, verification, invitations
  email.ts            delivery boundary — currently always { delivered:false, provider:'none' }
  middleware/auth.ts  JWT + membership + role gates
  models/             Mongoose schemas (User, Workspace, WorkspaceInvitation, Project, KnowledgeInput,
                      Conflict, Asset, ProductionContract, GenerationTask, VerificationReport, Review,
                      Comment, Notification, AuditLog, CreativeVariant, …)
  routes/             HTTP surface (auth, workspaces, invitations, projects, inputs, conflicts, assets,
                      generation, intelligence, taste, analytics, comments, admin, ai, notifications)
  services/           domain logic independent of Express (invitations, ownership)
  engines/            deterministic, pure scoring (readiness, riskScore, costAtRisk, contract, preflight)
  ai/                 provider adapters (client, local, classify, conflicts, claims, verify, generation)
client/src/
  pages/ components/  UI; lib/api.ts (fetch wrapper + token refresh); store/ (auth, toast)
scripts/smoke.mjs     end-to-end suite, 199 assertions
```

**Boundary rule:** engines are pure functions over data (no I/O); services own state transitions and take plain inputs; routes only translate HTTP ↔ service calls. AI adapters must always return `{ data, source: 'ai' | 'rule_engine', model }` so the UI can label AI-assisted output honestly.

## 4. Data model notes

- **Workspace** embeds `members[]` (userId, role, status: invited|active|removed) and `settings`; it also holds `pendingOwnershipTransfer` — one document, so ownership state changes are single-document atomic writes. Schema uses `optimisticConcurrency: true`.
- **WorkspaceInvitation** stores only `tokenHash` (SHA-256), status, `expiresAt`, `resendCount`. Partial unique index: one *pending* invitation per (workspace, email). Raw tokens exist only in the response that creates/resends them (dev-only) and in the emailed link.
- **Project** owns budget (`amount/spent/remaining`), stage, readiness score cache.
- **ProductionContract** is versioned; `status` gates generation server-side.
- **No migration framework** (Mongoose is schemaless); new fields use defaults so existing documents stay valid. Decision: additive schema evolution + documented backfill when a field must be computed.

## 5. Generation workflow

```
draft ladder rungs: concept → script → storyboard → preview → animatic → final → publish
POST /projects/:id/generate/:stage
  1. readiness + contract gates (approved/locked contract required, blockers listed)
  2. stage gating (previous rung approved; script/storyboard non-empty; uncleared assets block final)
  3. atomic budget reservation — a conditional pipeline update on the Project document
     (`spent + cost <= amount` evaluated by MongoDB, see §8); the ladder's own budget
     blocker is advisory under concurrency
  4. ai/generation.ts produces content (real provider if reachable, else clearly-labelled simulation)
  5. persist GenerationTask (cost, model, tokens, attempt); a failed run refunds the reservation
     and marks the task `failed`, then audit, notify
```

There is **no background queue**: work runs inside the request. Statuses `queued|running|completed|failed|cancelled` are modelled, but a durable worker, cancellation and retry limits are not implemented (Priority 9).

## 6. AI abstraction

- `ai/client.ts#aiJson({system,user,fallback})` — posts to `{OPENAI_BASE_URL}/chat/completions` with a 60 s abort timer; on missing key, non-2xx, timeout or JSON parse failure it returns the deterministic `fallback()` with `source:'rule_engine'`. Callers never see a fake "success" labelled as AI.
- `ai/local.ts` — optional `LOCAL_AI_URL` FastAPI service (`ai-service/`) exposing a fine-tuned DistilBERT NLI model for claim verification; used when configured and reachable.
- Routing/registry/trust scores live in `routes/intelligence.ts` (computed from persisted generation runs).

## 7. Email abstraction

`email.ts` exposes `sendEmail()` returning `{ delivered, reason, provider }`. No provider adapter ships, so it always reports `delivered:false`; flows (reset, invitation) surface the link in-app in development and an explicit "not configured" note otherwise. Nothing in the codebase may print "sent" unless a provider accepted the message.

## 8. Concurrency and transactions

- Standalone MongoDB → **no multi-document transactions**. Operations that must be atomic are designed onto one document:
  - membership add + role swap + `ownerId` change → Workspace document;
  - invitation state machine → conditional `findOneAndUpdate` on `status` (exactly one winner per transition);
  - optimistic concurrency (`__v`) guards every `Workspace.save()`; conflicts surface as HTTP 409;
  - budget charge/refund → conditional pipeline update on the Project document
    (`services/budget.ts`): the hard-limit `$expr` guard is evaluated by MongoDB inside a single
    update, so concurrent charges cannot overspend; a failed generation run refunds atomically.
- Budget enforcement is the known exception (still read-then-write) — Priority 6.

## 9. Configuration

`config.ts` reads `PORT`, `CORS_ORIGIN`, `MONGODB_URI`, `JWT_*`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `OPENAI_*`, `LOCAL_AI_URL`, `MAX_UPLOAD_MB`, `SEED_ON_START`. Dev-only defaults exist for JWT secrets, but the module **fails fast at startup when `NODE_ENV=production` without both JWT secrets** (guarded by `config.test.ts`); the production memory-DB fallback warns loudly. See `docs/SECURITY.md` §8.

## 10. Known architectural limitations

1. `routes/generation.ts` (~1.2k lines) and `routes/intelligence.ts` (~0.9k lines) still mix multiple concerns — incremental extraction planned (Priority 8).
2. Response serialization is repeated per route rather than shared (the historical workspace `id` bug came from exactly this); a shared serializer is Priority 8.
3. No background job queue; generation blocks the request.
4. The workspace budget approval threshold is a display setting only — no workspace-level spend
   cap is enforced; hard limits exist at the project level.
5. Client pages fetch and render inline; there is no separate data layer beyond TanStack Query.
6. `scripts/smoke.mjs` is a single 865-line file.