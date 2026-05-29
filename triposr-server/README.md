# TripoSR Local Inference Server

A small FastAPI server that loads [TripoSR](https://github.com/VAST-AI-Research/TripoSR)
once and turns a single image into a textured GLB mesh over HTTP. Built for a
single-machine workflow (RTX 3070 Ti, 8 GB VRAM, Windows 11).

## Layout

```
triposr-server/
├── TripoSR/                 # cloned upstream repo (tsr/ package, run.py, requirements.txt)
├── venv/                    # Python 3.11 virtualenv (already created)
├── server.py                # the FastAPI inference server
├── requirements-server.txt  # server-only deps (fastapi, uvicorn, python-multipart)
├── start-server.bat         # activate venv + launch server
└── README.md                # this file
```

## Prerequisites

- A Python 3.11 virtualenv at `venv\` (already created).
- **PyTorch** — installed separately (CUDA build for the RTX 3070 Ti). This is
  installing in the background as part of setup; verify with
  `venv\Scripts\python -c "import torch; print(torch.cuda.is_available())"`.

## Install (remaining steps)

> Run all commands from this directory with the venv activated
> (`venv\Scripts\activate.bat`).

1. **torchmcubes** — installed separately. **TODO (handled outside this scaffold):**
   install the prebuilt `torchmcubes` wheel that matches your torch/CUDA version.
   It is the one dependency that does not install cleanly from source on Windows,
   which is why TripoSR's `requirements.txt` lists it as a `git+...` line. See the
   setup notes for the prebuilt wheel.

2. **TripoSR's own dependencies** — install everything *except* the
   `git+...torchmcubes` line (you handled that in step 1). Either edit
   `TripoSR\requirements.txt` to remove/comment the `torchmcubes` line, then:

   ```bat
   pip install -r TripoSR\requirements.txt
   ```

   This covers `omegaconf`, `Pillow`, `einops`, `transformers`, `trimesh`,
   `rembg`, `huggingface-hub`, `imageio[ffmpeg]`, `xatlas`, `moderngl`.

3. **Server-only dependencies:**

   ```bat
   pip install -r requirements-server.txt
   ```

## Run

- Double-click **`start-server.bat`**, or:

  ```bat
  venv\Scripts\python server.py
  ```

The server listens on **`http://127.0.0.1:8008`**.

### First run is slow

On the first request the server:

1. Downloads the TripoSR model from HuggingFace (`stabilityai/TripoSR`, ~1.7 GB,
   cached afterward) — this happens at startup.
2. Downloads the rembg background-removal model on first use.

Watch the console for `Model ready on cuda:0`. Until then `/health` reports
`model_loaded: false` and `/generate` returns **503**.

## API contract

### `GET /health`

Always returns **200** (so the editor can tell "server up but warming" from
"server down"):

```json
{ "status": "ok", "device": "cuda:0", "model_loaded": true }
```

### `POST /generate`

`multipart/form-data`:

| field              | type | default  | description                          |
| ------------------ | ---- | -------- | ------------------------------------ |
| `image`            | file | required | source image                         |
| `remove_bg`        | text | `true`   | run background removal (rembg)       |
| `mc_resolution`    | text | `256`    | marching-cubes resolution            |
| `foreground_ratio` | text | `0.85`   | foreground scale within the frame    |

**Response:** the GLB binary with `Content-Type: model/gltf-binary` and
`Content-Disposition: attachment; filename="generated.glb"`.

- **503** `{"error":"model still loading"}` — model not ready yet; poll `/health`.
- **500** `{"error":"<message>"}` — inference failed (full traceback in console).

Example:

```bat
curl -X POST http://127.0.0.1:8008/generate ^
  -F "image=@input.png" ^
  -F "remove_bg=true" ^
  -F "mc_resolution=256" ^
  -o generated.glb
```

## VRAM note (CUDA OOM)

On 8 GB cards, if you hit `CUDA out of memory`:

1. Lower the renderer chunk size in `server.py`:
   `model.renderer.set_chunk_size(8192)` → `4096` → `2048`.
2. Lower `mc_resolution` on the request: `256` → `128`.

The server already calls `torch.cuda.empty_cache()` between requests and runs
inference under `torch.no_grad()`.

## CPU fallback

If CUDA isn't available at startup, the server prints a warning and runs on CPU
(much slower) instead of crashing — `/health` will report `"device": "cpu"`.
