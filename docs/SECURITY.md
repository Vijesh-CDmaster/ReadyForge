# ReadyForge — Security

Scope: the application as deployed today (Node/Express + MongoDB + React SPA). This is a
decision-support product, not a legal or compliance guarantee; nothing here claims certification.

## 1. Threat model (what we defend)

| Asset | Threat | Control |
|---|---|---|
| User accounts | credential stuffing, token theft | bcrypt(10), short-lived access JWT, refresh rotation, rate limits |
| Workspace data | cross-tenant reads/writes (IDOR) | server-side membership checks on every request; IDs from the client are never trusted |
| Ownership & roles | privilege escalation | server-side `requireRole`, immutable owner role, atomic transfer |
| Invitation/reset tokens | theft, replay, enumeration | random 256-bit tokens, SHA-256 at rest, TTL, single-use reset, generic responses |
| Uploads | oversized/malicious files | size cap (`MAX_UPLOAD_MB`), MIME allow-list, route-level signature sniffing |
| AI prompts | prompt injection from uploaded/user text | uploaded docs and user text are treated as data; no model output executes code or shell |
| Audit trail | tampering/omission | append-only `AuditLog` writes, fire-and-forget so failures cannot be hidden by a 500 |

## 2. Authentication and sessions

- **Passwords:** bcrypt, cost factor 10, stored as `passwordHash`. Login returns one generic
  `401 Invalid email or password` for unknown user *and* wrong password (no enumeration).
