# Local VLM weights

The app is purely on-device: it loads a transformers.js ONNX bundle from this origin
(as `lfm25vl-opencal/`) when present, otherwise from Hugging Face (`opencal/opencal-base`).
There is no backend or HTTP VLM server.

To serve a fine-tuned checkpoint in the browser, export it to ONNX and drop the
bundle in `public/models/lfm25vl-opencal/` (see `scripts/finetune/export.py`).
`npx vite build` then ships it with the PWA.
