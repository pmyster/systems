"""
process.py — the ONE command the owner runs in the morning.

Walks editor-app/starter-pack/photos/<class>/* and, for every image,
produces:
   editor-app/units/<class>/<id>.json    (UnitSchematic)
   editor-app/units/<class>/meshes/<id>.glb (mesh with stamped hardpoint nodes)

Usage:
   python process.py                                 # all classes, all photos
   python process.py --class tank                    # one class
   python process.py --class tank --limit 1          # debug: one photo
   python process.py --dry-run                       # plan only, no inference
   python process.py --octree 192 --chunks 4000      # lower-VRAM mode

Per CLAUDE.md "Loud over silent" — every failure path:
   1. Writes <photo>.error.log next to the input.
   2. Appends a structured row to _logs/run_<timestamp>.log.
   3. Continues with the next photo.
   4. End-of-run summary printed AND saved.

Per CLAUDE.md "Adaptive over specific" — the photos folder scan
iterates CLASS_TEMPLATES keys, not a hardcoded list. Add a new
class to hardpoint_templates.py and process.py picks it up.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# --- path setup so sibling modules import ---
SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

# --- starter-pack imports ---
import hunyuan_wrapper  # noqa: E402
from hardpoint_templates import (  # noqa: E402
    get_template,
    list_classes,
    world_position,
)
from hygiene import normalize, stamp_hardpoints  # noqa: E402
from schematic_gen import build_schematic, make_unit_id, write_schematic  # noqa: E402
from verify import validate_schematic_dict  # noqa: E402

# --- constants ---

ROOT = SCRIPTS_DIR.parent  # editor-app/starter-pack/
EDITOR_APP = ROOT.parent  # editor-app/
PHOTOS_DIR = ROOT / "photos"
HF_CACHE = ROOT / "_hf_cache"
LOG_DIR = ROOT / "_logs"
UNITS_OUT_BASE = EDITOR_APP / "units"  # editor-app/units/<class>/

PHOTO_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

# Minimum acceptable photo dims (px). Anything smaller is unlikely to
# survive the diffusion model's silhouette extraction.
MIN_PHOTO_DIM = 256

# ---------------------------------------------------------------------------
# Result tracking — simple per-photo struct so the summary can be rich.
# ---------------------------------------------------------------------------


@dataclass
class PhotoResult:
    photo_path: Path
    class_name: str
    success: bool = False
    reason: str = ""
    unit_id: str = ""
    schematic_path: Optional[Path] = None
    glb_path: Optional[Path] = None
    elapsed_s: float = 0.0


@dataclass
class RunReport:
    photos_seen: int = 0
    successes: list[PhotoResult] = field(default_factory=list)
    failures: list[PhotoResult] = field(default_factory=list)
    skipped: list[PhotoResult] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.successes) + len(self.failures) + len(self.skipped)


# ---------------------------------------------------------------------------
# Logging setup — both a per-run file and stdout.
# ---------------------------------------------------------------------------


def setup_logging(run_id: str) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"run_{run_id}.log"

    # Make Windows console UTF-8-safe. Without this, cp1252 chokes on the
    # Unicode arrows / em-dashes in log strings. reconfigure() is Py3.7+.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass  # not all stream wrappers support this; never fatal

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # Wipe handlers to avoid duplicate output if re-invoked from REPL.
    for h in list(root.handlers):
        root.removeHandler(h)

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )

    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)

    return log_path


# ---------------------------------------------------------------------------
# Photo validation — gates BEFORE we waste 30 seconds of GPU on a bad input.
# ---------------------------------------------------------------------------


def validate_photo(path: Path) -> Optional[str]:
    """Return None if photo is acceptable, else a human-readable reason."""
    from PIL import Image

    if path.suffix.lower() not in PHOTO_EXTS:
        return f"unsupported extension {path.suffix!r} (need one of {sorted(PHOTO_EXTS)})"

    try:
        with Image.open(path) as img:
            img.verify()
    except Exception as e:
        return f"PIL can't open image — corrupted? ({e})"

    try:
        with Image.open(path) as img:
            w, h = img.size
    except Exception as e:
        return f"PIL can't read dimensions ({e})"

    if w < MIN_PHOTO_DIM or h < MIN_PHOTO_DIM:
        return (
            f"image is {w}x{h} — minimum {MIN_PHOTO_DIM}x{MIN_PHOTO_DIM} required. "
            "Higher resolution = better mesh quality."
        )

    return None


# ---------------------------------------------------------------------------
# Per-photo error log writer.
# ---------------------------------------------------------------------------


def write_error_log(photo_path: Path, exc: BaseException, context: str) -> None:
    """Drop a sibling .error.log so the owner sees what broke."""
    err_path = photo_path.with_suffix(photo_path.suffix + ".error.log")
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    body = (
        f"# starter-pack failure log\n"
        f"# Photo: {photo_path}\n"
        f"# Context: {context}\n"
        f"# Timestamp: {datetime.now(timezone.utc).isoformat()}\n"
        f"\n"
        f"## Reason\n{exc}\n\n"
        f"## Traceback\n{''.join(tb)}\n"
    )
    err_path.write_text(body, encoding="utf-8")
    logging.warning("Wrote error log to %s", err_path)


# ---------------------------------------------------------------------------
# The core per-photo pipeline.
# ---------------------------------------------------------------------------


def process_photo(
    photo_path: Path,
    class_name: str,
    existing_ids: set[str],
    *,
    octree_resolution: int,
    num_inference_steps: int,
    num_chunks: int,
    dry_run: bool,
) -> PhotoResult:
    """Run a single photo through the full pipeline.

    Always returns a PhotoResult — never raises (errors are captured
    into the result.reason field). The outer loop in main() relies on
    this to keep going after individual failures.
    """
    start = time.perf_counter()
    result = PhotoResult(photo_path=photo_path, class_name=class_name)

    log = logging.getLogger(f"process[{photo_path.name}]")

    # Gate 1: photo validation.
    rejection = validate_photo(photo_path)
    if rejection is not None:
        result.reason = f"photo rejected: {rejection}"
        log.warning(result.reason)
        # Drop a per-photo error log so owner sees the rejection.
        try:
            write_error_log(photo_path, ValueError(rejection), "photo validation")
        except Exception as e:
            log.error("(also failed to write error log: %s)", e)
        result.elapsed_s = time.perf_counter() - start
        return result

    # Gate 2: class template lookup.
    try:
        template = get_template(class_name)
    except KeyError as e:
        result.reason = str(e)
        log.error(result.reason)
        write_error_log(photo_path, e, "class template lookup")
        result.elapsed_s = time.perf_counter() - start
        return result

    # Make a stable unit id.
    unit_id = make_unit_id(photo_path, class_name, existing_ids)
    existing_ids.add(unit_id)
    display_name = photo_path.stem
    result.unit_id = unit_id

    out_class_dir = UNITS_OUT_BASE / class_name
    out_meshes_dir = out_class_dir / "meshes"
    out_meshes_dir.mkdir(parents=True, exist_ok=True)
    glb_out = out_meshes_dir / f"{unit_id}.glb"
    json_out = out_class_dir / f"{unit_id}.json"
    result.glb_path = glb_out
    result.schematic_path = json_out

    log.info(
        "starting: class=%s, unit_id=%s, → %s / %s",
        class_name, unit_id, glb_out.name, json_out.name,
    )

    if dry_run:
        result.success = True
        result.reason = "dry-run — no inference run, files NOT written"
        log.info(result.reason)
        result.elapsed_s = time.perf_counter() - start
        return result

    # Stage A: Hunyuan3D inference.
    try:
        raw_mesh = hunyuan_wrapper.generate(
            photo_path,
            octree_resolution=octree_resolution,
            num_inference_steps=num_inference_steps,
            num_chunks=num_chunks,
        )
    except Exception as e:
        result.reason = f"Hunyuan3D inference failed: {e}"
        log.exception(result.reason)
        write_error_log(photo_path, e, "Hunyuan3D inference")
        result.elapsed_s = time.perf_counter() - start
        return result

    # Stage B: mesh hygiene (center + scale + clean).
    try:
        clean_mesh, hygiene_result = normalize(raw_mesh)
    except Exception as e:
        result.reason = f"mesh hygiene failed: {e}"
        log.exception(result.reason)
        write_error_log(photo_path, e, "mesh hygiene")
        result.elapsed_s = time.perf_counter() - start
        return result

    # Stage C: stamp hardpoint nodes into a Scene + export GLB.
    try:
        hp_positions = [
            (hp.id, world_position(template, hp, hygiene_result.bbox_min, hygiene_result.bbox_max))
            for hp in template.hardpoints
        ]
        scene = stamp_hardpoints(clean_mesh, hp_positions)
        scene.export(str(glb_out))
        log.info("wrote GLB: %s", glb_out)
    except Exception as e:
        result.reason = f"GLB export failed: {e}"
        log.exception(result.reason)
        write_error_log(photo_path, e, "GLB export")
        result.elapsed_s = time.perf_counter() - start
        return result

    # Stage D: schematic JSON.
    try:
        schematic = build_schematic(
            unit_id=unit_id,
            display_name=display_name,
            template=template,
            hygiene_result=hygiene_result,
            mesh_path_abs=glb_out.resolve(),
        )
        # Schema-faithfulness gate BEFORE writing — refuse to commit
        # invalid JSON to disk.
        errors = validate_schematic_dict(schematic)
        if errors:
            err_msg = "schematic validation failed:\n  - " + "\n  - ".join(errors)
            raise ValueError(err_msg)
        write_schematic(schematic, json_out)
    except Exception as e:
        result.reason = f"schematic build/validate failed: {e}"
        log.exception(result.reason)
        write_error_log(photo_path, e, "schematic build/validate")
        # Clean up the GLB so we don't leave a half-pair behind.
        if glb_out.exists():
            try:
                glb_out.unlink()
            except Exception:
                pass
        result.elapsed_s = time.perf_counter() - start
        return result

    # All done.
    result.success = True
    result.reason = "ok"
    result.elapsed_s = time.perf_counter() - start
    log.info("DONE in %.1fs", result.elapsed_s)
    return result


# ---------------------------------------------------------------------------
# Discovery — walk the photos folder using the class registry.
# ---------------------------------------------------------------------------


def discover_photos(target_classes: Optional[list[str]] = None) -> dict[str, list[Path]]:
    """Return {class_name: [photo_paths]} for classes that have a folder.

    Loud-over-silent: warn (don't fail) when:
       - A registered class has no folder.
       - A folder exists for an unregistered class — surface it but don't
         process its contents.
       - A folder has 0 photos.
    """
    log = logging.getLogger("discover")
    registered = set(list_classes())

    if target_classes is None:
        target_classes = sorted(registered)
    else:
        unknown = set(target_classes) - registered
        if unknown:
            log.error(
                "unknown classes requested: %s — registered: %s",
                sorted(unknown), sorted(registered),
            )
            target_classes = [c for c in target_classes if c in registered]

    discovered: dict[str, list[Path]] = {}

    # 1. Iterate the registry to surface classes-with-no-folder visibly.
    for cls in target_classes:
        folder = PHOTOS_DIR / cls
        if not folder.exists():
            log.warning("class %s: folder %s does not exist — skipping", cls, folder)
            discovered[cls] = []
            continue
        photos = sorted(
            p for p in folder.iterdir()
            if p.is_file() and p.suffix.lower() in PHOTO_EXTS
        )
        if not photos:
            log.info("class %s: 0 photos in %s — nothing to do", cls, folder)
        else:
            log.info("class %s: found %d photo(s) in %s", cls, len(photos), folder)
        discovered[cls] = photos

    # 2. Surface unregistered folders (adaptive over specific).
    if PHOTOS_DIR.exists():
        for child in PHOTOS_DIR.iterdir():
            if child.is_dir() and child.name not in registered:
                # Allow a few benign names without warning spam.
                if child.name.startswith("_") or child.name.startswith("."):
                    continue
                log.warning(
                    "photos/ contains unregistered class folder %r — to use it, "
                    "register %r in scripts/hardpoint_templates.py CLASS_TEMPLATES",
                    child.name, child.name,
                )

    return discovered


def collect_existing_ids() -> dict[str, set[str]]:
    """Read existing <class>/<id>.json so we don't overwrite without
    realizing. Used for unique-id assignment.
    """
    result: dict[str, set[str]] = {}
    if not UNITS_OUT_BASE.exists():
        return result
    for cls_dir in UNITS_OUT_BASE.iterdir():
        if not cls_dir.is_dir():
            continue
        ids: set[str] = set()
        for f in cls_dir.glob("*.json"):
            ids.add(f.stem)
        if ids:
            result[cls_dir.name] = ids
    return result


# ---------------------------------------------------------------------------
# --rehygiene-only — re-process existing GLBs through the latest hygiene
# without re-running Hunyuan3D. Cheap (~5 sec/file) and lets us roll out
# pipeline improvements (e.g. better consolidation, decimation) to units
# already on disk.
# ---------------------------------------------------------------------------


@dataclass
class RehygieneResult:
    glb_path: Path
    class_name: str
    success: bool = False
    reason: str = ""
    initial_submesh_count: int = 0
    initial_face_count: int = 0
    final_face_count: int = 0
    initial_size_bytes: int = 0
    final_size_bytes: int = 0
    elapsed_s: float = 0.0


def _write_glb_error_log(glb_path: Path, exc: BaseException, context: str) -> None:
    """Sibling .error.log for rehygiene failures. Same shape as the
    photo-side write_error_log() so the owner reads them identically."""
    err_path = glb_path.with_suffix(glb_path.suffix + ".error.log")
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    body = (
        f"# starter-pack rehygiene failure log\n"
        f"# GLB: {glb_path}\n"
        f"# Context: {context}\n"
        f"# Timestamp: {datetime.now(timezone.utc).isoformat()}\n"
        f"\n"
        f"## Reason\n{exc}\n\n"
        f"## Traceback\n{''.join(tb)}\n"
    )
    err_path.write_text(body, encoding="utf-8")
    logging.warning("Wrote error log to %s", err_path)


def rehygiene_one(glb_path: Path, class_name: str) -> RehygieneResult:
    """Re-process a single GLB through the latest hygiene pipeline,
    writing back to the same path. Preserves the hardpoint nodes by
    re-stamping them at the same relative bbox positions defined by
    the class template (so the schematic JSON stays valid without
    being rewritten).

    Always returns a RehygieneResult — never raises. The outer loop
    relies on this to keep going after individual failures.
    """
    import trimesh  # local import — keeps process.py import cheap when not rehygiening

    start = time.perf_counter()
    result = RehygieneResult(glb_path=glb_path, class_name=class_name)
    log = logging.getLogger(f"rehygiene[{glb_path.name}]")

    try:
        result.initial_size_bytes = glb_path.stat().st_size
    except OSError:
        pass  # non-fatal — size is just metadata for the log

    # Stage A: load the existing GLB. trimesh.load on a .glb returns a
    # Scene with the geometry + the hardpoint marker nodes the original
    # stamp_hardpoints() created. We want the BODY mesh (or whatever
    # non-hardpoint geometry is there) consolidated.
    try:
        loaded = trimesh.load(str(glb_path), force=None)
    except Exception as e:
        result.reason = f"trimesh.load failed: {e}"
        log.exception(result.reason)
        _write_glb_error_log(glb_path, e, "trimesh.load")
        result.elapsed_s = time.perf_counter() - start
        return result

    # Stage B: separate body geom(s) from hardpoint marker nodes.
    # The original pipeline stamps each hardpoint as a tiny named cube
    # (0.01 m). We DROP those before hygiene — they're re-stamped after,
    # using the template's relative positions on the freshly normalized
    # bbox.
    body_input: trimesh.parent.Geometry
    if isinstance(loaded, trimesh.Scene):
        body_geoms: list[trimesh.Trimesh] = []
        skipped_marker_count = 0
        for name, g in loaded.geometry.items():
            if not isinstance(g, trimesh.Trimesh):
                continue
            # Heuristic: marker geoms are tiny (~12 faces). Real body
            # meshes have thousands. The original markers were always
            # named like hp_1/hp_2/etc, but a future template could use
            # different names — so we filter by face-count shape, not
            # by name (adaptive over specific).
            if len(g.faces) < 100:
                skipped_marker_count += 1
                continue
            body_geoms.append(g)
        if not body_geoms:
            err = ValueError(
                f"rehygiene: scene had {len(loaded.geometry)} geoms but none "
                "had >100 faces. Nothing to re-hygiene."
            )
            result.reason = str(err)
            log.error(result.reason)
            _write_glb_error_log(glb_path, err, "body extraction")
            result.elapsed_s = time.perf_counter() - start
            return result
        if len(body_geoms) == 1:
            body_input = body_geoms[0]
        else:
            # Multiple body geoms — let consolidate_meshes handle the merge.
            tmp = trimesh.Scene()
            for i, g in enumerate(body_geoms):
                tmp.add_geometry(g, node_name=f"body_{i}")
            body_input = tmp
        log.info(
            "rehygiene: input had %d geoms (%d body, %d marker(s) dropped)",
            len(loaded.geometry), len(body_geoms), skipped_marker_count,
        )
    else:
        # Already a single Trimesh — no marker nodes to drop.
        body_input = loaded
        log.info("rehygiene: input was already a single Trimesh")

    # Stage C: run hygiene on the body geometry.
    try:
        from hygiene import normalize as hygiene_normalize  # local re-import safe

        clean_mesh, hygiene_result = hygiene_normalize(body_input)
    except Exception as e:
        result.reason = f"hygiene failed: {e}"
        log.exception(result.reason)
        _write_glb_error_log(glb_path, e, "hygiene normalize")
        result.elapsed_s = time.perf_counter() - start
        return result

    result.initial_submesh_count = hygiene_result.initial_submesh_count
    result.initial_face_count = hygiene_result.initial_face_count
    result.final_face_count = hygiene_result.final_face_count

    # Stage D: re-stamp hardpoint nodes at the template positions.
    # The freshly normalized bbox may differ slightly from the original
    # (decimation moves vertices), so positions must be re-derived.
    try:
        template = get_template(class_name)
        hp_positions = [
            (hp.id, world_position(template, hp, hygiene_result.bbox_min, hygiene_result.bbox_max))
            for hp in template.hardpoints
        ]
        scene = stamp_hardpoints(clean_mesh, hp_positions)
    except Exception as e:
        result.reason = f"hardpoint stamping failed: {e}"
        log.exception(result.reason)
        _write_glb_error_log(glb_path, e, "stamp_hardpoints")
        result.elapsed_s = time.perf_counter() - start
        return result

    # Stage E: write back. Atomic-ish: export to .tmp then rename so a
    # crashed export doesn't leave a half-written GLB. trimesh infers
    # format from extension, so we pass file_type='glb' explicitly
    # since the temp name ends in .tmp.
    tmp_path = glb_path.with_suffix(glb_path.suffix + ".tmp")
    try:
        scene.export(str(tmp_path), file_type="glb")
        # Replace original. On Windows, Path.replace is atomic when src and
        # dst are on the same filesystem (always true here).
        tmp_path.replace(glb_path)
    except Exception as e:
        result.reason = f"GLB export failed: {e}"
        log.exception(result.reason)
        _write_glb_error_log(glb_path, e, "GLB export")
        # Clean up the tmp file if it survived.
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass
        result.elapsed_s = time.perf_counter() - start
        return result

    try:
        result.final_size_bytes = glb_path.stat().st_size
    except OSError:
        pass

    result.success = True
    result.reason = "ok"
    result.elapsed_s = time.perf_counter() - start
    log.info(
        "rehygiene[%s] | sub-meshes %d -> 1, faces %d -> %d, %.1f KB -> %.1f KB, OK",
        glb_path.name,
        result.initial_submesh_count,
        result.initial_face_count,
        result.final_face_count,
        result.initial_size_bytes / 1024.0,
        result.final_size_bytes / 1024.0,
    )
    return result


def discover_glbs(target_classes: Optional[list[str]] = None) -> dict[str, list[Path]]:
    """Walk units/<class>/meshes/*.glb for every class with a template.

    Same adaptive-over-specific pattern as discover_photos(): iterate
    the class registry, surface unregistered folders, never silently
    skip unknown content.
    """
    log = logging.getLogger("discover_glbs")
    registered = set(list_classes())

    if target_classes is None:
        target_classes = sorted(registered)
    else:
        unknown = set(target_classes) - registered
        if unknown:
            log.error(
                "unknown classes requested: %s — registered: %s",
                sorted(unknown), sorted(registered),
            )
            target_classes = [c for c in target_classes if c in registered]

    discovered: dict[str, list[Path]] = {}
    for cls in target_classes:
        meshes_dir = UNITS_OUT_BASE / cls / "meshes"
        if not meshes_dir.exists():
            log.warning(
                "class %s: meshes folder %s does not exist — nothing to rehygiene",
                cls, meshes_dir,
            )
            discovered[cls] = []
            continue
        glbs = sorted(p for p in meshes_dir.iterdir() if p.is_file() and p.suffix.lower() == ".glb")
        if not glbs:
            log.info("class %s: 0 .glb files in %s — nothing to do", cls, meshes_dir)
        else:
            log.info("class %s: found %d .glb file(s) in %s", cls, len(glbs), meshes_dir)
        discovered[cls] = glbs

    # Surface unregistered folders.
    if UNITS_OUT_BASE.exists():
        for child in UNITS_OUT_BASE.iterdir():
            if child.is_dir() and child.name not in registered:
                if child.name.startswith("_") or child.name.startswith("."):
                    continue
                log.warning(
                    "units/ contains unregistered class folder %r — "
                    "register it in hardpoint_templates.py to include in rehygiene",
                    child.name,
                )

    return discovered


def run_rehygiene(
    args: argparse.Namespace,
    log: logging.Logger,
    run_id: str,
) -> int:
    """The --rehygiene-only entry point. Mirrors the shape of the main
    photo-processing loop: discovery → per-item processing → summary.
    """
    target_classes = args.cls if args.cls else None
    glb_map = discover_glbs(target_classes)
    total_glbs = sum(len(v) for v in glb_map.values())
    if total_glbs == 0:
        log.warning(
            "no .glb files to rehygiene. Generate units first with a normal "
            "(non-rehygiene) starter-pack run.",
        )
        return 0

    succeeded: list[RehygieneResult] = []
    failed: list[RehygieneResult] = []

    for cls, glbs in glb_map.items():
        if args.limit is not None:
            glbs = glbs[: args.limit]
        for g in glbs:
            res = rehygiene_one(g, cls)
            if res.success:
                succeeded.append(res)
            else:
                failed.append(res)

    log.info("=" * 60)
    log.info(
        "Re-hygiened %d, succeeded %d, failed %d",
        len(succeeded) + len(failed), len(succeeded), len(failed),
    )
    for s in succeeded:
        log.info(
            "  OK   %s [%s] sub-meshes %d→1, faces %d→%d, %.1fKB→%.1fKB (%.1fs)",
            s.glb_path.name, s.class_name,
            s.initial_submesh_count, s.initial_face_count, s.final_face_count,
            s.initial_size_bytes / 1024.0, s.final_size_bytes / 1024.0,
            s.elapsed_s,
        )
    for f in failed:
        log.warning(
            "  FAIL %s [%s] — %s (see %s.error.log)",
            f.glb_path.name, f.class_name, f.reason, f.glb_path.name,
        )

    summary_path = LOG_DIR / f"rehygiene_summary_{run_id}.json"
    summary_path.write_text(json.dumps({
        "run_id": run_id,
        "mode": "rehygiene-only",
        "glbs_seen": len(succeeded) + len(failed),
        "successes": [
            {
                "glb": str(s.glb_path),
                "class": s.class_name,
                "initial_submesh_count": s.initial_submesh_count,
                "initial_face_count": s.initial_face_count,
                "final_face_count": s.final_face_count,
                "initial_size_bytes": s.initial_size_bytes,
                "final_size_bytes": s.final_size_bytes,
                "elapsed_s": s.elapsed_s,
            }
            for s in succeeded
        ],
        "failures": [
            {
                "glb": str(f.glb_path),
                "class": f.class_name,
                "reason": f.reason,
                "elapsed_s": f.elapsed_s,
            }
            for f in failed
        ],
    }, indent=2), encoding="utf-8")
    log.info("summary JSON: %s", summary_path)

    return 0 if not failed else 1


# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Photo → RTS unit pipeline using Hunyuan3D-2-mini.",
    )
    parser.add_argument(
        "--class", dest="cls", action="append",
        help="Class to process (tank|mech|infantry|aircraft|...). "
             "Repeat for multiple. Default: all registered classes with a folder.",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Max photos per class (debug aid).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Walk the photos but skip GPU inference + file writes.",
    )
    parser.add_argument(
        "--octree", type=int, default=hunyuan_wrapper.DEFAULT_OCTREE_RESOLUTION,
        help=f"octree_resolution for shape generation. Default {hunyuan_wrapper.DEFAULT_OCTREE_RESOLUTION}. "
             f"Lower = less VRAM. Try 192 or 160 if OOM.",
    )
    parser.add_argument(
        "--steps", type=int, default=hunyuan_wrapper.DEFAULT_NUM_INFERENCE_STEPS,
        help=f"num_inference_steps. Default {hunyuan_wrapper.DEFAULT_NUM_INFERENCE_STEPS}.",
    )
    parser.add_argument(
        "--chunks", type=int, default=hunyuan_wrapper.DEFAULT_NUM_CHUNKS,
        help=f"num_chunks for mesh extraction. Default {hunyuan_wrapper.DEFAULT_NUM_CHUNKS}. "
             "Lower = less VRAM.",
    )
    parser.add_argument(
        "--rehygiene-only", dest="rehygiene_only", action="store_true",
        help="Skip Hunyuan3D inference entirely. Re-process existing "
             "units/<class>/meshes/*.glb through the current hygiene pipeline "
             "(consolidate sub-meshes, re-center, re-scale, decimate). "
             "Useful when shipping a hygiene update without re-running the "
             "slow GPU pass. The schematic JSONs are NOT touched.",
    )
    args = parser.parse_args()

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = setup_logging(run_id)
    log = logging.getLogger("starter_pack.main")

    log.info("===== starter-pack run %s =====", run_id)
    log.info("scripts root: %s", SCRIPTS_DIR)
    log.info("photos:       %s", PHOTOS_DIR)
    log.info("output:       %s", UNITS_OUT_BASE)
    log.info("HF cache:     %s", HF_CACHE)
    log.info("log file:     %s", log_path)
    log.info(
        "knobs: octree=%d steps=%d chunks=%d dry_run=%s rehygiene_only=%s",
        args.octree, args.steps, args.chunks, args.dry_run, args.rehygiene_only,
    )

    # Rehygiene-only fast path. Skips Hunyuan3D loading + photo discovery
    # entirely — just iterates existing units/<class>/meshes/*.glb and
    # re-runs the hygiene pipeline on each.
    if args.rehygiene_only:
        log.info("===== rehygiene-only mode (skipping Hunyuan3D entirely) =====")
        return run_rehygiene(args, log, run_id)

    # Discovery.
    target_classes = args.cls if args.cls else None
    photo_map = discover_photos(target_classes)
    total_photos = sum(len(v) for v in photo_map.values())
    if total_photos == 0:
        log.warning(
            "no photos to process. Drop images into %s/<class>/ and re-run.",
            PHOTOS_DIR,
        )
        return 0

    # Pre-load Hunyuan3D unless dry-run (saves 30 seconds × N photos).
    if not args.dry_run:
        log.info("loading Hunyuan3D-2-mini (first call, ~30-60 seconds)...")
        try:
            hunyuan_wrapper.load_pipelines(HF_CACHE)
        except Exception as e:
            log.exception("FATAL: pipeline load failed — cannot continue: %s", e)
            return 2

    existing_ids = collect_existing_ids()

    # Process loop.
    report = RunReport()
    for cls, photos in photo_map.items():
        if args.limit is not None:
            photos = photos[: args.limit]
        ids_for_class = existing_ids.setdefault(cls, set())
        for p in photos:
            report.photos_seen += 1
            result = process_photo(
                p, cls, ids_for_class,
                octree_resolution=args.octree,
                num_inference_steps=args.steps,
                num_chunks=args.chunks,
                dry_run=args.dry_run,
            )
            if result.success:
                report.successes.append(result)
            else:
                report.failures.append(result)

    # Summary.
    log.info("=" * 60)
    log.info(
        "SUMMARY: processed=%d, succeeded=%d, failed=%d",
        report.total, len(report.successes), len(report.failures),
    )
    for s in report.successes:
        log.info("  OK   %s → %s (%.1fs)", s.photo_path.name, s.unit_id, s.elapsed_s)
    for f in report.failures:
        log.warning(
            "  FAIL %s [%s] — %s (see %s.error.log)",
            f.photo_path.name, f.class_name, f.reason, f.photo_path.name,
        )

    summary_path = LOG_DIR / f"summary_{run_id}.json"
    summary_path.write_text(json.dumps({
        "run_id": run_id,
        "photos_seen": report.photos_seen,
        "successes": [
            {
                "photo": str(s.photo_path),
                "unit_id": s.unit_id,
                "schematic": str(s.schematic_path) if s.schematic_path else None,
                "glb": str(s.glb_path) if s.glb_path else None,
                "elapsed_s": s.elapsed_s,
            }
            for s in report.successes
        ],
        "failures": [
            {
                "photo": str(f.photo_path),
                "class": f.class_name,
                "reason": f.reason,
                "elapsed_s": f.elapsed_s,
            }
            for f in report.failures
        ],
    }, indent=2), encoding="utf-8")
    log.info("summary JSON: %s", summary_path)

    return 0 if not report.failures else 1


if __name__ == "__main__":
    sys.exit(main())