- **Access token:** JWT HS256, 15-minute TTL, sent in the `Authorization` header (never in
  `localStorage`-exposed responses beyond the SPA's in-memory copy).
- **Refresh token:** 7-day cookie (`rf_refresh`), rotated on refresh/logout; deleting the user
  invalidates every token (`requireAuth` re-loads the user each request and 401s when gone — tested).
- **Password reset:** `crypto.randomBytes(32)` token, SHA-256 at rest, 30-minute expiry, cleared
  after use; `POST /auth/forgot-password` always answers 200 so accounts cannot be enumerated; in
  development the reset URL is returned to the caller with `delivered:false` (never claimed as sent).
- **Rate limits:** `express-rate-limit` on `/auth/*`, `/ai/*` and all invitation token endpoints.
- **Account deletion:** requires password confirmation, removes memberships and content owned by the
  user, writes an audit event; re-login afterwards fails (tested).

## 3. Authorization and tenant isolation

- `requireWorkspace()` loads the workspace and checks **active** membership from the database on
  *every* request — a removed member loses access on their next call even if their JWT is still
  valid (stale-session defence).
- `requireRole(...)` enforces the 10-role matrix server-side; the owner always passes, everyone
  else must match. The UI mirrors these rules but is never the authority.
- Project routes check workspace membership again (`requireProject`), and analytics/comments
  re-verify scope — cross-tenant probes in the smoke suite expect 403/404, never 200.
- Only the owner may delete a workspace, change settings, invite, cancel invitations or start an
  ownership transfer; the owner member row cannot be removed or demoted.

## 4. Invitation and ownership tokens

- Tokens are 256-bit `crypto.randomBytes`; **only SHA-256 hashes are stored** (asserted by
  `invitations.test.ts`: the serialized document never contains the raw token).
- 7-day expiry; resending **rotates** the token, so the previous link dies immediately.
- Status machine `pending → accepted | rejected | revoked | expired | cancelled` is enforced with
  conditional updates — concurrent accepts can create only one membership (tested).
- Acceptance requires an authenticated session whose **email matches the invitation**; a mismatch
  is a 403. Public `GET /invitations/:token` returns only workspace name, role, inviter and status.
- Raw tokens are exposed **only** in development when no email provider accepted the message
  (`mode: 'link_only'`, `delivered:false`); production responses carry no usable token.
- Rate limit: 60 requests / 15 min per IP on token endpoints.

## 5. Ownership transfer

- Only the current owner can offer; recipient must be an active member; the recipient must accept.
- Offer expires (72 h); both parties are audited and notified.
- Promotion + demotion happen in **one document write**, so exactly one owner can exist; competing
  writes lose on Mongoose optimistic concurrency (`optimisticConcurrency: true`) and surface as
  HTTP 409 (`VersionError` mapping in `http.ts`). Verified by `ownership.test.ts`.

## 6. Transport, headers, CSRF

- `helmet` sets security headers; CORS is an explicit allow-list (`CORS_ORIGIN`) with
  `credentials: true`.
- API authorization uses the `Authorization` header, not ambient cookie credentials, so classic
  cross-site form CSRF does not apply to mutations; the refresh cookie is only read by
  `POST /auth/refresh`, which requires same-origin CORS. Documented as "CSRF: mitigated by design",
  not "implemented token checks".
- `app.set('trust proxy', 1)` so rate limiting sees the real client IP behind a proxy.

## 7. Uploads and input handling

- 25 MB default cap → 413; MIME allow-list with server-side file-signature sniffing
  (`routes/assets.ts`); files are stored outside the web root and served from `/uploads`.
- All request bodies are Zod-validated; ObjectIds are validated or rejected as 400 (never 500).
- AI/system prompts never receive credentials; only project text needed for the task is sent.

## 8. Secrets and configuration

- `.env` is git-ignored; `.env.example` documents variable names only.
- **Production startup guard:** `config.ts` still falls back to `dev-access-secret` /
  `dev-refresh-secret` when `JWT_*` are unset for zero-config local dev, but it now **refuses to
  boot when `NODE_ENV=production` without both secrets** (`config.test.ts` covers the guard).
  The in-memory MongoDB fallback also logs a loud warning in production — set `MONGODB_URI` for
  any real deployment. `.env.example` documents every variable; set real secrets before deploy.
- Tokens, reset/invite tokens and password hashes are never written to logs; server errors return a
  generic `Internal server error` with details only in the server log.

## 9. Data privacy

- Export (`GET /auth/export`) returns profile, workspaces, inputs, reviews and notifications with no
  password material (tested).
- Retention/deletion: account deletion removes user-owned rows; workspace deletion cascades
  knowledge, conflicts, assets, members and projects, and audits the action.
- Audit log records actor, action, entity, before/after and IP for governance events.

## 10. Responsible AI

- Every AI-assisted result carries `source: 'ai' | 'rule_engine'` and the model name; the UI labels it.
- No AI output executes code. Claim verification remains evidence-based: an LLM answer alone never
  marks a claim verified. Rights/legal checks always show "not legal advice".

## 11. Security test evidence (2026-10-28)

| Check | Result |
|---|---|
| Unauthenticated access to protected endpoints | 401 (smoke A, X) |
| Cross-workspace / cross-project access | 403/404 (smoke C, E, O) |
| Wrong password / duplicate email / invalid payload | 401 / 409 / 400 (smoke B) |
| Role violations (viewer approving, writer inviting, non-owner transfer) | 403 (smoke D, J, M; live run) |
| Raw invitation token persisted? | No — asserted in `invitations.test.ts` |
| Concurrent ownership accept | Exactly one owner — asserted in `ownership.test.ts` |
| Deleted account still usable? | No — 401 (smoke Y + manual check) |
| Export leaks password hash? | No (smoke Q) |

## 12. Production deployment checklist

1. Set strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (no dev defaults) — and make startup fail
   when they are missing in production.
2. Point `MONGODB_URI` at a real replica set with authentication and backups; enable transactions if
   you need multi-document atomicity.
3. Terminate TLS; set `CORS_ORIGIN` to the exact site origin.
4. Configure an email provider (`EMAIL_PROVIDER`, `SMTP_URL`) so verification/reset/invitation
   emails actually deliver.
5. Put the API behind rate limiting at the edge as well; enable audit-log retention policy.
6. Review upload allow-list and storage backend for your jurisdiction.
7. Never commit `.env`; rotate any secret that has ever been in a chat, log or screenshot.