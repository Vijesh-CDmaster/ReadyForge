"""
ReadyForge local AI service.

Runs 100% offline — no API keys:

  * OpenAI-compatible chat endpoint backed by a local open-weight LLM
    (default Qwen2.5-0.5B-Instruct, a plain file download from Hugging Face),
    so the Node server can point OPENAI_BASE_URL here and generate questions,
    contracts and scripts with zero external keys.
  * Trained NLI endpoints (DistilBERT fine-tuned on MNLI by train/train_nli.py):
      /nli/conflict  - contradiction detection between two knowledge inputs
      /nli/verify    - claim verification against approved evidence
      /nli/classify  - zero-shot project-type classification

Run:
    uvicorn app.main:app --host 127.0.0.1 --port 8001
"""

import os
import time
from typing import List, Optional

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

LLM_MODEL_ID = os.environ.get("LOCAL_LLM_MODEL", "Qwen/Qwen2.5-0.5B-Instruct")
NLI_MODEL_DIR = os.environ.get("LOCAL_NLI_MODEL", os.path.join(ROOT, "models", "nli-distilbert"))
HF_CACHE = os.environ.get("LOCAL_HF_CACHE", os.path.join(ROOT, "data", "hf-cache"))

LABEL_NAMES = ["entailment", "neutral", "contradiction"]


def is_conflict(scores: List[float]) -> bool:
    """Per-direction conflict rule, calibrated on train/eval_domain.py.

    Argmax alone misses neutral-dominant contradictions ("free trial for everyone" vs
    "enterprise-only" scored 0.49/0.50/0.01), so: contradiction must be at least 0.45
    AND at least 4x the entailment mass. A pair only becomes a conflict when this
    holds in BOTH directions — see pair_is_conflict.
    """
    ent, _neutral, contr = scores[0], scores[1], scores[2]
    return bool(contr >= 0.45 and contr > 4 * ent)


def pair_is_conflict(fwd: List[float], rev: List[float]) -> bool:
    """A conflict must read as contradictory in BOTH directions.

    Measured on real project inputs: true contradictions score high both ways
    (0.96/0.96 "60 seconds vs cut to 15", 0.59/0.84 "trial for everyone vs
    enterprise-only"), while every false positive was one-directional — e.g.
    "Product name: Inkloom Campaign Planner" vs the CTA scored 0.02 forward but
    0.56 in reverse. Requiring both readings kills all nine false positives observed
    on the seeded project while keeping the real contradictions.
    """
    return is_conflict(fwd) and is_conflict(rev)

device = "cuda" if torch.cuda.is_available() else "cpu"

app = FastAPI(title="ReadyForge Local AI", version="1.0.0")

# Lazily populated model handles -------------------------------------------------
_nli = {"tokenizer": None, "model": None}
_llm = {"tokenizer": None, "model": None, "loaded": False, "error": None}


def _ensure_nli():
    if _nli["model"] is not None:
        return _nli
    if not os.path.isfile(os.path.join(NLI_MODEL_DIR, "config.json")):
        raise HTTPException(status_code=503, detail=f"NLI model not trained yet at {NLI_MODEL_DIR}. Run train/train_nli.py first.")
    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        _nli["tokenizer"] = AutoTokenizer.from_pretrained(NLI_MODEL_DIR)
        model = AutoModelForSequenceClassification.from_pretrained(NLI_MODEL_DIR)
        _nli["model"] = model.to(device).eval()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"local NLI model failed to load: {exc}") from exc
    return _nli


def _ensure_llm():
    if _llm["model"] is not None:
        return _llm
    from transformers import AutoModelForCausalLM, AutoTokenizer

    try:
        t0 = time.time()
        print(f"[ai] loading LLM {LLM_MODEL_ID} (first call only)...")
        _llm["tokenizer"] = AutoTokenizer.from_pretrained(LLM_MODEL_ID, cache_dir=HF_CACHE)
        try:
            model = AutoModelForCausalLM.from_pretrained(LLM_MODEL_ID, cache_dir=HF_CACHE, dtype=torch.float16 if device == "cuda" else torch.float32)
        except TypeError:  # older transformers used torch_dtype
            model = AutoModelForCausalLM.from_pretrained(LLM_MODEL_ID, cache_dir=HF_CACHE, torch_dtype=torch.float16 if device == "cuda" else torch.float32)
        _llm["model"] = model.to(device).eval()
        _llm["loaded"] = True
        print(f"[ai] LLM ready in {time.time() - t0:.1f}s on {device}")
    except Exception as exc:  # noqa: BLE001 - surfaced through /health and chat errors
        _llm["error"] = str(exc)
        raise HTTPException(status_code=503, detail=f"local LLM unavailable: {exc}") from exc
    return _llm


