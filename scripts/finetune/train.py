#!/usr/bin/env python3
"""Full (or LoRA) SFT of LiquidAI/LFM2.5-VL-450M on the OpenCal mix.

Uses the model's chat template. Label masking keeps loss on assistant tokens only.
Text and image examples are batched separately so collate stays homogeneous.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset, Sampler
from transformers import AutoModelForImageTextToText, AutoProcessor, get_cosine_schedule_with_warmup

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "evals" / "data" / "finetune"
DEFAULT_OUT = DATA / "ckpts" / "lfm25vl-opencal"


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


class MixDataset(Dataset):
    def __init__(self, rows: list[dict]):
        self.rows = rows

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int) -> dict:
        return self.rows[idx]


class HomogeneousSampler(Sampler[list[int]]):
    def __init__(self, has_image: list[bool], batch_size: int, shuffle: bool, seed: int):
        self.text = [i for i, h in enumerate(has_image) if not h]
        self.image = [i for i, h in enumerate(has_image) if h]
        self.batch_size = batch_size
        self.shuffle = shuffle
        self.seed = seed
        self.epoch = 0

    def __iter__(self):
        rng = random.Random(self.seed + self.epoch)
        def batches(idxs: list[int]) -> list[list[int]]:
            order = list(idxs)
            if self.shuffle:
                rng.shuffle(order)
            return [order[i : i + self.batch_size] for i in range(0, len(order), self.batch_size) if order[i : i + self.batch_size]]

        all_b = batches(self.text) + batches(self.image)
        if self.shuffle:
            rng.shuffle(all_b)
        yield from all_b

    def __len__(self) -> int:
        bs = self.batch_size
        return math.ceil(len(self.text) / bs) + math.ceil(len(self.image) / bs)


def messages_for_processor(row: dict) -> list[dict]:
    out = []
    image_path = row.get("image")
    image = Image.open(image_path).convert("RGB") if image_path else None
    for msg in row["messages"]:
        role = msg["role"]
        text = msg["content"]
        if role == "user" and image is not None:
            out.append(
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": image},
                        {"type": "text", "text": text},
                    ],
                }
            )
        else:
            out.append({"role": role, "content": [{"type": "text", "text": text}]})
    return out


def make_collate(processor, max_length: int):
    tok = processor.tokenizer
    pad_id = tok.pad_token_id
    if pad_id is None:
        tok.pad_token = tok.eos_token
        pad_id = tok.pad_token_id

    def collate(rows: list[dict]) -> dict:
        convos = [messages_for_processor(r) for r in rows]
        try:
            batch = processor.apply_chat_template(
                convos,
                tokenize=True,
                add_generation_prompt=False,
                return_dict=True,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=max_length,
            )
        except TypeError:
            batch = processor.apply_chat_template(
                convos,
                tokenize=True,
                add_generation_prompt=False,
                return_dict=True,
                return_tensors="pt",
            )

        input_ids = batch["input_ids"]
        labels = input_ids.clone()
        assistant = tok.encode("<|im_start|>assistant\n", add_special_tokens=False)
        for i in range(input_ids.size(0)):
            ids = input_ids[i].tolist()
            start = 0
            for pos in range(len(ids) - len(assistant), -1, -1):
                if ids[pos : pos + len(assistant)] == assistant:
                    start = pos + len(assistant)
                    break
            labels[i, :start] = -100
            if pad_id is not None:
                labels[i][input_ids[i] == pad_id] = -100
        batch["labels"] = labels
        return batch

    return collate


def maybe_lora(model, rank: int):
    from peft import LoraConfig, get_peft_model

    cfg = LoraConfig(
        r=rank,
        lora_alpha=rank * 2,
        lora_dropout=0.05,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj", "fc1", "fc2", "linear"],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, cfg)
    model.print_trainable_parameters()
    return model


def run_epoch(model, loader, optimizer, scheduler, device, train: bool) -> float:
    model.train(train)
    total = 0.0
    n = 0
    for step, batch in enumerate(loader, 1):
        batch = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        with torch.set_grad_enabled(train):
            out = model(**batch)
            loss = out.loss
        if train:
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad(set_to_none=True)
        total += float(loss.detach())
        n += 1
        if train and step % 20 == 0:
            print(f"  step {step}/{len(loader)} loss {total / n:.4f} lr {scheduler.get_last_lr()[0]:.2e}", flush=True)
    return total / max(n, 1)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="LiquidAI/LFM2.5-VL-450M")
    p.add_argument("--train", default=str(DATA / "train.jsonl"))
    p.add_argument("--val", default=str(DATA / "val.jsonl"))
    p.add_argument("--out", default=str(DEFAULT_OUT))
    p.add_argument("--epochs", type=int, default=1)
    p.add_argument("--batch", type=int, default=4)
    p.add_argument("--lr", type=float, default=2e-5)
    p.add_argument("--max-length", type=int, default=768)
    p.add_argument("--lora", type=int, default=0, help="LoRA rank; 0 = full fine-tune")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--limit", type=int, default=0)
    args = p.parse_args()

    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_rows = read_jsonl(Path(args.train))
    val_rows = read_jsonl(Path(args.val)) if Path(args.val).exists() else []
    if args.limit:
        train_rows = train_rows[: args.limit]
        val_rows = val_rows[: max(1, args.limit // 10)]

    print(f"train {len(train_rows)} · val {len(val_rows)} · device {device} · lora {args.lora or 'full'}")
    processor = AutoProcessor.from_pretrained(args.model, trust_remote_code=True, max_image_tokens=256)
    model = AutoModelForImageTextToText.from_pretrained(
        args.model,
        dtype=torch.bfloat16 if device.type == "cuda" else torch.float32,
        device_map="auto" if device.type == "cuda" else None,
        trust_remote_code=True,
    )
    if args.lora:
        model = maybe_lora(model, args.lora)
    model.gradient_checkpointing_enable()

    collate = make_collate(processor, args.max_length)
    train_ds = MixDataset(train_rows)
    has_image = [bool(r.get("image")) for r in train_rows]
    train_loader = DataLoader(
        train_ds,
        batch_sampler=HomogeneousSampler(has_image, args.batch, True, args.seed),
        collate_fn=collate,
        num_workers=0,
    )
    val_loader = None
    if val_rows:
        val_ds = MixDataset(val_rows)
        val_has = [bool(r.get("image")) for r in val_rows]
        val_loader = DataLoader(
            val_ds,
            batch_sampler=HomogeneousSampler(val_has, args.batch, False, args.seed),
            collate_fn=collate,
            num_workers=0,
        )

    params = [x for x in model.parameters() if x.requires_grad]
    optimizer = torch.optim.AdamW(params, lr=args.lr, weight_decay=0.01)
    steps = max(1, len(train_loader) * args.epochs)
    scheduler = get_cosine_schedule_with_warmup(optimizer, num_warmup_steps=max(1, steps // 20), num_training_steps=steps)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    best = 1e9
    for epoch in range(1, args.epochs + 1):
        print(f"epoch {epoch}/{args.epochs}", flush=True)
        if hasattr(train_loader.batch_sampler, "epoch"):
            train_loader.batch_sampler.epoch = epoch
        tr = run_epoch(model, train_loader, optimizer, scheduler, device, True)
        va = run_epoch(model, val_loader, optimizer, scheduler, device, False) if val_loader else tr
        print(f"  train {tr:.4f}  val {va:.4f}", flush=True)
        tag = out / f"epoch-{epoch}"
        tag.mkdir(exist_ok=True)
        model.save_pretrained(tag)
        processor.save_pretrained(tag)
        if va <= best:
            best = va
            model.save_pretrained(out)
            processor.save_pretrained(out)
            (out / "train_meta.json").write_text(
                json.dumps({"epoch": epoch, "train_loss": tr, "val_loss": va, "model": args.model, "lora": args.lora}, indent=2)
                + "\n"
            )
    print(f"saved {out}")


if __name__ == "__main__":
    main()
