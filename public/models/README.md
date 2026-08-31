# Local VLM weights

Put a transformers.js ONNX bundle here as `lfm25vl-opencal/` so the app loads it from this origin instead of Hugging Face.

Until ONNX export is in place, run the PyTorch checkpoint locally:

```bash
/home/zclarke/ml_env/bin/python scripts/finetune/serve.py
npm run dev
```

Vite proxies `/vlm` to that server. The PWA then uses the fine-tune without downloading `onnx-community/LFM2.5-VL-450M-ONNX`.
