/**
 * RtsCamera — Phase 1 Week 2
 *
 * Render-side top-down RTS camera controller. Replaces FreeFlyCamera in
 * the game runtime.
 *
 * Camera model: orbit around a focus point on (mostly) the ground plane.
 *   - WASD / arrow keys: pan the focus along the ground (camera-relative).
 *   - Mouse wheel: zoom (distance from focus, clamped MIN..MAX).
 *   - Middle-drag: rotate yaw + pitch around focus.
 *   - Edge-pan: cursor within EDGE_PAN_PX of a window edge → pan in that
 *     direction (toggle by setting `edgePanEnabled = false`).
 *   - Focus point clamps to map bounds so the player can't fly off.
 *
 * Why not THREE.OrbitControls?
 *   OrbitControls is too "let the artist look at the model" — it
 *   damps everything, doesn't compose with edge-pan, and lacks the
 *   map-bounds clamp. Reimplementing on top of pitch/yaw/distance is
 *   ~120 lines and gives us exact RTS feel.
 *
 * Architectural rule: lives outside `/sim`. Reads pointer events,
 * mutates a THREE.PerspectiveCamera, holds DOM listeners. Disposes
 * cleanly on React unmount.
 *
 * Selection-driven pivot (added 2026-06-07):
 *   The "orbit pivot" used by rotate/zoom math is separate from the
 *   "pan focus" the WASD/edge-pan controls. By default they're the same
 *   point (panning moves both). When a single unit is selected, the
 *   runtime calls `setFocusTarget(unitWorldPos)` each frame; the orbit
 *   pivot then EASES toward that position with a lerp (FOCUS_LERP_RATE).
 *   The pan focus stays where the user left it — so deselecting glides
 *   the orbit pivot back to where they were panning. This matches the
 *   classic RTS feel (SC2, AoE2, Total War): rotation pivots around the
 *   thing you care about, not the dead center of the map.
 *
 *   `frameSelected(pos)` snaps both pan focus AND orbit pivot to a unit
 *   instantly and zooms in — the "F" hotkey (double-tap-W in SC2). No
 *   lerp; it's meant to feel like a hard cut.
 */

import * as THREE from "three";

const MAX_PITCH_DEG = 80;
const MIN_PITCH_DEG = 20;
const DEFAULT_PITCH_DEG = 45;
const DEG_TO_RAD = Math.PI / 180;

const MIN_ZOOM_DIST = 8;
const MAX_ZOOM_DIST = 200;
const DEFAULT_ZOOM_DIST = 50;
const WHEEL_ZOOM_PCT = 0.0015; // per delta-px

const BASE_PAN_SPEED = 20; // m/sec
const FAST_PAN_MULT = 2.5; // Shift held

const ROTATE_SENSITIVITY = 0.006; // rad/px (middle drag)

const EDGE_PAN_PX = 20;
const EDGE_PAN_SPEED_M = 30; // m/sec when at edge

/**
 * Per-frame easing rate for the orbit pivot when it's chasing a focus
 * target (selected unit). 0.18 → ~99% of the way home in 25 frames at
 * 60 Hz (~0.4 sec) — snappy enough to feel responsive, slow enough not
 * to read as a teleport. Independent of dt because RTS rotations are
 * triggered by drags, not by simulated forces; per-frame feel beats
 * "physically correct" damping here.
 */
const FOCUS_LERP_RATE = 0.18;

/**
 * Below this distance² between current pivot and target, we snap to
 * the target outright. Avoids the "asymptotic crawl" tail where the
 * lerp gets visually indistinguishable but never converges to bit-
 * identical values — matters for tests asserting eventual equality.
 */
const FOCUS_SNAP_EPS_SQ = 1e-6;

/** Frame-selected zoom distance when the F hotkey fires. */
const FRAME_SELECTED_DISTANCE = 30;

/**
 * Loud-over-silent: if a caller passes a focus target whose Y is
 * absurdly negative (likely a "I forgot to sample the heightmap"
 * bug), warn and reject. World maps live in a Y range comfortably
 * above this floor.
 */
const FOCUS_TARGET_MIN_Y = -100;
const FOCUS_TARGET_MAX_Y = 10000;

/**
 * Optional map bounds for clamping the focus point. Pass these in via
 * the constructor so the same controller can serve maps of any size.
 */
export interface RtsCameraBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface RtsCameraOpts {
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;
  readonly bounds: RtsCameraBounds;
  /** World-space starting focus point (usually map center). */
  readonly initialFocus: THREE.Vector3;
  /** Default true — set false to disable mouse edge-pan. */
  readonly edgePanEnabled?: boolean;
}

