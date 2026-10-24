# ReadyForge AI Service — local, keyless

Everything here runs on your own machine. No OpenAI key, no external API.

## What it contains

| Path | Purpose |
|---|---|
| `train/train_nli.py` | Downloads the **MNLI** dataset (392k premise/hypothesis pairs, via Hugging Face `datasets` — no API key) and fine-tunes `distilbert-base-uncased` for entailment / neutral / contradiction. Saves to `models/nli-distilbert/`. |
| `app/main.py` | FastAPI service on port **8001**: an OpenAI-compatible `/v1/chat/completions` endpoint backed by a local open-weight LLM (`Qwen/Qwen2.5-0.5B-Instruct` by default), plus endpoints served by the trained model. |
| `models/` | Trained weights + `metrics.json` (created by training). |
| `data/` | Hugging Face download cache. |

## Endpoints

- `POST /v1/chat/completions` — OpenAI-compatible generation (questions, contract, script, storyboard)
- `POST /nli/conflict` — contradiction between two knowledge inputs (trained model)
- `POST /nli/conflict_batch` — batched contradiction scoring
- `POST /nli/verify` — claim vs approved evidence (trained model)
- `POST /nli/classify` — zero-shot project-type classification (trained model)
- `GET /health` — device, loaded models, training metrics

## Setup

```bash
cd ai-service
python -m venv .venv
.venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cu126   # Windows/CUDA
.venv/Scripts/python -m pip install -r requirements.txt
```

## Train the model (once)

```bash
.venv/Scripts/python train/train_nli.py --max-train-samples 60000 --epochs 2
```

Takes a few minutes on a GPU; works on CPU too (slower). `--max-train-samples 0` uses the full 392k dataset.

## Run

```bash
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

## Point the Node server at it

In `server/.env`:

```env
OPENAI_BASE_URL=http://127.0.0.1:8001/v1
OPENAI_API_KEY=local-no-key-needed
OPENAI_MODEL=Qwen/Qwen2.5-0.5B-Instruct
LOCAL_AI_URL=http://127.0.0.1:8001
```

The Node server fails soft if the service is down: it falls back to the deterministic
rule engine, so the app keeps working without any AI running.

## Swapping the local LLM

Set `LOCAL_LLM_MODEL` to any Hugging Face causal LM (e.g. `Qwen/Qwen2.5-1.5B-Instruct`
if you have the RAM/VRAM). First call downloads it (~1 GB for 0.5B).

## Disclaimer

Model outputs are assistance, not authority. The rights/compliance checks in ReadyForge
are decision support, not legal advice.