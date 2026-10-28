# ReadyForge — AI Providers

What the AI layer actually supports today, how it is configured, and what happens when a provider
is unavailable. Nothing here claims a provider that is not in the code.

## 1. Provider inventory

| Provider | Status | Where |
|---|---|---|
| OpenAI-compatible chat-completions endpoint | **Configured** (primary) | `server/src/ai/client.ts` → `POST {OPENAI_BASE_URL}/chat/completions` |
| Local FastAPI `ai-service` (optional, own model) | **Bundled but optional** | `server/src/ai/local.ts`, `ai-service/` |
| Deterministic rule engine | **Always available** | `fallback()` functions in `ai/classify.ts`, `ai/conflicts.ts`, `ai/claims.ts`, `ai/verify.ts`, `ai/generation.ts` |
| Video / image / voice generation providers | **Not implemented** | ROADMAP 51–53 |

## 2. Configuration

| Variable | Meaning | Default |
|---|---|---|
| `OPENAI_API_KEY` | Bearer key. Presence (non-empty) switches the LLM path on. | — (empty ⇒ rule engine only) |
| `OPENAI_BASE_URL` | OpenAI-compatible base, `/chat/completions` appended | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model id sent in the request | `gpt-4o-mini` |
| `LOCAL_AI_URL` | Optional local service for claim verification (NLI) | — (empty ⇒ disabled) |

The repository's `server/.env` points `OPENAI_BASE_URL` at `http://127.0.0.1:8001/v1` with model
`Qwen/Qwen2.5-0.5B-Instruct` and `LOCAL_AI_URL` at the same host — i.e. it expects the bundled
`ai-service` to be running. See §6 for its observed availability.

## 3. Routing rules

There is **one** LLM transport (`aiJson`) with task-specific prompts; routing decisions are:

1. If `OPENAI_API_KEY` is empty → rule engine immediately (`source:'rule_engine'`,
   `model:'readyforge-rules'`).
2. Otherwise call the provider with a 60-second abort timer; any failure (non-2xx, timeout, JSON
   parse failure) falls back to the deterministic function and logs
   `[ai] call failed, using rule engine`. **A failure never surfaces as fake AI success.**
3. Claim verification additionally consults the local NLI service when `LOCAL_AI_URL` is set
   (`usedLocal ? 'ai' : result.source`).
4. Model preference/Trust Score routing (cost, latency, first-pass acceptance) is computed from
   persisted generation runs in `routes/intelligence.ts`; the recommendation is advisory — it never
   bypasses budget, rights or contract blockers.

Every response carries `{ source, model }`, and the UI labels AI-assisted output from it.

## 4. Cost estimation honesty

- Planned costs come from the project's own budget/stage model and workspace currency; they are
  **estimates**, not invoice data.
- Actual token/usage cost is recorded only when the provider returns usage data; otherwise the run
  is marked estimated. No pricing table claims precision it does not have (no provider price feed
  is configured).

## 5. Timeouts, retries, errors, privacy

- Timeout: 60 s per request (AbortController). No automatic retry loop exists — callers degrade to
  the rule engine instead of retrying, so there is no retry storm and no duplicate billing.
- Errors: HTTP 5xx from the app never contain provider details; the console logs a one-line warning.
- Privacy: only project text needed for the task is sent. **No credentials, tokens, password hashes
  or reset/invitation tokens are included in any prompt.** Uploaded documents are treated as data,
  not instructions (prompt-injection containment documented in SECURITY.md §10).
- Rate limiting: `/api/ai/*` has its own `express-rate-limit` bucket.

## 6. Availability evidence (2026-10-28)

```
$ curl -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:8001/docs
000                     ← service not reachable
```

- The bundled `ai-service` (FastAPI + fine-tuned DistilBERT on MNLI, metrics in
  `ai-service/models/nli-distilbert/metrics.json`) was **not running** during verification, so all
  AI endpoints answered through the rule engine. Their smoke assertions (200 + `source` + `model`)
  passed because honest fallback is the designed behaviour.
- `/api/health` reports `ai: true` merely because a key is configured — **that flag means
  "LLM path enabled", not "provider reachable"**. Treat it as a known misleading signal; fixing it
  to do a live probe is a small, unimplemented improvement.
- The primary `OPENAI_BASE_URL` is the same loopback address, so no external LLM was exercised in
  this pass. Live-LLM behaviour remains **unverified** on this machine.

### Starting the local service (when needed)

```bash
cd ai-service
# per ai-service/README.md: install requirements, then:
uvicorn app.main:app --port 8001
```

## 7. How to add a provider

1. Add an adapter beside `ai/client.ts` that implements the same contract:
   `aiJson({ system, user, fallback, temperature }) → { data, source, model }`.
2. Keep the deterministic `fallback()` for every task — unavailable providers must degrade, not fail
   the product.
3. Add config keys to `config.ts` (never hardcode keys), document them here, and add a smoke/unit
   assertion for both the success path (mocked at the transport boundary) and the fallback path.
4. Wire enable/disable and Trust-Score stats in `routes/intelligence.ts` so routing only chooses
   enabled, configured providers.

## 8. Explicitly unsupported today

Video/image/voice generation, embeddings/vector retrieval, and any provider requiring credentials we
do not have. These are labelled **Planned/Blocked** in `docs/ROADMAP.md`; no UI claims they work.