export class RtsCamera {
  edgePanEnabled: boolean;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly bounds: RtsCameraBounds;
  /**
   * The "pan focus" — moved by WASD + edge-pan. Where the user's
   * keyboard/mouse navigation thinks the camera is centered.
   */
  private readonly focus: THREE.Vector3;
  /**
   * Optional selection-driven override. When non-null, the orbit pivot
   * eases toward this point each frame; when null, it eases back to
   * `focus`. The runtime sets/clears this from per-frame selection
   * state.
   */
  private focusTarget: THREE.Vector3 | null = null;
  /**
   * The pivot the camera actually rotates around this frame. Lerps
   * toward (focusTarget ?? focus) each update(). The camera looks at
   * THIS, and zoom moves toward/away from THIS.
   */
  private readonly currentPivot: THREE.Vector3;
  private yaw = 0;
  private pitch = DEFAULT_PITCH_DEG * DEG_TO_RAD;
  private distance = DEFAULT_ZOOM_DIST;
  private readonly keys = new Set<string>();
  private rotating = false;
  private mouseX = -1; // last cursor position (window coords) for edge-pan
  private mouseY = -1;
  private cursorInside = false;

  constructor(opts: RtsCameraOpts) {
    this.camera = opts.camera;
    this.domElement = opts.domElement;
    this.bounds = opts.bounds;
    this.focus = opts.initialFocus.clone();
    // Start the orbit pivot at the same point as the pan focus —
    // no lerp on first frame, the camera frames the map center cleanly.
    this.currentPivot = opts.initialFocus.clone();
    this.edgePanEnabled = opts.edgePanEnabled ?? true;
    this.applyCameraTransform();
    this.bind();
  }

  /** Public so an external HUD can read it (e.g. minimap). */
  getFocus(): Readonly<THREE.Vector3> {
    return this.focus;
  }

  /** Where the camera is actually orbiting around this frame. */
  getCurrentPivot(): Readonly<THREE.Vector3> {
    return this.currentPivot;
  }

  /** What target (if any) the orbit pivot is currently easing toward. */
  getFocusTarget(): Readonly<THREE.Vector3> | null {
    return this.focusTarget;
  }

  /**
   * Set the orbit pivot to ease toward `worldPos` each frame. Pass
   * `null` to release back to the user-controlled pan focus.
   *
   * Loud-over-silent: rejects inputs whose Y is wildly out of range
   * (a near-certain bug — usually means a caller forgot to sample
   * the heightmap and passed a raw component value). Warn + drop;
   * the camera keeps its previous target so the player doesn't see
   * a chaotic jump.
   */
  setFocusTarget(worldPos: THREE.Vector3 | null): void {
    if (worldPos === null) {
      this.focusTarget = null;
      return;
    }
    if (
      !Number.isFinite(worldPos.x) ||
      !Number.isFinite(worldPos.y) ||
      !Number.isFinite(worldPos.z)
    ) {
      console.warn(
        `[RtsCamera] setFocusTarget rejected non-finite position (${worldPos.x}, ${worldPos.y}, ${worldPos.z}); keeping previous target`,
      );
      return;
    }
    if (worldPos.y < FOCUS_TARGET_MIN_Y || worldPos.y > FOCUS_TARGET_MAX_Y) {
      console.warn(
        `[RtsCamera] setFocusTarget rejected out-of-bounds Y=${worldPos.y} (must be ${FOCUS_TARGET_MIN_Y}..${FOCUS_TARGET_MAX_Y}); keeping previous target`,
      );
      return;
    }
    if (this.focusTarget === null) {
      this.focusTarget = worldPos.clone();
    } else {
      this.focusTarget.copy(worldPos);
    }
  }

  /**
   * SC2-style "frame selected" — snap the camera onto a unit with
   * no lerp and pull the zoom distance in. Used by the F hotkey.
   * Also moves the pan focus so when the user later deselects, the
   * camera stays where they're now looking instead of springing back.
   */
  frameSelected(worldPos: THREE.Vector3): void {
    if (
      !Number.isFinite(worldPos.x) ||
      !Number.isFinite(worldPos.y) ||
      !Number.isFinite(worldPos.z)
    ) {
      console.warn(
        `[RtsCamera] frameSelected ignored non-finite position (${worldPos.x}, ${worldPos.y}, ${worldPos.z})`,
      );
      return;
    }
    this.focus.copy(worldPos);
    this.clampFocus();
    this.currentPivot.copy(this.focus);
    this.focusTarget = null;
    if (this.distance > FRAME_SELECTED_DISTANCE) {
      this.distance = FRAME_SELECTED_DISTANCE;
    }
    this.applyCameraTransform();
  }