def _nli_scores(pairs: List[List[str]]) -> List[List[float]]:
    nli = _ensure_nli()
    enc = nli["tokenizer"]([p[0] for p in pairs], [p[1] for p in pairs], truncation=True, padding=True, max_length=256, return_tensors="pt")
    enc = {k: v.to(device) for k, v in enc.items()}
    with torch.inference_mode():
        logits = nli["model"](**enc).logits
    probs = torch.softmax(logits.float(), dim=-1).cpu().tolist()
    return probs


# --------------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: Optional[str] = None
    messages: List[ChatMessage]
    temperature: float = 0.2
    top_p: float = 0.95
    max_tokens: Optional[int] = 512
    stream: bool = False


class PairRequest(BaseModel):
    input_a: str = Field(..., alias="inputA")
    input_b: str = Field(..., alias="inputB")

    model_config = {"populate_by_name": True}


class BatchPairRequest(BaseModel):
    pairs: List[dict]


class VerifyRequest(BaseModel):
    claim: str
    evidence: str


class ClassifyRequest(BaseModel):
    text: str
    labels: List[str]
    hypothesis_template: Optional[str] = None


# --------------------------------------------------------------------------------
# Health / model listing
# --------------------------------------------------------------------------------
@app.get("/health")
def health():
    nli_ready = os.path.isfile(os.path.join(NLI_MODEL_DIR, "config.json"))
    metrics = None
    metrics_path = os.path.join(NLI_MODEL_DIR, "metrics.json")
    if os.path.isfile(metrics_path):
        import json

        with open(metrics_path, encoding="utf-8") as fh:
            metrics = json.load(fh)
    return {
        "status": "ok",
        "device": device,
        "llm_model": LLM_MODEL_ID,
        "llm_loaded": _llm["loaded"],
        "llm_error": _llm["error"],
        "nli_ready": nli_ready,
        "nli_metrics": metrics,
    }


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [
            {"id": LLM_MODEL_ID, "object": "model", "owned_by": "local", "readyforge": {"kind": "generation"}},
            {"id": "readyforge-nli-distilbert", "object": "model", "owned_by": "local", "readyforge": {"kind": "verification", "trained_on": "nyu-mll/glue/mnli"}},
        ],
    }


# --------------------------------------------------------------------------------
# OpenAI-compatible chat
# --------------------------------------------------------------------------------
@app.post("/v1/chat/completions")
def chat(req: ChatRequest):
    llm = _ensure_llm()
    tokenizer, model = llm["tokenizer"], llm["model"]

    try:
        prompt = tokenizer.apply_chat_template([m.model_dump() for m in req.messages], tokenize=False, add_generation_prompt=True)
    except Exception:
        prompt = "\n".join(f"{m.role}: {m.content}" for m in req.messages) + "\nassistant:"

    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=4096)
    inputs = {k: v.to(device) for k, v in inputs.items()}
    prompt_tokens = int(inputs["input_ids"].shape[-1])

    max_new = max(1, min(int(req.max_tokens or 512), 4096))
    do_sample = bool(req.temperature and req.temperature > 0)
    gen_kwargs = {
        "max_new_tokens": max_new,
        "do_sample": do_sample,
        "pad_token_id": tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id,
    }
    if do_sample:
        gen_kwargs["temperature"] = float(req.temperature)
        gen_kwargs["top_p"] = float(req.top_p or 0.95)

    t0 = time.time()
    with torch.inference_mode():
        output = model.generate(**inputs, **gen_kwargs)
    completion = tokenizer.decode(output[0][prompt_tokens:], skip_special_tokens=True)
    completion_tokens = int(output.shape[-1] - prompt_tokens)

    payload = {
        "id": f"chatcmpl-local-{int(time.time() * 1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model or LLM_MODEL_ID,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": completion}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "total_tokens": prompt_tokens + completion_tokens},
        "readyforge": {"backend": "local", "device": device, "seconds": round(time.time() - t0, 2)},
    }

    if req.stream:
        import json as _json

        def gen():
            first = {"choices": [{"index": 0, "delta": {"role": "assistant", "content": completion}, "finish_reason": None}]}
            yield f"data: {_json.dumps(first)}\n\n"
            yield f"data: {_json.dumps({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")

    return payload


