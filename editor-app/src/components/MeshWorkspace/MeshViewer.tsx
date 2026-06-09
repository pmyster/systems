/**
 * MeshViewer — Three.js mesh viewer for the Mesh Workspace left pane.
 *
 * Renders an imported THREE.Group (GLB/GLTF mesh) inside a WebGL
 * canvas. Supports orbit camera via pointer events:
 *   - Left-drag  → orbit (azimuth + elevation)
 *   - Middle-drag → pan camera target
 *   - Wheel       → dolly distance
 *
 * Also renders the unit's hardpoint markers — small orange arrows
 * pointing along each hardpoint's local +Z (matching the engine's
 * world-direction convention). The artist selects a hardpoint via the
 * AttributeForm and drags its arrow with a THREE.TransformControls
 * gizmo; commits write back to the store via `onUnitChange`.
 *
 * When `mesh` is null an overlay prompt is shown.
 * All GPU resources are disposed on unmount.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import { useMeshAssets } from "../../state/mesh-assets";
import type { MeshHardpoint, UnitSchematic } from "../../types/unit";

import { applySkin, removeSkin, type AppliedSkin } from "./box-projection";
import {
  applyOrbit,
  clampDistance,
  clampElevation,
  createOrbitState,
  panOrbit,
} from "./controls";
import {
  colorArrow,
  createHardpointArrow,
  type HardpointArrow,
} from "./HardpointVisuals";
import { createMeshScene, type MeshScene } from "./scene";

// ---------------------------------------------------------------------------
// Props.
// ---------------------------------------------------------------------------

export interface MeshViewerProps {
  /** The current mesh to display. null = empty scene with prompt overlay. */
  mesh: THREE.Group | null;
  /**
   * Optional photo to wrap onto the mesh as a box-projected skin. When set
   * (and a mesh is present) it projects onto every sub-mesh; clearing it (or
   * swapping the mesh) restores the original materials. null = no skin.
   */
  skinImage?: HTMLImageElement | null;
  /**
   * Current unit. Hardpoint arrows are rebuilt to match `unit.hardpoints`
   * on every change. Optional so simpler call sites (tests, mesh-only
   * previews) can omit it; hardpoint editing is then disabled.
   */
  unit?: UnitSchematic;
  /**
   * Called when the gizmo edits a hardpoint's local transform. Required to
   * persist gizmo drags back into the store. Optional for the same reason
   * as `unit` above — without it, the arrows render read-only.
   */
  onUnitChange?: (next: UnitSchematic) => void;
}

// ---------------------------------------------------------------------------
// Inline styles.
// ---------------------------------------------------------------------------

const styles = {
  container: {
    position: "relative" as const,
    width: "100%",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    background: "#0a0d12",
  },
  emptyOverlay: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none" as const,
    color: "rgba(255,255,255,0.35)",
    fontSize: 14,
    fontFamily: "system-ui, sans-serif",
    letterSpacing: "0.02em",
    textAlign: "center" as const,
    padding: "0 24px",
  },
} as const;