  /** Per-frame update — `dt` is REAL seconds. */
  update(dt: number): void {
    const fast = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const panStep = BASE_PAN_SPEED * (fast ? FAST_PAN_MULT : 1) * dt;

    // Build camera-relative ground vectors from yaw only. W/S pan along
    // the direction the camera faces; A/D pans perpendicular.
    // `forward` points AWAY from the camera (camera looks toward +focus).
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    let panned = false;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) {
      this.focus.x += fx * panStep;
      this.focus.z += fz * panStep;
      panned = true;
    }
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) {
      this.focus.x -= fx * panStep;
      this.focus.z -= fz * panStep;
      panned = true;
    }
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) {
      this.focus.x -= rx * panStep;
      this.focus.z -= rz * panStep;
      panned = true;
    }
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) {
      this.focus.x += rx * panStep;
      this.focus.z += rz * panStep;
      panned = true;
    }

    // Edge-pan: only when cursor is over the canvas + edge-pan is on.
    if (this.edgePanEnabled && this.cursorInside) {
      const rect = this.domElement.getBoundingClientRect();
      const localX = this.mouseX - rect.left;
      const localY = this.mouseY - rect.top;
      const edgeStep = EDGE_PAN_SPEED_M * dt;
      if (localX >= 0 && localX < EDGE_PAN_PX) {
        this.focus.x -= rx * edgeStep;
        this.focus.z -= rz * edgeStep;
        panned = true;
      } else if (localX > rect.width - EDGE_PAN_PX && localX <= rect.width) {
        this.focus.x += rx * edgeStep;
        this.focus.z += rz * edgeStep;
        panned = true;
      }
      if (localY >= 0 && localY < EDGE_PAN_PX) {
        this.focus.x += fx * edgeStep;
        this.focus.z += fz * edgeStep;
        panned = true;
      } else if (localY > rect.height - EDGE_PAN_PX && localY <= rect.height) {
        this.focus.x -= fx * edgeStep;
        this.focus.z -= fz * edgeStep;
        panned = true;
      }
    }

    this.clampFocus();

    // If the user actively panned this frame, they are overriding any
    // selection-driven focus target — release it so the orbit pivot
    // tracks the new pan focus instead of fighting the user.
    if (panned && this.focusTarget !== null) {
      this.focusTarget = null;
    }

    // Ease the orbit pivot toward (focusTarget ?? focus). The pan
    // focus is the resting place; the focus target is a temporary
    // override the runtime sets from selection state.
    const target = this.focusTarget ?? this.focus;
    const dx = target.x - this.currentPivot.x;
    const dy = target.y - this.currentPivot.y;
    const dz = target.z - this.currentPivot.z;
    if (dx * dx + dy * dy + dz * dz <= FOCUS_SNAP_EPS_SQ) {
      this.currentPivot.copy(target);
    } else {
      this.currentPivot.x += dx * FOCUS_LERP_RATE;
      this.currentPivot.y += dy * FOCUS_LERP_RATE;
      this.currentPivot.z += dz * FOCUS_LERP_RATE;
    }

    this.applyCameraTransform();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.domElement.removeEventListener("wheel", this.onWheel);
    this.domElement.removeEventListener("mouseenter", this.onMouseEnter);
    this.domElement.removeEventListener("mouseleave", this.onMouseLeave);
    this.domElement.removeEventListener("contextmenu", this.preventCtx);
    this.keys.clear();
  }

  private bind(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.domElement.addEventListener("wheel", this.onWheel, { passive: false });
    this.domElement.addEventListener("mouseenter", this.onMouseEnter);
    this.domElement.addEventListener("mouseleave", this.onMouseLeave);
    // The CommandController consumes the right-click; RtsCamera no longer
    // needs to swallow the context menu — but doing so anyway is defensive
    // (right-drag rotate UX in the editor's free-fly relies on it).
    this.domElement.addEventListener("contextmenu", this.preventCtx);
  }

  /** Project (yaw, pitch, distance) into a camera position around the pivot. */
  private applyCameraTransform(): void {
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const offX = Math.sin(this.yaw) * cosP * this.distance;
    const offY = sinP * this.distance;
    const offZ = Math.cos(this.yaw) * cosP * this.distance;
    this.camera.position.set(
      this.currentPivot.x + offX,
      this.currentPivot.y + offY,
      this.currentPivot.z + offZ,
    );
    this.camera.lookAt(this.currentPivot);
  }

  private clampFocus(): void {
    const b = this.bounds;
    if (this.focus.x < b.minX) this.focus.x = b.minX;
    else if (this.focus.x > b.maxX) this.focus.x = b.maxX;
    if (this.focus.z < b.minZ) this.focus.z = b.minZ;
    else if (this.focus.z > b.maxZ) this.focus.z = b.maxZ;
  }

  // --- Listeners -------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    // Middle button = rotate. Left/right are reserved for selection +
    // movement commands (the controllers handle them).
    if (e.button === 1) {
      this.rotating = true;
      e.preventDefault();
    }
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) this.rotating = false;
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (this.rotating) {
      this.yaw -= e.movementX * ROTATE_SENSITIVITY;
      this.pitch -= e.movementY * ROTATE_SENSITIVITY;
      const maxRad = MAX_PITCH_DEG * DEG_TO_RAD;
      const minRad = MIN_PITCH_DEG * DEG_TO_RAD;
      if (this.pitch > maxRad) this.pitch = maxRad;
      else if (this.pitch < minRad) this.pitch = minRad;
    }
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = 1 + e.deltaY * WHEEL_ZOOM_PCT;
    this.distance *= factor;
    if (this.distance < MIN_ZOOM_DIST) this.distance = MIN_ZOOM_DIST;
    else if (this.distance > MAX_ZOOM_DIST) this.distance = MAX_ZOOM_DIST;
  };
  private readonly onMouseEnter = (): void => {
    this.cursorInside = true;
  };
  private readonly onMouseLeave = (): void => {
    this.cursorInside = false;
  };
  private readonly preventCtx = (e: Event): void => {
    e.preventDefault();
  };
}
