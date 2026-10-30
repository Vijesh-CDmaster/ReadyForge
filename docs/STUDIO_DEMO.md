# Studio Demo seed

A reproducible, development-only project for demonstrating the complete ReadyForge workflow,
including a real multi-track MP4 render through local FFmpeg.

## What it creates

| Entity | Value |
|---|---|
| Workspace | **ReadyForge Studio** |
| Project | **Studio Demo — Product Launch Film** (video, team, stage `final`) |
| Demo owner | `demo@readyforge.ai` / `demo1234` |
| Demo lead | `lead@readyforge.ai` / `demo1234` |
| Knowledge ledger | 11 approved + 1 rejected input, including objective, audience, facts, pricing, legal, CTA and accessibility |
| Conflict Room | One high-severity pricing conflict, resolved by the owner with a recorded decision |
| Assets | Two generated 1280×720/30 fps MP4 clips and one WAV score, all licence-cleared and FFprobe-validated |
| Contract | v1, all approvals complete, locked |
| Composition | 3 tracks / 4 clips: two video clips with a fade-through-black transition, a faded audio bed and an animated title |
| Readiness | Recomputed through the real readiness engine; stored score and production authorization are genuine |

The source media is generated locally with FFmpeg and contains no third-party footage. The seed
**does not** create a render task, output asset, budget charge or fake success. The render must be
submitted from the editor and executed by the normal worker.

## Requirements

- Node 20+, dependencies installed (`npm install`)
- Local FFmpeg and FFprobe with `libx264` and AAC; set `FFMPEG_PATH` / `FFPROBE_PATH` if they are
  not on `PATH`
- A reachable MongoDB when running the standalone command (see below)
- Development/test environment only. With `NODE_ENV=production` the seed refuses to run.

## Run it

### Zero-config fresh local database (recommended for a first demo)

Leave `MONGODB_URI` empty and run the app from the repository root on a fresh `server/.data`
directory. The server auto-seeds only when the database has no users, and that seed includes this
Studio Demo together with the Inkloom campaign demo:

```bash
MONGODB_URI= SEED_ON_START=true npm run dev
```

This starts both the API and the web app. Watch for `[studio-demo] ... authorized=true` in the
API log. If the Studio Demo is skipped because FFmpeg is unavailable, install FFmpeg, restart, and
run `npm run seed` against the same database. Do not delete `server/.data` to reset a database you
care about; see [Reset](#reset).

### Configured MongoDB

Point `MONGODB_URI` at a running development MongoDB (for example a local `mongod` or an Atlas
development cluster), then run from the repository root:

```bash
npm run seed:studio
```

or, to seed the regular demo data plus Studio Demo:

```bash
npm run seed
```

The command is idempotent. Re-running it reuses users, workspace, project, ledger entries, conflict,
assets, contract and composition, and reconciles them to the demo's expected state. It never drops
a collection, deletes unrelated data, or overwrites a composition that already contains at least
three tracks and four clips, so edits made in the editor survive a re-seed. Existing media files
with the expected names are reused after FFprobe validation rather than regenerated.

> With the zero-config local fallback, the running API owns an ephemeral MongoDB that a standalone
> `npm run seed:studio` cannot discover. Use a configured `MONGODB_URI` when you want to seed a
> database separately from the API process.

## Open the demo

1. Sign in at http://localhost:5173/login with `demo@readyforge.ai` / `demo1234`.
2. Open **ReadyForge Studio** → **Studio Demo — Product Launch Film**.
3. Review **Knowledge**, **Conflicts**, **Assets**, **Rights**, **Readiness** and **Contract**
   (v1, locked, 2/2 approvals).
4. Open **Video editor**. The saved composition loads with the title, score and two picture clips.
5. Click **Render MP4**. The normal API/worker path revalidates production authorization and
   readiness, reserves and settles the zero-cost render budget, invokes local FFmpeg and stores
   the output as a protected project asset.
6. Wait for **Render status: succeeded**, then play the protected output in the editor or on the
   Assets page.

Rendered files are served only through `GET /api/assets/:id/file`, which requires an authorized
session. They are not available under `/uploads/` and are not public.

## Clean-environment rehearsal

Use a database that contains no users so the seed's first-run path is exercised. Keep a separate
development database or local data directory for this; do not point it at shared data.

1. Confirm `ffmpeg -version` and `ffprobe -version` succeed, including `libx264` and AAC support.
2. Start the API against the empty database with `SEED_ON_START=true`, or run
   `npm run seed:studio` against that database.
3. Confirm the log reports a newly created workspace/project, `authorized=true`, three tracks and
   four clips. A skipped Studio Demo is a failure, not a successful seed.
4. Start the web app and sign in as `demo@readyforge.ai` / `demo1234`.
5. Walk the Knowledge, Conflicts, Assets, Rights, Readiness and Contract pages before opening the
   editor.
6. Submit **Render MP4** from the editor, wait for the task to succeed, and play the output.
7. Verify the output asset through the authorized endpoint and confirm it is not served under
   `/uploads/`. This confirms the worker and the protected asset path, not just the UI message.

## Troubleshooting

- **Studio Demo missing after startup:** check the API log for a `[studio-demo]` warning. The
  most common cause is missing FFmpeg/FFprobe. Install them and run `npm run seed` or
  `npm run seed:studio`; the seed is safe to repeat.
- **`npm run seed:studio` cannot find the database:** the zero-config fallback database belongs
  to the running API process. Use a configured `MONGODB_URI` for a standalone seed.
- **Render unavailable:** the API returns `501` when FFmpeg/FFprobe or required encoders cannot be
  resolved. Check `FFMPEG_PATH` / `FFPROBE_PATH` and the render-tools endpoint.
- **Composition changed by the seed:** the seed preserves an existing composition with at least
  three tracks and four clips. If you want the original demo composition back, use a fresh demo
  database rather than editing the existing one in place.

## Reset

There is no script that deletes only the demo records. To rehearse from scratch, use a separate
development database and data directory. For the zero-config local fallback, stop the API, move
`server/.data` aside (do not delete it), and start again; move it back to restore the previous
data. Never drop shared collections or delete a database you do not own.
