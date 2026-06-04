/**
 * RTS-style orbit camera for the Map Editor.
 *
 * Inputs (canvas-relative):
 *   - Middle-mouse drag → pan the focus point in world XZ.
 *   - Right-mouse drag  → orbit (azimuth + elevation).
 *   - Mouse wheel       → zoom (distance from focus).
 *
 * The Day 1 Battlefield Preview uses LEFT-drag for orbit, but the Map
 * Editor's left button is reserved for sculpt/place tools. RIGHT for
 * orbit + MIDDLE for pan is the convention every commercial RTS
 * level-editor uses (Battle.net WC3 editor, StarCraft 2 editor, Unreal's
 * landscape mode).
 *
 * Math: spherical coordinates around the focus point. Elevation clamps
 * just shy of straight-down and straight-up so we never end up with a
 * degenerate up vector. Distance clamps to a sane min/max so the user
 * can't tunnel inside the map or fly to the moon.
 *
 * Cleanup: `dispose()` removes every DOM listener; the scene manager
 * MUST call it to avoid leaking listeners on canvas reuse / hot reload.
 */

import * as THREE from "three";

export interface RtsFocusPoint {
  x: number;
  y: number;
  z: number;
}

export class RtsOrbitCamera {
  private azimuth = Math.PI / 4; // around Y axis, measured from +X.
  private elevation = Math.PI / 4; // above horizon, in radians.
  private distance = 100;

  private readonly minElevation = 0.1;
  private readonly maxElevation = Math.PI / 2 - 0.05;
  private readonly minDistance = 5;
  // Cap big enough to frame the largest preset map (2048m × 0.8 ≈ 1640m).
  // The camera near/far clip is 0.1 / 5000, so 2500 still has 2× headroom.
  private readonly maxDistance = 2500;

  private isOrbiting = false;
  private isPanning = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly focus: RtsFocusPoint,
  ) {
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  /**
   * Move the orbit focus point to a new world position. Used when the
   * map dimensions change (setupNewMap) so the camera re-centres on the
   * new map's middle. Mutates the existing focus object in place so any
   * caller that captured a reference (rare — only the constructor) stays
   * in sync.
   */
  setFocus(p: RtsFocusPoint): void {
    this.focus.x = p.x;
    this.focus.y = p.y;
    this.focus.z = p.z;
  }

  /**
   * Set the orbit distance from the focus point, clamped to the same
   * min/max as wheel-zoom. Used to scale the view to a new map size.
   */
  setDistance(d: number): void {
    this.distance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, d),
    );
  }

  /** Apply current azimuth / elevation / distance to the camera. */
  update(): void {
    const cosE = Math.cos(this.elevation);
    const sinE = Math.sin(this.elevation);
    this.camera.position.set(
      this.focus.x + this.distance * cosE * Math.cos(this.azimuth),
      this.focus.y + this.distance * sinE,
      this.focus.z + this.distance * cosE * Math.sin(this.azimuth),
    );
    this.camera.lookAt(this.focus.x, this.focus.y, this.focus.z);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1) {
      this.isPanning = true;
      e.preventDefault();
    } else if (e.button === 2) {
      this.isOrbiting = true;
      e.preventDefault();
    } else {
      return;
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isOrbiting && !this.isPanning) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.isOrbiting) {
      this.azimuth -= dx * 0.01;
      this.elevation -= dy * 0.005;
      this.elevation = Math.max(
        this.minElevation,
        Math.min(this.maxElevation, this.elevation),
      );
    } else if (this.isPanning) {
      // Pan in world XZ based on camera orientation. We project the
      // camera's forward onto the ground plane so panning feels like
      // sliding the world under your cursor (grab-the-world style: drag
      // mouse right → map slides right; drag down → map slides down).
      //
      // Owner-reported fix (2026-06-04): previous version used `-=` on
      // both axes, which felt inverted — dragging the mouse down moved
      // the map up. Flipped both signs to `+=` so the focus point
      // follows the cursor direction in screen space. If this overshoots
      // (e.g. drag right now moves map left), swap one or both signs
      // back to `-=` here. Easy local tweak; no other code depends on
      // the sign convention.
      const panScale = this.distance * 0.0015;
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3()
        .crossVectors(forward, new THREE.Vector3(0, 1, 0))
        .normalize();
      this.focus.x += (right.x * dx + forward.x * dy) * panScale;
      this.focus.z += (right.z * dx + forward.z * dy) * panScale;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.isOrbiting && !this.isPanning) return;
    this.isOrbiting = false;
    this.isPanning = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.distance *= 1 + e.deltaY * 0.001;
    this.distance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.distance),
    );
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }
}
