/**
 * Pointer/keyboard input hooks for the Voxel Sculptor.
 *
 * Lifted from tools/voxel-editor/index.html lines 467-521 (pointer +
 * wheel) and 590-602 (keydown). Adapted to React's useEffect-based
 * listener lifecycle.
 *
 * Behavior contract (matches the prototype):
 *  - Left-click (no drag): add voxel at the cursor cell.
 *  - Right-click (no drag): remove voxel at the cursor cell.
 *  - Left-drag: orbit camera (azimuth + elevation).
 *  - Middle-drag: pan camera target.
 *  - Wheel: dolly camera distance.
 *  - 1..9 keys: select material (capped to MATERIALS.length).
 *  - M: toggle mirror-X.
 *  - G: toggle grid visibility.
 *
 * Source-of-truth rule: voxel state is owned by the parent (`voxels`
 * prop) and never mutated inside the hook. The hook calls
 * `onVoxelsChange(next)` with a brand-new VoxelMap.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

import {
  MATERIALS,
  addVoxel,
  addVoxelMirrored,
  removeVoxel,
  removeVoxelMirrored,
} from "../../lib";
import type { MaterialId, VoxelMap } from "../../types";
import {
  applyOrbit,
  clampDistance,
  clampElevation,
  panOrbit,
  type OrbitState,
} from "./controls";
import {
  getIntersect,
  resolveCursorCell,
  resolveRemoveCell,
  type CursorCell,
} from "./picking";

// ---------------------------------------------------------------------------
// usePointerInput — left/middle/right pointer + wheel.
// ---------------------------------------------------------------------------

export interface PointerInputDeps {
  /** Canvas element to attach listeners to. */
  readonly canvas: HTMLCanvasElement | null;
  /** Three.js camera; orbit state is reflected back into this. */
  readonly camera: THREE.PerspectiveCamera;
  /** Mutable orbit state; the hook writes into it during drag. */
  readonly orbit: OrbitState;
  /** Currently editable voxel state (controlled by parent). */
  readonly voxels: VoxelMap;
  /** Latest props read by closures — avoids stale-closure bugs. */
  readonly material: MaterialId;
  readonly mirrorX: boolean;
  /** Meshes to test pointer hits against (one per voxel). */
  readonly voxelMeshes: readonly THREE.Object3D[];
  /** Ground plane to fall back to. */
  readonly ground: THREE.Object3D;
  /** Cursor preview meshes — moved by pointer-move. */
  readonly cursorMesh: THREE.Object3D;
  readonly cursorEdge: THREE.Object3D;
  /** Callback to commit new voxel state. */
  readonly onVoxelsChange: (next: VoxelMap) => void;
  /** Optional callback so the host can show a cursor-pos readout. */
  readonly onCursorChange?: (cell: CursorCell | null) => void;
}

/**
 * Wire pointer + wheel handlers to the canvas. Reattaches when
 * `deps.canvas` changes. The body reads all other fields via a ref so
 * the listener set stays stable; this avoids the prototype-2 footgun
 * where re-binding listeners on every prop change would wipe orbit
 * state mid-drag.
 */
export function usePointerInput(deps: PointerInputDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const canvas = deps.canvas;
    if (!canvas) return undefined;

    // Per-drag scratch state (matches prototype's `mouseStart`).
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
      const { orbit } = depsRef.current;
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
      // Capture so the drag-end fires even if the pointer leaves the canvas.
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer isn't active; ignore.
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      const d = depsRef.current;
      if (mouseStart) {
        const dx = e.clientX - mouseStart.x;
        const dy = e.clientY - mouseStart.y;
        if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          isDragging = true;
        }
        if (isDragging) {
          if (mouseStart.button === 0) {
            // Left-drag = orbit
            d.orbit.azimuth = mouseStart.az - dx * 0.008;
            d.orbit.elevation = clampElevation(mouseStart.el + dy * 0.008);
            applyOrbit(d.camera, d.orbit);
          } else if (mouseStart.button === 1) {
            // Middle-drag = pan
            const speed = d.orbit.distance * 0.0025;
            d.orbit.camTarget.set(mouseStart.tx, mouseStart.ty, mouseStart.tz);
            panOrbit(d.orbit, -dx * speed, dy * speed);
            applyOrbit(d.camera, d.orbit);
          }
        }
      }

      // Cursor preview
      const result = getIntersect(
        canvas,
        d.camera,
        d.voxelMeshes,
        d.ground,
        e.clientX,
        e.clientY,
      );
      if (!result) {
        d.cursorMesh.visible = false;
        d.cursorEdge.visible = false;
        d.onCursorChange?.(null);
        return;
      }
      const cell = resolveCursorCell(result);
      if (!cell.inside) {
        d.cursorMesh.visible = false;
        d.cursorEdge.visible = false;
        d.onCursorChange?.(cell);
        return;
      }
      d.cursorMesh.visible = true;
      d.cursorEdge.visible = true;
      d.cursorMesh.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      d.cursorEdge.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      d.onCursorChange?.(cell);
    };

    const onPointerUp = (e: PointerEvent): void => {
      const d = depsRef.current;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (!isDragging && mouseStart) {
        // Click — not a drag.
        const result = getIntersect(
          canvas,
          d.camera,
          d.voxelMeshes,
          d.ground,
          e.clientX,
          e.clientY,
        );
        if (result) {
          if (e.button === 0) {
            // Add
            const cell = resolveCursorCell(result);
            if (cell.inside) {
              const next = d.mirrorX
                ? addVoxelMirrored(d.voxels, cell.x, cell.y, cell.z, d.material)
                : addVoxel(d.voxels, cell.x, cell.y, cell.z, d.material);
              if (next !== d.voxels) d.onVoxelsChange(next);
            }
          } else if (e.button === 2) {
            // Remove
            const cell = resolveRemoveCell(result);
            if (cell && cell.inside) {
              const next = d.mirrorX
                ? removeVoxelMirrored(d.voxels, cell.x, cell.y, cell.z)
                : removeVoxel(d.voxels, cell.x, cell.y, cell.z);
              if (next !== d.voxels) d.onVoxelsChange(next);
            }
          }
        }
      }
      mouseStart = null;
      isDragging = false;
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const d = depsRef.current;
      d.orbit.distance = clampDistance(d.orbit.distance * (1 + e.deltaY * 0.0015));
      applyOrbit(d.camera, d.orbit);
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
    // Only re-bind when the canvas element itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.canvas]);
}

// ---------------------------------------------------------------------------
// useKeyboardInput — material select + toggles.
// ---------------------------------------------------------------------------

export interface KeyboardInputDeps {
  readonly onSelectMaterial: (material: MaterialId) => void;
  readonly onToggleMirror: () => void;
  readonly onToggleGrid: () => void;
}

/**
 * Wire the 1..9 / M / G keys to material selection and toggles.
 * Lift of tools/voxel-editor/index.html lines 590-602.
 *
 * Guards against firing when typing in a text field — matches the
 * prototype's `e.target.tagName === 'INPUT'` check.
 */
export function useKeyboardInput(deps: KeyboardInputDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      const k = e.key.toLowerCase();
      if (k >= "1" && k <= "9") {
        const idx = parseInt(k, 10) - 1;
        if (idx >= 0 && idx < MATERIALS.length) {
          depsRef.current.onSelectMaterial(MATERIALS[idx].id);
        }
      } else if (k === "m") {
        depsRef.current.onToggleMirror();
      } else if (k === "g") {
        depsRef.current.onToggleGrid();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
