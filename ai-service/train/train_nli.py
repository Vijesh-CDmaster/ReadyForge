"""
ReadyForge — NLI training.

Downloads the MNLI dataset (Glue/MNLI, 392k premise-hypothesis pairs) from the
Hugging Face Hub and fine-tunes distilbert-base-uncased for 3-way inference:
    0 = entailment, 1 = neutral, 2 = contradiction

One trained model powers three ReadyForge features:
  * conflict detection  -> premise/input A, hypothesis/input B -> "contradiction"
  * claim verification  -> claim vs approved fact -> "entailment" / "contradiction"
  * project classification -> zero-shot via hypothesis scoring

No API keys: the dataset and the base weights are plain file downloads.

Usage:
    python train/train_nli.py --max-train-samples 60000 --epochs 2
"""

import argparse
import json
import os
import sys
import time

import numpy as np
import torch
from datasets import load_dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    EarlyStoppingCallback,
    Trainer,
    TrainingArguments,
)

BASE_MODEL = "distilbert-base-uncased"
DATASET_NAME = "nyu-mll/glue"
DATASET_CONFIG = "mnli"
LABEL_NAMES = ["entailment", "neutral", "contradiction"]


def pick_device() -> str:
    if torch.cuda.is_available():
        name = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        print(f"[train] GPU: {name} ({vram:.1f} GiB)")
        return "cuda"
    print("[train] no CUDA GPU found, training on CPU")
    return "cpu"


def main() -> int:
    parser = argparse.ArgumentParser(description="Fine-tune DistilBERT on MNLI")
    parser.add_argument("--max-train-samples", type=int, default=60000)
    parser.add_argument("--max-eval-samples", type=int, default=5000)
    parser.add_argument("--epochs", type=float, default=2)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--max-len", type=int, default=128)
    parser.add_argument("--out", type=str, default=os.path.join(os.path.dirname(__file__), "..", "models", "nli-distilbert"))
    parser.add_argument("--hf-cache", type=str, default=os.path.join(os.path.dirname(__file__), "..", "data", "hf-cache"))
    args = parser.parse_args()

    device = pick_device()
    out_dir = os.path.abspath(args.out)
    os.makedirs(args.hf_cache, exist_ok=True)

    print("[train] downloading MNLI dataset (one-time, ~350 MB)...")
    t0 = time.time()
    raw = load_dataset(DATASET_NAME, DATASET_CONFIG, cache_dir=args.hf_cache)
    print(f"[train] dataset ready in {time.time() - t0:.0f}s: { {k: len(v) for k, v in raw.items()} }")

    train_ds = raw["train"].shuffle(seed=42).select(range(min(args.max_train_samples, len(raw["train"]))))
    eval_matched = raw["validation_matched"].shuffle(seed=42).select(
        range(min(args.max_eval_samples, len(raw["validation_matched"])))
    )
    eval_mismatched = raw["validation_mismatched"].shuffle(seed=42).select(
        range(min(args.max_eval_samples, len(raw["validation_mismatched"])))
    )

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, cache_dir=args.hf_cache)
    model = AutoModelForSequenceClassification.from_pretrained(
        BASE_MODEL, num_labels=3, id2label={i: n for i, n in enumerate(LABEL_NAMES)}, label2id={n: i for i, n in enumerate(LABEL_NAMES)}, cache_dir=args.hf_cache
    )

    def preprocess(batch):
        return tokenizer(batch["premise"], batch["hypothesis"], truncation=True, max_length=args.max_len)

    train_ds = train_ds.map(preprocess, batched=True, remove_columns=["premise", "hypothesis"])
    eval_matched = eval_matched.map(preprocess, batched=True, remove_columns=["premise", "hypothesis"])
    eval_mismatched = eval_mismatched.map(preprocess, batched=True, remove_columns=["premise", "hypothesis"])

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = np.argmax(logits, axis=-1)
        return {"accuracy": float((preds == labels).mean())}

    steps = max(1, len(train_ds) // (args.batch_size * 4))
    total_steps = max(1, int((len(train_ds) // args.batch_size) * args.epochs))
    training_args = TrainingArguments(
        output_dir=os.path.join(out_dir, "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size * 2,
        learning_rate=args.lr,
        warmup_steps=max(1, int(total_steps * 0.1)),
        weight_decay=0.01,
        eval_strategy="steps",
        eval_steps=steps,
        save_strategy="steps",
        save_steps=steps,
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model="accuracy",
        logging_steps=25,
        fp16=device == "cuda",
        bf16=False,
        report_to=[],
        seed=42,
        dataloader_num_workers=0,
        remove_unused_columns=True,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=eval_matched,
        processing_class=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer),
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )

    print(f"[train] fine-tuning {BASE_MODEL} on {len(train_ds)} pairs, {args.epochs} epochs, device={device}")
    trainer.train()

    print("[train] evaluating...")
    matched = trainer.evaluate(eval_matched)
    mismatched = trainer.evaluate(eval_mismatched)

    # Sanity check on ReadyForge-shaped contradiction pairs.
    probes = [
        ("Everyone gets a free trial of the product.", "The free trial is available to enterprise customers only.", "contradiction"),
        ("Everyone gets a free trial of the product.", "Enterprise customers can start a free trial.", "entailment"),
        ("The launch video is 30 seconds long.", "The video will be published in March.", "neutral"),
    ]
    enc = tokenizer([p[0] for p in probes], [p[1] for p in probes], truncation=True, padding=True, return_tensors="pt").to(device)
    with torch.no_grad():
        logits = model(**enc).logits
    probs = torch.softmax(logits, dim=-1).cpu().numpy()
    probe_results = [
        {"premise": p[0], "hypothesis": p[1], "prediction": LABEL_NAMES[int(probs[i].argmax())], "expected": p[2], "probs": [round(float(x), 4) for x in probs[i]]}
        for i, p in enumerate(probes)
    ]

    trainer.save_model(out_dir)
    tokenizer.save_pretrained(out_dir)

    metrics = {
        "base_model": BASE_MODEL,
        "dataset": f"{DATASET_NAME}/{DATASET_CONFIG}",
        "train_samples": len(train_ds),
        "epochs": args.epochs,
        "device": device,
        "matched_accuracy": matched.get("eval_accuracy"),
        "mismatched_accuracy": mismatched.get("eval_accuracy"),
        "probes": probe_results,
    }
    with open(os.path.join(out_dir, "metrics.json"), "w", encoding="utf-8") as fh:
        json.dump(metrics, fh, indent=2)

    print(json.dumps(metrics, indent=2))
    print(f"[train] model saved to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())