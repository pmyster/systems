"""
hygiene.py — mesh post-processing for raw Hunyuan3D output.

Hunyuan3D-2-mini outputs a mesh that's:
  - in an arbitrary scale (roughly unit-ish, but not exact)
  - in an arbitrary orientation (the model's convention is Y-up, but the
    subject can be at any angle depending on the input photo)
  - not necessarily centered at origin
  - sometimes fragmented into multiple sub-meshes when the model splits
    by material zone (each becomes a separate Mesh node in the GLB)
  - often very dense (300k-700k faces per tank — fine for offline previews,
    far too heavy for 32 instanced units on screen)

The runtime mesh loader expects:
  - Y-up
  - centered at origin (so transforms compose cleanly)
  - longest dimension scaled to chassis.length_m at MOUNT time (so the
    raw mesh just needs to be a reasonable size — the runtime rescales)
  - ONE Mesh node per unit — sub-meshes get rendered as scattered
    fragments because the renderer treats each Mesh node as its own
    InstancedMesh slot

This pass:
  1. Consolidates sub-meshes into one cohesive Trimesh (preserves
     vertex colors + face normals; drops node hierarchy).
  2. Removes degenerate faces and isolated vertices.
  3. Centers the mesh: translates the bbox center to origin.
  4. Normalizes scale: rescales so the longest bbox axis = 8 m
     (the runtime's NORMALIZE_TARGET_M; the schematic carries an
     explicit `length_m` which lets the runtime rescale per-unit).
  5. Optional decimation: if the merged mesh exceeds DECIMATE_THRESHOLD
     faces, run quadric-edge-collapse decimation down to DECIMATE_TARGET.
     Preserves silhouette while cutting GPU cost for instanced rendering.
  6. Re-computes the bbox so downstream stamp() has accurate dims.

We do NOT rotate to Y-up here. Hunyuan3D's convention is already Y-up.
If a future variant changes that, add a `--orient` flag to process.py
that calls trimesh's apply_transform on a configurable axis swap.

Loud-over-silent: every step logs its decision (e.g. "scaled by 1.42 to
fit 8.00 m longest axis"). The log goes to stdout AND the per-run
log file managed by process.py.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Union

import numpy as np
import trimesh

log = logging.getLogger("starter_pack.hygiene")

# The mesh-loader's NORMALIZE_TARGET_M. The runtime rescales every mesh
# to this so the bbox-longest dim ≈ 8 m at the default 1.0 scale.
NORMALIZE_TARGET_M = 8.0

# Decimation thresholds. Hunyuan3D-2-mini at default octree=256 produces
# ~250k-700k faces per tank. At 32 instances + bullets + terrain, that's
# too much vertex traffic for an 8 GB laptop GPU. 50k faces is enough to
# preserve the silhouette at typical RTS camera distance — anything more
# is wasted.
DECIMATE_THRESHOLD = 50_000  # only decimate if face count > this
DECIMATE_TARGET = 50_000  # decimate down to this face count


# Type alias: hygiene accepts both a single Trimesh and a Scene
# (containing potentially many sub-meshes).
MeshOrScene = Union[trimesh.Trimesh, trimesh.Scene]


@dataclass(frozen=True)
class HygieneResult:
    """Stats about what hygiene did. Useful for the run log."""

    initial_vertex_count: int
    final_vertex_count: int
    initial_face_count: int
    final_face_count: int
    initial_submesh_count: int  # number of geoms in input (1 if input was already a Trimesh)
    scale_factor: float
    bbox_min: tuple[float, float, float]
    bbox_max: tuple[float, float, float]
    longest_axis_m: float
    decimated: bool  # whether decimation actually ran


def consolidate_meshes(mesh_or_scene: MeshOrScene) -> tuple[trimesh.Trimesh, int]:
    """Merge any sub-mesh node hierarchy into ONE cohesive Trimesh.

    Why: the runtime renderer treats every Mesh node in a GLB as its
    own InstancedMesh slot. Photo-generated GLBs sometimes arrive with
    sub-meshes split by material zone — these are NOT artist-authored
    structure (mk01's named rigs), they're Hunyuan3D's internal splits
    — and rendering each as a separate instance produces scattered
    fragments inside each unit's bbox.

    The fix: collapse the node hierarchy. One mesh node, one transform,
    one InstancedMesh slot per unit.

    Adapter pattern:
      - trimesh.Trimesh in  → no-op (already consolidated).
      - trimesh.Scene in    → flatten via util.concatenate(scene.dump()).
      - Anything else       → loud-warn and re-raise so the caller sees it.

    Vertex colors and face normals: trimesh.util.concatenate preserves
    per-vertex colors when ALL inputs carry vertex colors. Hunyuan3D
    -2-mini's geometry-only pipeline doesn't bake albedo (the runtime
    instead tints per-instance by team color), but we still write the
    code defensively in case a future texture-bake variant turns
    vertex colors on.

    Returns: (consolidated Trimesh, original submesh count).
    """
    # Already a single Trimesh — no work to do.
    if isinstance(mesh_or_scene, trimesh.Trimesh):
        log.info("consolidate: input is already a single Trimesh — no-op")
        return mesh_or_scene, 1

    # Scene path — the interesting case.
    if isinstance(mesh_or_scene, trimesh.Scene):
        scene = mesh_or_scene
        # scene.dump() returns the list of Trimesh geoms with their scene-graph
        # transforms baked in — so concatenated geometry sits at the right
        # world position. We filter to actual Trimesh entries (skip Points
        # or anything else weird) to be loud about surprises.
        dumped = scene.dump()
        if isinstance(dumped, trimesh.Trimesh):
            # scene.dump() can return a single Trimesh when there's only
            # one geom — short-circuit and treat the whole thing as one.
            log.info("consolidate: scene.dump() collapsed to single Trimesh — no merge needed")
            return dumped, len(scene.geometry)

        geoms: list[trimesh.Trimesh] = []
        skipped: list[str] = []
        for g in dumped:
            if isinstance(g, trimesh.Trimesh):
                geoms.append(g)
            else:
                skipped.append(type(g).__name__)
        if skipped:
            log.warning(
                "consolidate: skipped %d non-Trimesh geoms in scene: %s",
                len(skipped), skipped,
            )
        if not geoms:
            raise ValueError(
                f"consolidate: Scene had {len(scene.geometry)} geoms but none "
                "were Trimesh after .dump(); cannot merge into a single mesh."
            )
        n_in = len(geoms)
        if n_in == 1:
            log.info("consolidate: scene had 1 mesh geom — no merge needed")
            return geoms[0], len(scene.geometry)

        merged = trimesh.util.concatenate(geoms)
        if not isinstance(merged, trimesh.Trimesh):
            raise TypeError(
                f"consolidate: trimesh.util.concatenate returned "
                f"{type(merged).__name__}, expected Trimesh."
            )
        log.info(
            "consolidate: merged %d sub-meshes → 1 (verts %d, faces %d)",
            n_in, len(merged.vertices), len(merged.faces),
        )
        return merged, len(scene.geometry)

    # Anything else: loud warn + raise. The caller's error path will
    # surface this in the per-photo .error.log.
    raise TypeError(
        f"consolidate: expected Trimesh or Scene, got "
        f"{type(mesh_or_scene).__name__} — refusing to silently coerce. "
        "Add an explicit adapter case if this is a new pipeline output."
    )


def _maybe_decimate(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, bool]:
    """If face count > DECIMATE_THRESHOLD, run quadric-edge-collapse
    decimation down to DECIMATE_TARGET. Otherwise return mesh unchanged.

    Returns (mesh, decimated_bool). Loud-warns what got decimated.

    Falls through with a warning (NOT a raise) if the decimation backend
    isn't installed — better to ship a heavy mesh than a missing one.
    """
    n_in = len(mesh.faces)
    if n_in <= DECIMATE_THRESHOLD:
        return mesh, False

    log.warning(
        "decimate: face count %d > threshold %d — decimating to %d "
        "(quadric edge collapse, preserves silhouette)",
        n_in, DECIMATE_THRESHOLD, DECIMATE_TARGET,
    )
    try:
        simplified = mesh.simplify_quadric_decimation(face_count=DECIMATE_TARGET)
    except Exception as e:
        # Loud-over-silent: surface the missing backend, don't pretend it
        # worked. But don't kill the run — the mesh is still usable, just
        # heavier than ideal.
        log.error(
            "decimate: simplify_quadric_decimation FAILED (%s: %s). "
            "Mesh kept at %d faces. Install `fast-simplification` or `open3d` "
            "in the venv to enable decimation.",
            type(e).__name__, e, n_in,
        )
        return mesh, False

    if not isinstance(simplified, trimesh.Trimesh):
        log.error(
            "decimate: backend returned %s, expected Trimesh. Kept original mesh.",
            type(simplified).__name__,
        )
        return mesh, False

    n_out = len(simplified.faces)
    log.info("decimate: %d faces → %d faces (%.1f%% reduction)",
             n_in, n_out, 100 * (1 - n_out / n_in))
    return simplified, True


def normalize(mesh_or_scene: MeshOrScene) -> tuple[trimesh.Trimesh, HygieneResult]:
    """Consolidate + center + normalize + clean + decimate.

    Accepts either a Trimesh OR a Scene. Returns the cleaned single-mesh
    Trimesh AND a HygieneResult with stats. The bbox fields on the
    result are the FINAL bbox (post-normalize) — that's what
    schematic_gen + hardpoint_templates need to stamp hardpoints in the
    right places.

    Order matters:
      1. Consolidate sub-meshes (so all subsequent steps work on one mesh).
      2. process(validate) — degenerate + dedup cleanup.
      3. Center at origin (bbox-center translation).
      4. Scale so longest bbox axis = NORMALIZE_TARGET_M.
      5. Decimate if face count > DECIMATE_THRESHOLD.
      6. Recompute final bbox for schematic stamping.
    """
    # Step 1: consolidate. This handles the Scene→Trimesh adapter AND
    # collapses any sub-mesh fragmentation.
    mesh, initial_submesh_count = consolidate_meshes(mesh_or_scene)

    initial_v = len(mesh.vertices)
    initial_f = len(mesh.faces)
    log.info(
        "hygiene: input mesh — %d verts, %d faces, %d sub-mesh(es) consolidated",
        initial_v, initial_f, initial_submesh_count,
    )

    # Step 2: remove degenerate + unreferenced.
    # trimesh.process(validate=True) handles dedup + degenerate removal
    # in one shot.
    mesh.process(validate=True)

    # Step 3: center on origin via bbox-center translation.
    bbox_min = mesh.bounds[0].copy()
    bbox_max = mesh.bounds[1].copy()
    center = (bbox_min + bbox_max) / 2.0
    mesh.apply_translation(-center)
    log.info(
        "hygiene: centered by translating %.3f, %.3f, %.3f → origin",
        center[0], center[1], center[2],
    )

    # Step 4: normalize scale so longest bbox axis = NORMALIZE_TARGET_M.
    extents = mesh.extents  # (dx, dy, dz)
    longest = float(np.max(extents))
    if longest <= 1e-6:
        raise ValueError(
            f"hygiene: longest bbox axis is {longest:.6g} — mesh is degenerate "
            "(probably empty or all coincident vertices). Refusing to normalize."
        )
    scale = NORMALIZE_TARGET_M / longest
    mesh.apply_scale(scale)
    log.info(
        "hygiene: scaled by %.4f so longest axis = %.2f m (was %.3f m)",
        scale, NORMALIZE_TARGET_M, longest,
    )

    # Step 5: optional decimation. Runs AFTER scale so the simplifier
    # operates in the final metric space — quadric error is consistent.
    mesh, decimated = _maybe_decimate(mesh)

    # Recompute final bbox for the schematic generator.
    final_bbox_min = tuple(float(x) for x in mesh.bounds[0])
    final_bbox_max = tuple(float(x) for x in mesh.bounds[1])
    final_extents = mesh.extents
    final_longest = float(np.max(final_extents))

    result = HygieneResult(
        initial_vertex_count=initial_v,
        final_vertex_count=len(mesh.vertices),
        initial_face_count=initial_f,
        final_face_count=len(mesh.faces),
        initial_submesh_count=initial_submesh_count,
        scale_factor=scale,
        bbox_min=final_bbox_min,  # type: ignore[arg-type]
        bbox_max=final_bbox_max,  # type: ignore[arg-type]
        longest_axis_m=final_longest,
        decimated=decimated,
    )
    log.info(
        "hygiene: final — %d verts, %d faces, bbox [%.2f, %.2f, %.2f] → [%.2f, %.2f, %.2f]",
        result.final_vertex_count, result.final_face_count,
        *result.bbox_min, *result.bbox_max,
    )
    return mesh, result


def stamp_hardpoints(
    mesh: trimesh.Trimesh,
    hp_world_positions: list[tuple[str, tuple[float, float, float]]],
) -> trimesh.Scene:
    """Build a Scene containing the mesh PLUS one empty 'node' per
    hardpoint, located at the hardpoint's world position.

    We use empty geometry nodes so the GLB carries the transforms.
    The runtime mesh loader walks the scene graph by node name; the
    schematic's `hardpoints[].local_position` is also written so the
    runtime can stamp without re-parsing the GLB scene.

    Returns a trimesh.Scene ready for `.export('whatever.glb')`.
    """
    scene = trimesh.Scene()
    scene.add_geometry(mesh, geom_name="body", node_name="body")

    for hp_id, (x, y, z) in hp_world_positions:
        # Empty geometry placeholder for the hardpoint — tiny invisible
        # box so the node has SOMETHING to anchor. The runtime won't
        # render it; it just walks the scene graph for the named node.
        # Picking a sub-cm cube keeps it well below pixel size at any
        # sane camera distance.
        marker = trimesh.creation.box(extents=(0.01, 0.01, 0.01))
        transform = np.eye(4)
        transform[:3, 3] = [x, y, z]
        scene.add_geometry(
            marker,
            transform=transform,
            geom_name=hp_id,
            node_name=hp_id,
        )

    return scene
