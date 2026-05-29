"""
TripoSR local inference server.

A small FastAPI app that loads the TripoSR model once at startup and exposes
an HTTP API for turning a single image into a textured GLB mesh.

Endpoints:
    GET  /health    -> liveness + model-load status (always 200)
    POST /generate  -> multipart `image` field in, model/gltf-binary GLB out

Run:
    python server.py        # serves on 127.0.0.1:8008
"""

from __future__ import annotations

import io
import os
import sys
import tempfile
import traceback
from contextlib import asynccontextmanager
from typing import Optional

# --- Make the bundled TripoSR package importable -------------------------------
# The TripoSR repo (with its `tsr/` package) lives next to this file. Prepend it
# to sys.path so `from tsr.system import TSR` resolves without an install step.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "TripoSR"))

import torch  # noqa: E402  (import after sys.path tweak is intentional)
from PIL import Image  # noqa: E402

from fastapi import FastAPI, File, Form, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402

from tsr.system import TSR  # noqa: E402
from tsr.utils import remove_background, resize_foreground  # noqa: E402
import rembg  # noqa: E402


# --- Module globals (loaded once) ----------------------------------------------
# These are populated by the lifespan startup handler and reused across requests.
model: Optional[TSR] = None
rembg_session = None  # rembg.new_session() result; expensive, create once.
device: str = "cpu"
model_loaded: bool = False


def _load_model() -> None:
    """
    Load the TripoSR model and the rembg background-removal session ONCE.

    Degrades to CPU with a warning if CUDA is not available, and never raises
    on a missing GPU — the server should still come up so /health can report
    its state.
    """
    global model, rembg_session, device, model_loaded

    # Pick the best available device. Be defensive: torch.cuda.is_available()
    # can be False if drivers/CUDA aren't ready yet — degrade to CPU loudly.
    if torch.cuda.is_available():
        device = "cuda:0"
        print(f"[startup] CUDA available -> using device {device}")
    else:
        device = "cpu"
        print("[startup] WARNING: CUDA not available -> falling back to CPU "
              "(inference will be slow).")

    print("[startup] Loading TripoSR model (auto-downloads ~1.7 GB on first run)...")
    loaded = TSR.from_pretrained(
        "stabilityai/TripoSR",
        config_name="config.yaml",
        weight_name="model.ckpt",
    )

    # Chunk size trades VRAM for speed. 8192 is fine on most 8 GB cards; lower
    # to 4096 / 2048 if you hit CUDA OOM. (See README VRAM note.)
    loaded.renderer.set_chunk_size(8192)
    loaded.to(device)

    # Build the rembg session up front — new_session() is expensive and would
    # otherwise be paid on every request that does background removal.
    print("[startup] Initializing rembg background-removal session...")
    session = rembg.new_session()

    # Publish to module globals only after everything succeeded.
    model = loaded
    rembg_session = session
    model_loaded = True
    print(f"[startup] Model ready on {device}.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """FastAPI lifespan: load the model on startup, free VRAM on shutdown."""
    try:
        _load_model()
    except Exception:  # noqa: BLE001 - we want this loud, never silent
        # Do NOT crash the process: /health must stay reachable so the editor
        # can distinguish "server down" from "model failed to load".
        print("[startup] ERROR: model failed to load:")
        traceback.print_exc()
    yield
    # Shutdown: release GPU memory if we grabbed any.
    if device.startswith("cuda"):
        torch.cuda.empty_cache()
    print("[shutdown] Server stopping.")


app = FastAPI(title="TripoSR Inference Server", lifespan=lifespan)

# CORS: the editor calls from a Tauri/localhost webview origin. Allow all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _as_bool(value: str) -> bool:
    """Parse a permissive form-field truthy string into a bool."""
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


@app.get("/health")
def health() -> JSONResponse:
    """
    Liveness probe. Always returns 200 so the editor can detect
    "server up but still warming" via the model_loaded flag.
    """
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "device": device,
            "model_loaded": model_loaded,
        },
    )


@app.post("/generate")
async def generate(
    image: UploadFile = File(...),
    remove_bg: str = Form("true"),
    mc_resolution: str = Form("256"),
    foreground_ratio: str = Form("0.85"),
) -> Response:
    """
    Turn a single input image into a textured GLB mesh.

    Form fields:
        image            (file, required) the source image
        remove_bg        (default "true") run rembg background removal
        mc_resolution    (default "256")  marching-cubes resolution
        foreground_ratio (default "0.85") foreground scale within the frame

    Returns the GLB bytes as model/gltf-binary, or a JSON error (503/500).
    """
    # Guard: model not ready yet -> 503 so the client can retry/poll /health.
    if not model_loaded or model is None:
        return JSONResponse(
            status_code=503,
            content={"error": "model still loading"},
        )

    tmp_path: Optional[str] = None
    try:
        do_remove_bg = _as_bool(remove_bg)
        resolution = int(mc_resolution)
        fg_ratio = float(foreground_ratio)

        # Read the uploaded image into a PIL image.
        raw = await image.read()
        img = Image.open(io.BytesIO(raw))

        # Background removal is optional — only run (and only pay for) it when
        # asked. The session was created once at startup and is reused.
        if do_remove_bg:
            img = remove_background(img, rembg_session)

        # Normalize foreground scale, then drop alpha to RGB for the model.
        img = resize_foreground(img, fg_ratio)
        img = img.convert("RGB")

        # Inference. no_grad keeps memory down — we never backprop here.
        with torch.no_grad():
            scene_codes = model([img], device=device)
            meshes = model.extract_mesh(scene_codes, True, resolution=resolution)

        # Export to a temp GLB. trimesh picks GLB from the .glb extension and
        # writes vertex colors (extract_mesh(..., True) requested them).
        with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as tmp:
            tmp_path = tmp.name
        meshes[0].export(tmp_path)

        with open(tmp_path, "rb") as fh:
            glb_bytes = fh.read()

        return Response(
            content=glb_bytes,
            media_type="model/gltf-binary",
            headers={"Content-Disposition": 'attachment; filename="generated.glb"'},
        )

    except Exception as exc:  # noqa: BLE001 - surface the failure, never silent
        # Loud failure: full traceback to console, error message to the client.
        print("[generate] ERROR during inference:")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(exc)})

    finally:
        # Clean up the temp file regardless of outcome.
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                print(f"[generate] WARNING: could not remove temp file {tmp_path}")

        # Defensively free VRAM between requests on CUDA.
        if device.startswith("cuda"):
            torch.cuda.empty_cache()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8008)
