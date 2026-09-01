"""Three-way: v4 (LoRA), base LFM, and GPT-5.5, same prompt, same image(s)."""
import sys, json, base64, os
import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor
sys.path.insert(0, "scripts/finetune")
from prompts import GRAM_SYSTEM, GRAM_IMAGE_USER
from infer import generate, parse_foods, EXTRACT_PREFIX

V4   = "evals/data/finetune/ckpts/lfm25vl-gram-v4-merged"
BASE = "evals/data/finetune/ckpts/lfm25vl-opencal"

def load(m):
    proc = AutoProcessor.from_pretrained(m, trust_remote_code=True, max_image_tokens=256)
    model = AutoModelForImageTextToText.from_pretrained(m, dtype=torch.bfloat16,
            device_map="auto", trust_remote_code=True).eval()
    return model, proc

def run_lfm(model, proc, img, device):
    msgs = [
        {"role":"system","content":[{"type":"text","text":GRAM_SYSTEM}]},
        {"role":"user","content":[{"type":"image","image":img},{"type":"text","text":GRAM_IMAGE_USER}]},
    ]
    raw = generate(model, proc, msgs, 220, device, EXTRACT_PREFIX)
    return [{"name":f.get("name"),"grams":f.get("grams")} for f in parse_foods(raw)]

def run_openai(img_path, model_name="gpt-5.5"):
    from openai import OpenAI
    c = OpenAI(api_key=open("/tmp/opencode/.openai_key").read().strip())
    b64 = base64.b64encode(os.path.expanduser(img_path).encode("latin-1")[:0] or open(os.path.expanduser(img_path),"rb").read()).decode()
    r = c.chat.completions.create(model=model_name, messages=[{"role":"user","content":[
        {"type":"text","text":GRAM_SYSTEM+"\n\n"+GRAM_IMAGE_USER},
        {"type":"image_url","image_url":{"url":f"data:image/jpeg;base64,{b64}"}},
    ]}])
    txt = r.choices[0].message.content.strip()
    if txt.startswith("```"): txt = txt.split("\n",1)[1].rsplit("```",1)[0]
    d = json.loads(txt)
    out = d.get("foods", d if isinstance(d,list) else [])
    return [{"name":f.get("name"),"grams":f.get("grams")} for f in out]

def fmt(foods):
    if not foods: return "  (none)"
    return "  " + ",  ".join(f"{f['name']} {f['grams']:g}g" for f in foods)

def main(paths):
    device = torch.device("cuda")
    print("loading v4 ...", flush=True);  m4,p4  = load(V4)
    print("loading base ...", flush=True); mb,pb = load(BASE)
    import os
    for p in paths:
        if not os.path.exists(p):
            print(f"\n(skipped, not found: {p})"); continue
        img = Image.open(p).convert("RGB")
        print("\n" + "="*70)
        print(p)
        print("="*70)
        try: v4 = run_lfm(m4,p4,img,device)
        except Exception as e: v4 = [{"name":f"ERR: {e}","grams":0}]
        try: base = run_lfm(mb,pb,img,device)
        except Exception as e: base = [{"name":f"ERR: {e}","grams":0}]
        print("v4 (OpenCal LoRA):"); print(fmt(v4))
        print("base LFM:");          print(fmt(base))
        try:
            oai = run_openai(p)
        except Exception as e: oai = [{"name":f"ERR: {e}","grams":0}]
        print("GPT-5.5:");           print(fmt(oai))

if __name__ == "__main__":
    main(sys.argv[1:])
