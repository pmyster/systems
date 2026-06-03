"""
hunyuan_wrapper.py — thin adapter around hy3dgen.shapegen.

The wrapper:
  1. Loads the Hunyuan3D-2-mini shape pipeline ONCE (lazy singleton) so
     batches don't pay the 30-second load tax per photo.
  2. Strips backgrounds via hy3dgen.rembg.BackgroundRemover when the
     input photo has no alpha channel.
  3. Runs the pipeline with VRAM-conscious defaults: octree_resolution
     and num_inference_steps tuned for an 8 GB card.
  4. Returns a trimesh.Trimesh (or raises a clear error).

Hardware target (CLAUDE.md user context):
   RTX 3070 Ti Laptop, 8 GB VRAM. Hunyuan3D-2-mini's shape generator
   advertises ~3-6 GB for geometry alone — leaves us some headroom for
   the rembg ONNX model + other system processes. We DO NOT load the
   texture generator (Hunyuan3DPaintPipeline) — it pushes total VRAM
   above 8 GB and the runtime can't use textured GLBs as gameplay-time
   assets right now anyway. Texturing is a Phase-2 add-on.

Loud-over-silent: every torch.cuda OOM is caught + re-raised as a
custom `Hunyuan3DOOMError` with the device's current memory state.
process.py renders this as a clean "GPU ran out of memory" message
in the error log.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Final

import torch
import trimesh
from PIL import Image

log = logging.getLogger("starter_pack.hunyuan")

# ---------------------------------------------------------------------------
# Model identification + defaults.
# ---------------------------------------------------------------------------

MODEL_REPO: Final = "tencent/Hunyuan3D-2mini"
SHAPEGEN_SUBFOLDER: Final = "hunyuan3d-dit-v2-mini"

# Inference knobs — tuned for 8 GB VRAM. Higher octree_resolution → more
# mesh detail BUT more VRAM. 256 is conservative; 380 is the model card's
# example. We default to 256 and let process.py override via CLI flag.
DEFAULT_OCTREE_RESOLUTION = 256
DEFAULT_NUM_INFERENCE_STEPS = 30
DEFAULT_NUM_CHUNKS = 8_000  # lower = less VRAM, slower
DEFAULT_SEED = 12345


class Hunyuan3DOOMError(RuntimeError):
    """Raised when the GPU runs out of memory mid-inference. process.py
    catches this and writes a clear 'close Chrome and retry' message
    into the per-photo error log."""

    pass


class Hunyuan3DLoadError(RuntimeError):
    """Raised when the model fails to load (bad weights, missing files)."""

    pass


# Lazy singletons — first call to generate() loads them; subsequent calls
# reuse. process.py owns the lifecycle: it loads, batches, and (in the
# future) could explicitly torch.cuda.empty_cache().
_shapegen_pipeline = None
_rembg = None


def _set_hf_cache_env(cache_dir: Path) -> None:
    """Force HuggingFace to use OUR cache, not the user's global one.

    Called BEFORE the first hf_hub_download / from_pretrained so the
    weights stay co-located with the project."""
    cache_dir = cache_dir.resolve()
    os.environ.setdefault("HF_HOME", str(cache_dir))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(cache_dir))
    os.environ.setdefault("HF_HUB_CACHE", str(cache_dir))


def load_pipelines(hf_cache_dir: Path) -> None:
    """Load the shapegen pipeline + rembg into memory. Idempotent."""
    global _shapegen_pipeline, _rembg

    _set_hf_cache_env(hf_cache_dir)

    if _shapegen_pipeline is None:
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

        log.info("hunyuan: loading shapegen pipeline %s/%s ...", MODEL_REPO, SHAPEGEN_SUBFOLDER)
        try:
            _shapegen_pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                MODEL_REPO,
                subfolder=SHAPEGEN_SUBFOLDER,
                use_safetensors=True,
                device="cuda",
            )
        except Exception as e:
            raise Hunyuan3DLoadError(
                f"Failed to load Hunyuan3D-2-mini shape pipeline. "
                f"Repo={MODEL_REPO}, subfolder={SHAPEGEN_SUBFOLDER}. "
                f"Check that weights downloaded fully to {hf_cache_dir}. "
                f"Underlying error: {e}"
            ) from e

        # Try to free as much memory as possible up-front.
        try:
            _shapegen_pipeline.enable_flashvdm()  # type: ignore[attr-defined]
            log.info("hunyuan: enabled flashvdm")
        except Exception:
            log.info("hunyuan: flashvdm not available on this pipeline version — continuing")

        log.info("hunyuan: shapegen ready")

    if _rembg is None:
        from hy3dgen.rembg import BackgroundRemover

        log.info("hunyuan: loading background remover ...")
        _rembg = BackgroundRemover()
        log.info("hunyuan: background remover ready")


def _ensure_rgba(image: Image.Image) -> Image.Image:
    """If the input photo has no alpha channel (background), run U2Net
    via rembg to cut the subject out.

    Hunyuan3D's shapegen reportedly produces much better results on
    background-removed images because the diffusion model focuses on
    the foreground silhouette."""
    if image.mode == "RGBA":
        return image
    assert _rembg is not None, "load_pipelines() must be called before _ensure_rgba()"
    log.info("hunyuan: input is %s — running background remover", image.mode)
    return _rembg(image)


def generate(
    image_path: Path,
    *,
    octree_resolution: int = DEFAULT_OCTREE_RESOLUTION,
    num_inference_steps: int = DEFAULT_NUM_INFERENCE_STEPS,
    num_chunks: int = DEFAULT_NUM_CHUNKS,
    seed: int = DEFAULT_SEED,
) -> trimesh.Trimesh:
    """Run Hunyuan3D-2-mini on a single image.

    The caller MUST have called load_pipelines() first (process.py does
    this once per run).

    Returns a trimesh.Trimesh — NOT a Scene. Raises Hunyuan3DOOMError
    on CUDA OOM, ValueError on bad input.
    """
    if _shapegen_pipeline is None:
        raise RuntimeError(
            "hunyuan_wrapper.generate(): pipeline not loaded. "
            "Call load_pipelines(hf_cache_dir) before generate()."
        )

    if not image_path.exists():
        raise FileNotFoundError(f"hunyuan: image not found: {image_path}")

    image = Image.open(image_path).convert("RGBA" if image_path.suffix.lower() == ".png" else "RGB")
    if image.mode == "RGB":
        image = _ensure_rgba(image)

    log.info(
        "hunyuan: running shapegen on %s — octree=%d, steps=%d, chunks=%d",
        image_path.name, octree_resolution, num_inference_steps, num_chunks,
    )

    try:
        out = _shapegen_pipeline(
            image=image,
            num_inference_steps=num_inference_steps,
            octree_resolution=octree_resolution,
            num_chunks=num_chunks,
            generator=torch.manual_seed(seed),
            output_type="trimesh",
        )
    except torch.cuda.OutOfMemoryError as e:
        # Surface what's hogging VRAM.
        free, total = torch.cuda.mem_get_info()
        gb = 1024 ** 3
        raise Hunyuan3DOOMError(
            f"CUDA out of memory while running shapegen on {image_path.name}. "
            f"GPU memory at failure: {free / gb:.2f} GB free / {total / gb:.2f} GB total. "
            f"Try: (a) close Chrome and other GPU apps, (b) lower octree_resolution "
            f"(currently {octree_resolution}, try 192 or 160), (c) lower num_chunks "
            f"(currently {num_chunks}, try 4000). Underlying error: {e}"
        ) from e

    # The pipeline returns a list; the first entry is the primary mesh.
    if isinstance(out, list):
        if not out:
            raise RuntimeError(
                f"hunyuan: pipeline returned empty list for {image_path.name}"
            )
        mesh = out[0]
    else:
        mesh = out

    if not isinstance(mesh, trimesh.Trimesh):
        # Some pipeline versions return a Scene — convert.
        if isinstance(mesh, trimesh.Scene):
            mesh = mesh.dump(concatenate=True)
        else:
            raise TypeError(
                f"hunyuan: pipeline returned {type(mesh).__name__}, expected Trimesh"
            )

    log.info(
        "hunyuan: shapegen done — %d verts, %d faces",
        len(mesh.vertices), len(mesh.faces),
    )

    # Defensive: empty mesh = failed silhouette interpretation.
    if len(mesh.vertices) == 0:
        raise ValueError(
            f"hunyuan: pipeline returned empty mesh for {image_path.name} "
            "(likely the input photo's subject was unreadable). "
            "Try a cleaner photo: single subject, plain background, 3/4 view."
        )

    # Free the cached VRAM between photos.
    torch.cuda.empty_cache()
    return mesh
