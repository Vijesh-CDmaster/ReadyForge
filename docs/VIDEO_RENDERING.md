# Local video rendering (FFmpeg)

ReadyForge renders saved timeline compositions to MP4 on the machine that runs the
API server. Rendering uses **FFmpeg** and **FFprobe** only: no paid API, cloud
renderer, subscription, or usage-based service is involved.

The ReadyForge runtime never downloads or installs FFmpeg, never changes system
settings, and never writes to your `.env` file. If the tools are missing, the rest
of ReadyForge keeps working and rendering is reported as unavailable.

## Build used for genuine verification

A project-local Windows build was downloaded and checksum-verified for the
genuine end-to-end test:

- Source: BtbN FFmpeg-Builds `ffmpeg-master-latest-win64-gpl.zip`
- Archive SHA-256: `972353c4f65297b3ff1bfb8e6426ef04188c8883346797acdd3cd17fc2017c6b`
  (matched the publisher's `checksums.sha256`)
- Version: `N-128198-g37515cfd87-20261029`
- Configuration includes `--enable-gpl --enable-version3 --enable-libx264`
  and `--disable-libfdk-aac`
- Paths used: `tools/ffmpeg/bin/ffmpeg.exe` and
  `tools/ffmpeg/bin/ffprobe.exe`
- `ffmpeg.exe` SHA-256:
  `1e98ddd581fd41b15ae96039bb07a3e58a3b66faf0fbd9598a68b290a4a9ae85`
- `ffprobe.exe` SHA-256:
  `d8af8cce41ededb03a2fd9df2b090b1f5473c72f07b7cd033100cc194de7c4c2`

The `tools/ffmpeg/` directory is ignored by Git so these binaries are not
committed or redistributed with the source tree.

## What the renderer supports

- Multiple stacked video tracks. Tracks render from the lowest `order` upward;
  later (higher-order) tracks are overlaid on top. Gaps are filled with black, and
  each clip's timeline position and source trim are preserved.
- Multiple audio tracks. Clips are trimmed, delayed to their timeline position,
  padded to the render duration, and mixed into one AAC stream. Muted audio tracks
  and hidden video tracks are excluded explicitly.
- Text/overlay tracks. Text clips are burned into the video with FFmpeg
  `drawtext` between their own timeline start and end, so several overlays can be
  visible at once and later ones follow their own interval.
- Clips with trusted positive duration metadata. Uploaded video/audio files are
  probed with FFprobe and their duration is stored on the asset, so imported media
  can be trimmed and rendered without manual metadata entry.
- Output: MP4 container, H.264 (`libx264`) video at 1280×720 / 30 fps, AAC audio
  at 48 kHz stereo when the composition contains audio.
- Each render runs in an isolated temporary directory under `server/.data/renders/`.
  Staged media, per-clip font/text files, and failed outputs are deleted; successful
  outputs are stored as protected project assets.

Transitions, blend modes, and GPU encoding are not part of this phase.

## Text, titles, and subtitles

Text clips carry content, timeline start/end, normalized x/y/width, alignment, font
family, size, colour, background colour and opacity, text opacity, bold, italic,
shadow, outline, and z-index. Values are validated server-side: colours must be
`#RRGGBB`, every number must be finite and within range, and content is capped at
1,000 characters. Clips are drawn only between their own start and end, ordered by
`zIndex` and then track/clip order.

Fonts are never user paths. A clip picks one approved family (`sans`, `serif`,
`mono`), which the server resolves to a known file in `tools/fonts/` or a standard
system font directory and copies into the render's temporary directory. Text is
written to a per-clip file and passed as `textfile=` with `expansion=none`, so user
content is never interpolated into the filter graph or a shell command. If no
approved font or no `drawtext` filter is available, the render fails with a clear
message instead of silently dropping text; `drawtext` needs an FFmpeg build with
libfreetype (the bundled GPL build has it).

`POST /api/subtitles/parse` accepts raw SRT text (≤200,000 characters, ≤1,000
cues), validates every timing line, strips markup and control characters, and
returns cues. The editor converts them into timed text clips, which are then burned
in by the same renderer.

The editor preview renders the same text clips as absolutely positioned HTML over
the video using the same 1280×720 geometry, colours, weight, style, outline, shadow,
and wrapping. It is a close approximation, not pixel-identical: browser text layout,
camera scaling, and FFmpeg's own layout can differ by a few pixels per line.

## Install FFmpeg manually (Windows)

1. Download a Windows build from an official FFmpeg distribution link listed at
   <https://ffmpeg.org/download.html>, for example a GPL build from
   <https://www.gyan.dev/ffmpeg/builds/> or <https://github.com/BtbN/FFmpeg-Builds/releases>.
2. Extract the archive to a stable location, for example `C:\ffmpeg`.
3. Confirm these two files exist:
   - `C:\ffmpeg\bin\ffmpeg.exe`
   - `C:\ffmpeg\bin\ffprobe.exe`
4. Choose one configuration method:
   - **PATH:** add `C:\ffmpeg\bin` to your user `Path` environment variable and
     restart the terminal/API server.
   - **Explicit paths (recommended):** set `FFMPEG_PATH` and `FFPROBE_PATH` in
     `server/.env` (or the root `.env` used by your deployment). Keep that file
     out of version control.

Example local configuration (generic paths only, safe to adapt):

```dotenv
FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=C:/ffmpeg/bin/ffprobe.exe
VIDEO_RENDER_TIMEOUT_MS=300000
```

For a one-off PowerShell session instead of editing a file:

```powershell
$env:FFMPEG_PATH = "C:\ffmpeg\bin\ffmpeg.exe"
$env:FFPROBE_PATH = "C:\ffmpeg\bin\ffprobe.exe"
```

On macOS/Linux, installing through your package manager is fine, or point the
variables at the binaries (for example `/usr/bin/ffmpeg`). Do not commit a path
that only exists on one machine; rely on PATH or deployment-specific environment
variables instead.

## Verify the installation

```powershell
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -encoders | findstr "libx264 aac"
```

To run the genuine end-to-end verification against a project-local build:

```powershell
$env:FFMPEG_PATH = "$PWD\tools\ffmpeg\bin\ffmpeg.exe"
$env:FFPROBE_PATH = "$PWD\tools\ffmpeg\bin\ffprobe.exe"
npx tsx scripts/verify-render.ts
```

The script uses an isolated in-memory MongoDB, the real HTTP API, the real
`VideoJobWorker`, real FFmpeg encoding, protected asset retrieval, and FFprobe
inspection. It writes the retrieved MP4 and a `result.json` under
`server/.data/verify-render-<timestamp>/`.

The last command must list `libx264` and `aac`. ReadyForge performs the same checks
at runtime:

- `GET /api/video-render/tools` (authenticated) returns availability, resolved
  executable names, versions, and an actionable message.
- `POST /api/projects/:id/renders` returns **501** with the same explanation when
  rendering is unavailable.
- Queued jobs fail with a clear error if the toolchain disappears before the
  worker runs them. ReadyForge never fabricates a placeholder MP4.

The editor disables **Render MP4** and shows the setup message when the server
reports that rendering is unavailable.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FFMPEG_PATH` | `ffmpeg` (PATH) | Full path or command name for FFmpeg. |
| `FFPROBE_PATH` | `ffprobe` (PATH) | Full path or command name for FFprobe. |
| `VIDEO_RENDER_TIMEOUT_MS` | `300000` | Hard per-render timeout; the process is terminated when exceeded. |

Configured values are validated by running `-version`. A path that does not exist,
is not executable, points at the wrong tool, or reports no recognizable version is
reported as invalid. No environment values beyond the executable paths are shown in
the API response or logs.

## Licensing considerations

ReadyForge invokes FFmpeg as a **separate executable**; it does not link FFmpeg
libraries into the application. You are responsible for the license of the build
you install and for any redistribution of that binary.

- **FFmpeg core** is licensed under the **LGPL v2.1 or later** by default. A build
  configured with `--enable-gpl` is licensed under the **GPL v2 or later**;
  adding `--enable-version3` selects **GPL v3** terms.
- **libx264** (H.264 encoding) is **GPL v2 or later**. FFmpeg must be built with
  `--enable-gpl --enable-libx264` to include it, so the resulting binary is a GPL
  build. Common Windows "GPL" builds from gyan.dev and BtbN include it.
- **FFmpeg's native AAC encoder** is part of FFmpeg and is available under the
  LGPL build terms. `libfdk_aac` is a separate **non-free** component; this project
  does not require it, and the verified BtbN build explicitly disables it.
- The verified build used `--enable-gpl --enable-version3`, so the combined
  `ffmpeg.exe` is a **GPLv3** binary because it includes GPL libx264. The separate
  `ffprobe.exe` is from the same build and carries the same build terms.
- Some LGPL-only builds omit `libx264`. ReadyForge detects that and reports
  rendering as unavailable rather than silently producing a non-H.264 file.

If you distribute ReadyForge together with an FFmpeg binary, comply with that
binary's GPL/LGPL obligations (including source availability). If you only instruct
users to install FFmpeg themselves, their installation is separate from ReadyForge.

## Text animations

Text clips may carry a versioned animation model (`animation.version: 1`) with an
entrance and/or exit:

| Slot | Types |
| --- | --- |
| Entrance | `fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom`, `zoom`, `pop` |
| Exit | `fade`, `slide-left`, `slide-right`, `slide-top`, `slide-bottom`, `zoom` |

Each slot has a duration (0.05–10 s), a delay (0–10 s), and an easing curve
(`linear`, `ease-in`, `ease-out`, `ease-in-out`). Delay plus duration must fit
inside the clip; the save API and the renderer both enforce that.

Animations are pure functions of absolute timeline time:

- `fade` becomes a `drawtext` `alpha=` expression built from the clip start/end and
the easing formula.
- `slide-*` becomes `x`/`y` expressions whose pixel offset travels from one frame
edge to zero (or zero to the edge on exit).
- `zoom`/`pop` scale glyphs, which `drawtext` cannot express, so the text is drawn
once on a transparent 2560×1440 layer and animated with `zoompan` before being
composited. `pop` overshoots to 1.08× before settling.

Because nothing accumulates per frame, seeking, pausing, and re-rendering always
produce the same frame. A text clip with no animation keeps the exact drawtext path
it had before, so its output is unchanged.

## Video transitions

A transition is declared on the **incoming** clip (`clip.transitionIn`) and applies
between that clip and the one ending exactly where it starts on the same track.
The editor only offers a transition when such a neighbour exists.

| Type | FFmpeg implementation |
| --- | --- |
| `crossfade` | incoming alpha `fade` over the outgoing picture |
| `fade-black` | outgoing alpha out, incoming alpha in, black base between |
| `fade-white` | the same two alphas plus a white layer that peaks at the cut |
| `wipe-left` / `wipe-right` | a static gradient compared against a white source that fades up, producing a moving wipe mask fed to `alphamerge` |
| `slide-left` / `slide-right` | the incoming layer's overlay `x` expression travels across the frame |

Timeline offsets are preserved exactly: the transition happens inside the incoming
clip's timeline span while the outgoing clip keeps showing underneath, using its
source handle when one exists and otherwise holding its final frame. Audio is never
shifted, so audio/video sync is unaffected. A transition that is longer than either
neighbour, does not sit at a shared cut, or uses an unknown type fails validation
instead of being ignored.

## Audio gain, fades, and volume

Audio clips accept `volume` (0–2), `fadeInSeconds`, and `fadeOutSeconds`; the two
fades must fit inside the clip. Audio tracks accept a linear `volume` (0–2) that
multiplies every clip on the track. Rendering applies `volume`, `afade` in/out, then
the existing timeline delay, padding, and `amix` with `alimiter=limit=0.95` so mixed
tracks are less likely to clip. Muted tracks are skipped as before.

A delayed clip is padded to the full timeline length but never trimmed back to
`[0, duration]` afterwards: a trailing `atrim` after `adelay` drops every sample
after the offset and silently mutes any clip that starts later on the timeline. A
renderer regression test asserts that this trim stays out of the audio chain.

## Preview parity

The editor preview evaluates the same animation functions against the absolute
playhead: opacity, pixel offset, and scale are derived per render, never from CSS
timers. Transitions are previewed by stacking the outgoing clip's video under the
incoming one with an alpha, `clip-path`, or translate effect plus a black/white
flash overlay.

Known differences from the render:

- FFmpeg re-samples text with its own layout; the browser uses HTML text metrics, so
wrapping and glyph positions can differ by a few pixels.
- The preview composites at viewport resolution rather than 1280×720 and cannot show
more than two clips at once.
- Audio tracks are not played by the preview, so volume and fade values are edited
but not auditioned in the browser.

## Operational and concurrency notes

- Rendering is CPU-bound and runs inside the existing `VideoJobWorker`; one job is
  processed at a time per server process.
- The worker renews its lease every 10 seconds while FFmpeg runs, so renders longer
  than the 30-second lease remain claimed by the active worker.
- If a worker process dies mid-render, the lease expires and another worker may
  recover the job. Output publication is guarded by the lease plus an
  `outputAssetId`-absent condition, and a newly created asset is deleted if
  publication loses the race, so a duplicate file is not left behind.
- Budget settlement is idempotent per reservation. If settlement succeeds but the
  final task update fails, the job requires manual reconciliation and the orphaned
  output asset is removed.
- Two server instances may briefly render the same recovered job (wasted CPU), but
  only one can publish its output; the other removes its file.