# --------------------------------------------------------------------------------
# Trained-model endpoints
# --------------------------------------------------------------------------------
@app.post("/nli/conflict")
def conflict(req: PairRequest):
    if not req.input_a.strip() or not req.input_b.strip():
        raise HTTPException(status_code=400, detail="both inputs are required")
    probs = _nli_scores([[req.input_a, req.input_b], [req.input_b, req.input_a]])
    avg = [(probs[0][i] + probs[1][i]) / 2 for i in range(3)]
    label = LABEL_NAMES[int(max(range(3), key=lambda i: avg[i]))]
    return {
        "label": label,
        "is_conflict": pair_is_conflict(probs[0], probs[1]),
        "scores": {LABEL_NAMES[i]: round(avg[i], 4) for i in range(3)},
        "scores_forward": {LABEL_NAMES[i]: round(probs[0][i], 4) for i in range(3)},
        "scores_reverse": {LABEL_NAMES[i]: round(probs[1][i], 4) for i in range(3)},
        "model": "readyforge-nli-distilbert",
        "trained_on": "nyu-mll/glue/mnli",
    }


@app.post("/nli/conflict_batch")
def conflict_batch(req: BatchPairRequest):
    """Score many premise/hypothesis pairs in one forward pass (chunked for VRAM)."""
    pairs = []
    for p in req.pairs:
        a, b = str(p.get("a", "")).strip(), str(p.get("b", "")).strip()
        if a and b:
            pairs.append({"id": str(p.get("id", "")), "a": a, "b": b})
    if not pairs:
        return {"results": []}
    if len(pairs) > 400:
        raise HTTPException(status_code=400, detail="too many pairs (max 400)")

    results = []
    for start in range(0, len(pairs), 16):
        chunk = pairs[start : start + 16]
        scores = _nli_scores([[p["a"], p["b"]] for p in chunk] + [[p["b"], p["a"]] for p in chunk])
        half = len(chunk)
        for i, p in enumerate(chunk):
            fwd, rev = scores[i], scores[half + i]
            avg = [(fwd[k] + rev[k]) / 2 for k in range(3)]
            label = LABEL_NAMES[int(max(range(3), key=lambda k: avg[k]))]
            results.append(
                {
                    "id": p["id"],
                    "label": label,
                    "is_conflict": pair_is_conflict(fwd, rev),
                    "scores": {LABEL_NAMES[k]: round(avg[k], 4) for k in range(3)},
                    "scores_forward": {LABEL_NAMES[k]: round(fwd[k], 4) for k in range(3)},
                    "scores_reverse": {LABEL_NAMES[k]: round(rev[k], 4) for k in range(3)},
                    "model": "readyforge-nli-distilbert",
                }
            )
    return {"results": results}


@app.post("/nli/verify")
def verify(req: VerifyRequest):
    if not req.claim.strip() or not req.evidence.strip():
        raise HTTPException(status_code=400, detail="claim and evidence are required")
    # premise = evidence, hypothesis = claim: entailment means the evidence supports the claim
    probs = _nli_scores([[req.evidence, req.claim]])[0]
    if probs[0] >= 0.55:
        verdict = "supported"
    elif probs[2] >= 0.55:
        verdict = "refuted"
    else:
        verdict = "not_enough_evidence"
    return {
        "verdict": verdict,
        "scores": {LABEL_NAMES[i]: round(probs[i], 4) for i in range(3)},
        "model": "readyforge-nli-distilbert",
        "trained_on": "nyu-mll/glue/mnli",
    }


@app.post("/nli/classify")
def classify(req: ClassifyRequest):
    if not req.labels:
        raise HTTPException(status_code=400, detail="labels are required")
    template = req.hypothesis_template or "This is a {label} project."
    pairs = [[req.text, template.format(label=label)] for label in req.labels]
    probs = [p[0] for p in _nli_scores(pairs)]  # entailment column per label
    total = sum(probs) or 1.0
    ranked = sorted(
        [{"label": req.labels[i], "score": round(probs[i] / total, 4)} for i in range(len(req.labels))],
        key=lambda x: x["score"],
        reverse=True,
    )
    return {"prediction": ranked[0]["label"], "ranked": ranked, "model": "readyforge-nli-distilbert", "trained_on": "nyu-mll/glue/mnli"}