// ---------------------------------------------------------------------------
// Hardpoint id-duplication warning bookkeeping (loud-over-silent). We log
// each duplicate-id event ONCE per unit/render to avoid spamming the console
// when an in-progress rename briefly collides. The set is cleared at the top
// of each sync pass.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function MeshViewer({
  mesh,
  skinImage = null,
  unit,
  onUnitChange,
}: MeshViewerProps) {
  // The div the renderer canvas is mounted inside.
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Three.js scene bundle (created on mount, disposed on unmount).
  const sceneRef = useRef<MeshScene | null>(null);
  // Orbit camera state — mutable, never triggers re-renders.
  const orbitRef = useRef(createOrbitState());
  // Ref tracking the most-recently-added mesh so we can remove it.
  const prevMeshRef = useRef<THREE.Group | null>(null);
  // Handle to the currently-applied box-projection skin (texture + materials)
  // so we can dispose its GPU resources and restore originals on change.
  const skinRef = useRef<AppliedSkin | null>(null);
  // Per-hardpoint arrow visuals, keyed by hardpoint id. Synced from `unit.hardpoints`.
  const arrowsRef = useRef<Map<string, HardpointArrow>>(new Map());
  // TransformControls instance (built once, disposed on unmount). Its helper
  // root is added to the scene so the gizmo renders.
  const transformControlsRef = useRef<TransformControls | null>(null);
  // Live ref to onUnitChange so the (long-lived) objectChange handler always
  // calls the latest callback without recreating the controls on every prop
  // tick. Same pattern as the orbit handlers — we hand the listener a stable
  // reader, not the prop directly.
  const onUnitChangeRef = useRef<typeof onUnitChange>(onUnitChange);
  useEffect(() => {
    onUnitChangeRef.current = onUnitChange;
  }, [onUnitChange]);
  const unitRef = useRef<UnitSchematic | undefined>(unit);
  useEffect(() => {
    unitRef.current = unit;
  }, [unit]);
  // Canvas state drives the render-loop and resize-observer effects.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  // Surface the gizmo's drag state to the orbit handler so a drag on the
  // gizmo doesn't ALSO rotate the camera.
  const gizmoDraggingRef = useRef<boolean>(false);

  const { selectedHardpointId, gizmoMode, fireSelectedHardpointIds } =
    useMeshAssets();
  // Mirror selection into a ref so the long-lived gizmo effect doesn't
  // re-run unnecessarily.
  const selectedHardpointIdRef = useRef<string | null>(selectedHardpointId);
  useEffect(() => {
    selectedHardpointIdRef.current = selectedHardpointId;
  }, [selectedHardpointId]);

  // ----- Mount: build scene, attach canvas ---------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const sceneBundle = createMeshScene();
    sceneRef.current = sceneBundle;
    container.appendChild(sceneBundle.renderer.domElement);
    setCanvas(sceneBundle.renderer.domElement);
    applyOrbit(sceneBundle.camera, orbitRef.current);

    // Build the TransformControls once. Its helper root is added to the
    // scene; the controls itself listens on the canvas. We attach/detach
    // it to the selected arrow in a separate effect.
    const controls = new TransformControls(
      sceneBundle.camera,
      sceneBundle.renderer.domElement,
    );
    controls.setSize(0.8);
    controls.space = "local";
    // Suppress orbit while the gizmo is being dragged — and re-enable it
    // when the drag ends. The orbit handler reads `gizmoDraggingRef.current`
    // to decide whether to track pointer movement.
    controls.addEventListener("mouseDown", () => {
      gizmoDraggingRef.current = true;
    });
    controls.addEventListener("mouseUp", () => {
      gizmoDraggingRef.current = false;
    });
    controls.addEventListener("dragging-changed", (e) => {
      gizmoDraggingRef.current = Boolean(e.value);
    });
    // On any gizmo edit, commit the new local transform back to the store.
    controls.addEventListener("objectChange", () => {
      const cb = onUnitChangeRef.current;
      const u = unitRef.current;
      const id = selectedHardpointIdRef.current;
      if (!cb || !u || !id) return;
      const arrow = arrowsRef.current.get(id);
      if (!arrow) return;
      // The arrow is parented to the meshGroup; its local position/quaternion
      // are exactly what we want to persist.
      const p = arrow.group.position;
      const q = arrow.group.quaternion;
      const patched: MeshHardpoint[] = (u.hardpoints ?? []).map((h) =>
        h.id === id
          ? {
              ...h,
              local_position: [p.x, p.y, p.z],
              local_quaternion: [q.x, q.y, q.z, q.w],
            }
          : h,
      );
      cb({ ...u, hardpoints: patched });
    });
    sceneBundle.scene.add(controls.getHelper());
    transformControlsRef.current = controls;

    return () => {
      // Dispose any applied skin before tearing the scene down (no GPU leak).
      if (prevMeshRef.current && skinRef.current) {
        removeSkin(prevMeshRef.current, skinRef.current);
      }
      skinRef.current = null;

      // Detach + dispose TransformControls. Its helper root must be removed
      // from the scene by us — the controls' own dispose() doesn't re-parent.
      const c = transformControlsRef.current;
      if (c) {
        c.detach();
        const helper = c.getHelper();
        if (helper.parent) helper.parent.remove(helper);
        helper.dispose();
        c.dispose();
      }
      transformControlsRef.current = null;

      // Dispose every hardpoint arrow we own.
      for (const arrow of arrowsRef.current.values()) {
        if (arrow.group.parent) arrow.group.parent.remove(arrow.group);
        arrow.dispose();
      }
      arrowsRef.current.clear();

      if (sceneBundle.renderer.domElement.parentNode === container) {
        container.removeChild(sceneBundle.renderer.domElement);
      }
      sceneBundle.dispose();
      sceneRef.current = null;
      prevMeshRef.current = null;
      setCanvas(null);
    };
  }, []);

  // ----- Sync mesh prop → meshGroup ----------------------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;

    // Remove previous mesh — first strip any skin so its texture/materials
    // are disposed and the original materials restored.
    if (prevMeshRef.current) {
      if (skinRef.current) {
        removeSkin(prevMeshRef.current, skinRef.current);
        skinRef.current = null;
      }
      sceneBundle.meshGroup.remove(prevMeshRef.current);
      prevMeshRef.current = null;
    }

    // Add new mesh.
    if (mesh) {
      sceneBundle.meshGroup.add(mesh);
      prevMeshRef.current = mesh;
    }
  }, [mesh]);

  // ----- Sync skinImage prop → box-projection skin -------------------------

  useEffect(() => {
    // Apply to the SAME group instance MeshViewer added to its scene.
    const group = prevMeshRef.current;
    if (!group) return undefined;

    if (skinImage) {
      // Replace any prior skin first (defensive — normally already null).
      if (skinRef.current) {
        removeSkin(group, skinRef.current);
      }
      skinRef.current = applySkin(group, skinImage);
    }

    return () => {
      if (skinRef.current) {
        removeSkin(group, skinRef.current);
        skinRef.current = null;
      }
    };
  }, [mesh, skinImage]);

  // ----- Sync unit.hardpoints → arrow visuals ------------------------------
  //
  // Idempotent reconciliation:
  //   - Build arrow for each new id.
  //   - Update existing arrows' local position/quaternion in place — but
  //     SKIP the arrow currently being dragged (selected + gizmo dragging),
  //     because its transform IS the source of truth this frame; writing
  //     stale store values back would fight the drag.
  //   - Remove + dispose arrows whose ids are no longer present.

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return;
    const hardpoints = unit?.hardpoints ?? [];
    const arrows = arrowsRef.current;

    // Loud-over-silent: detect duplicate ids and warn once per render.
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const h of hardpoints) {
      if (seen.has(h.id)) dupes.add(h.id);
      seen.add(h.id);
    }
    if (dupes.size > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[MeshHardpoints] duplicate ids detected: ${[...dupes].join(", ")} ` +
          `— the runtime will use the first occurrence; rename to fix.`,
      );
    }

    // Add / update.
    const wantedIds = new Set<string>();
    const selectedId = selectedHardpointIdRef.current;
    const dragging = gizmoDraggingRef.current;
    for (const h of hardpoints) {
      wantedIds.add(h.id);
      let arrow = arrows.get(h.id);
      if (!arrow) {
        // Pass the hardpoint id into the factory so the floating label
        // bakes the right text. If the id is later renamed, the
        // reconciler treats it as a new id, disposes the old arrow, and
        // builds a fresh one — the label rebuilds with it. Cheap, correct.
        arrow = createHardpointArrow(h.id);
        sceneBundle.meshGroup.add(arrow.group);
        arrows.set(h.id, arrow);
      }
      if (!(dragging && h.id === selectedId)) {
        arrow.group.position.set(
          h.local_position[0],
          h.local_position[1],
          h.local_position[2],
        );
        arrow.group.quaternion.set(
          h.local_quaternion[0],
          h.local_quaternion[1],
          h.local_quaternion[2],
          h.local_quaternion[3],
        );
      }
      // Tint priority: fire-test highlight (cyan) > gizmo selection
      // (yellow) > default (orange). See HardpointVisuals header — the
      // user's fire-test selection is the decision-relevant state when
      // both apply; the gizmo attachment is already obvious from the
      // gizmo arrows themselves.
      const isHighlighted = fireSelectedHardpointIds.has(h.id);
      const isGizmoSelected = h.id === selectedId;
      const tint = isHighlighted
        ? "highlight"
        : isGizmoSelected
          ? "gizmo"
          : "default";
      colorArrow(arrow, tint);
    }

    // Remove arrows whose hardpoint was deleted.
    for (const [id, arrow] of [...arrows.entries()]) {
      if (wantedIds.has(id)) continue;
      if (arrow.group.parent) arrow.group.parent.remove(arrow.group);
      arrow.dispose();
      arrows.delete(id);
    }
  }, [unit, selectedHardpointId, fireSelectedHardpointIds]);

  // ----- Attach / detach TransformControls based on selection + mode -------

  useEffect(() => {
    const controls = transformControlsRef.current;
    if (!controls) return;
    const arrow =
      selectedHardpointId !== null ? arrowsRef.current.get(selectedHardpointId) : null;
    if (!arrow || gizmoMode === "off") {
      controls.detach();
      return;
    }
    controls.setMode(gizmoMode);
    controls.attach(arrow.group);
  }, [selectedHardpointId, gizmoMode, unit]);

  // ----- Render loop (rAF, paused while hidden) ----------------------------

  useEffect(() => {
    const sceneBundle = sceneRef.current;
    if (!sceneBundle) return undefined;

    let rafId = 0;
    let stopped = false;

    const frame = (): void => {
      if (stopped) return;
      if (document.visibilityState !== "hidden") {
        sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera);
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    const onVisibility = (): void => {
      if (document.visibilityState !== "hidden") {
        sceneBundle.renderer.render(sceneBundle.scene, sceneBundle.camera);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canvas]);

  // ----- ResizeObserver on the container -----------------------------------

  useEffect(() => {
    const container = containerRef.current;
    const sceneBundle = sceneRef.current;
    if (!container || !sceneBundle) return undefined;

    const apply = (w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      sceneBundle.camera.aspect = w / h;
      sceneBundle.camera.updateProjectionMatrix();
      sceneBundle.renderer.setSize(w, h); // updateStyle=true so CSS matches on high-DPI screens
    };

    apply(container.clientWidth, container.clientHeight);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        apply(cr.width, cr.height);
      }
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
    };
  }, [canvas]);

  // ----- Pointer + wheel orbit controls ------------------------------------

  useEffect(() => {
    if (!canvas) return undefined;

    interface DragStart {
      x: number;
      y: number;
      button: number;
      az: number;
      el: number;
      tx: number;
      ty: number;
      tz: number;
    }
    let mouseStart: DragStart | null = null;
    let isDragging = false;

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent): void => {
      // If the gizmo claimed this pointer (it sits in front of the
      // canvas and dragging-changed is already true), do not start an
      // orbit drag — let the gizmo own the gesture.
      if (gizmoDraggingRef.current) return;
      const orbit = orbitRef.current;
      isDragging = false;
      mouseStart = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        az: orbit.azimuth,
        el: orbit.elevation,
        tx: orbit.camTarget.x,
        ty: orbit.camTarget.y,
        tz: orbit.camTarget.z,
      };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer isn't active; ignore.
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      const sceneBundle = sceneRef.current;
      if (!sceneBundle || !mouseStart) return;
      // If the gizmo grabbed the drag mid-gesture, abandon the orbit
      // motion. Re-checking on every move keeps a partial orbit from
      // running when the user accidentally clicked the gizmo arrow.
      if (gizmoDraggingRef.current) return;
      const dx = e.clientX - mouseStart.x;
      const dy = e.clientY - mouseStart.y;
      if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        isDragging = true;
      }
      if (isDragging) {
        const orbit = orbitRef.current;
        if (mouseStart.button === 2) {
          // Right-drag = orbit. Matches Play view (commit e9d93db) +
          // BattlefieldPreview for editor-wide consistency.
          orbit.azimuth = mouseStart.az - dx * 0.008;
          orbit.elevation = clampElevation(mouseStart.el + dy * 0.008);
          applyOrbit(sceneBundle.camera, orbit);
        } else if (mouseStart.button === 1) {
          // Middle-drag = pan (unchanged — consistent with Play view).
          const speed = orbit.distance * 0.0025;
          orbit.camTarget.set(mouseStart.tx, mouseStart.ty, mouseStart.tz);
          panOrbit(orbit, -dx * speed, dy * speed);
          applyOrbit(sceneBundle.camera, orbit);
        }
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      mouseStart = null;
      isDragging = false;
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const sceneBundle = sceneRef.current;
      if (!sceneBundle) return;
      const orbit = orbitRef.current;
      orbit.distance = clampDistance(orbit.distance * (1 + e.deltaY * 0.0015));
      applyOrbit(sceneBundle.camera, orbit);
    };

    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvas]);

  // ----- Render ------------------------------------------------------------

  return (
    <div style={styles.container} ref={containerRef}>
      {mesh === null && (
        <div style={styles.emptyOverlay}>
          No mesh loaded — pick a template or import a file
        </div>
      )}
    </div>
  );
}
