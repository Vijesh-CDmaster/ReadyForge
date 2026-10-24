"""
Domain sanity check for the trained NLI model.

MNLI is general-purpose; ReadyForge feeds it short business statements. This script
scores realistic input pairs from the product (contradictions and non-contradictions)
so we can see whether the trained model separates them and calibrate the conflict
threshold on evidence rather than guessing.

It imports the decision rule straight from app.main, so the numbers below are exactly
what the /nli/conflict endpoints will decide — no drift between harness and service.

Usage:  PYTHONUTF8=1 python train/eval_domain.py
"""

import os
import sys

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL_DIR = os.environ.get("LOCAL_NLI_MODEL", os.path.join(ROOT, "models", "nli-distilbert"))
sys.path.insert(0, ROOT)

from app.main import pair_is_conflict  # noqa: E402  (needs ROOT on path)

LABELS = ["entailment", "neutral", "contradiction"]

# (premise, hypothesis, expected) — expected is what ReadyForge should decide.
PAIRS = [
    # --- contradictions the demo depends on ---
    ("Offer a free trial to everyone.", "The free trial is enterprise-only.", "contradiction"),
    ("The Pro plan costs ₹1499 per month.", "The Pro plan costs ₹999 per month.", "contradiction"),
    ("Target audience is small business owners.", "This campaign targets enterprise procurement teams.", "contradiction"),
    ("The tone is playful and casual.", "Keep the tone strictly professional and formal.", "contradiction"),
    ("We guarantee results in 14 days.", "We cannot guarantee any results.", "contradiction"),
    ("The launch video runs 60 seconds.", "The video must be cut to 15 seconds.", "contradiction"),
    ("Billing is monthly.", "Billing is annual only.", "contradiction"),
    ("Our espresso machine brews in 3 seconds.", "Brewing takes 45 seconds.", "contradiction"),
    # --- non-contradictions (should NOT be flagged) ---
    ("The launch video runs 60 seconds.", "The video publishes on 15 March.", "neutral"),
    ("Target audience is small business owners.", "The CTA is 'Start your free trial'.", "neutral"),
    ("The tone is playful and casual.", "Primary colour is deep green.", "neutral"),
    ("Free trial lasts 14 days.", "Enterprise customers can start a free trial.", "entailment"),
    ("The Pro plan costs ₹1499 per month.", "Pricing is billed monthly in rupees.", "entailment"),
    ("Music must be royalty-free.", "Licensed stock audio is allowed.", "neutral"),
    ("Budget is ₹50,000 total.", "The deadline is 30 November.", "neutral"),
    ("Use the approved brand font.", "Apply the brand typography rules.", "entailment"),
]


def main() -> int:
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    if not os.path.isfile(os.path.join(MODEL_DIR, "config.json")):
        print(f"model not found at {MODEL_DIR} — run train/train_nli.py first")
        return 1

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR).to(device).eval()

    def score(premises, hypotheses):
        enc = tokenizer(premises, hypotheses, truncation=True, padding=True, max_length=256, return_tensors="pt")
        enc = {k: v.to(device) for k, v in enc.items()}
        with torch.inference_mode():
            return torch.softmax(model(**enc).logits.float(), dim=-1).cpu()

    fwd = score([p[0] for p in PAIRS], [p[1] for p in PAIRS])
    rev = score([p[1] for p in PAIRS], [p[0] for p in PAIRS])

    print(f"{'contrF':>7} {'contrR':>7} {'min':>6} {'predicted':<13} {'expected':<13} result  pair")
    print("-" * 118)
    hits = 0
    flagged = 0
    expected_conflicts = 0
    for i, (a, b, expected) in enumerate(PAIRS):
        is_conflict = pair_is_conflict(fwd[i].tolist(), rev[i].tolist())
        pred = LABELS[int(fwd[i].argmax())]
        if expected == "contradiction":
            expected_conflicts += 1
            if is_conflict:
                flagged += 1
        ok = is_conflict == (expected == "contradiction")
        hits += int(ok)
        mark = "OK  " if ok else "MISS"
        print(
            f"{fwd[i][2]:7.3f} {rev[i][2]:7.3f} {min(fwd[i][2], rev[i][2]):6.3f} {pred:<13} {expected:<13} {mark}  {a} / {b}"
        )

    print("-" * 118)
    print(f"decision accuracy: {hits}/{len(PAIRS)}   contradictions flagged: {flagged}/{expected_conflicts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())