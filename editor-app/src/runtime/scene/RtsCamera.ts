/**
 * RtsCamera — Phase 1 Week 2 (rebound 2026-06-07 per owner brief)
 *
 * Render-side top-down RTS camera controller. Replaces FreeFlyCamera in
 * the game runtime.
 *
 * Camera model: orbit around a focus point on (mostly) the ground plane.
 *
 * Mouse bindings (matches classic RTS / 3D-editor convention):
 *   - LMB:                handled by SelectionController (select + marquee).
 *   - RMB DRAG:           rotate yaw + pitch around the current pivot.
 *   - RMB CLICK (no drag): consumed by CommandController as a move command
 *                         (the controllers cooperate via click-vs-drag
 *                         threshold; RtsCamera only handles the drag).
 *   - MMB DRAG:           pan parallel to the ground, "grab-the-world".
 *                         Pivot and camera position translate by the same
 *                         XZ delta so the orbit geometry is preserved.
 *   - Mouse wheel:        zoom (distance from focus, clamped MIN..MAX).
 *   - WASD / arrows:      pan the focus along the ground (camera-relative).
 *   - Edge-pan:           cursor within EDGE_PAN_PX of a window edge →
 *                         pan in that direction. Toggle off via
 *                         `edgePanEnabled = false`.
 *
 * Why not THREE.OrbitControls?
 *   OrbitControls is too "let the artist look at the model" — it
 *   damps everything, doesn't compose with edge-pan, and lacks the
 *   map-bounds clamp + terrain Y-clamp.
 *
 * Terrain Y-clamp:
 *   The camera position cannot drop below the heightmap-Y at its
 *   (X, Z), plus CAMERA_TERRAIN_CLEARANCE_M. Prevents the camera from
 *   tunneling into a hill when zoomed in over high terrain. Sampler is
 *   injected via the constructor; if no sampler is supplied (e.g. in
 *   pure unit tests), the clamp is a no-op.
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
 *
 *   Stay-where-deselected (changed 2026-06-07):
 *     When the runtime clears the focus target (no selection), the pan
 *     focus is reseated to the CURRENT pivot. The camera stays exactly
 *     where it was on deselect instead of gliding back to map center.
 *     The owner found the auto-glide-home behaviour annoying — modern
 *     RTS / 3D-editor convention is "deselect = don't move the camera".
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

/**
 * Min zoom dropped from 8 → 5 (2026-06-07): owner reported the closest
 * frame felt "still too far away to see a turret as a POV character".
 * 5m puts the camera roughly at the over-the-shoulder distance of a
 * single chassis (typical chassis bounding sphere ~3m).
 */
const MIN_ZOOM_DIST = 5;
/**
 * Max zoom raised 200 → 600 (2026-06-07) so the owner can pull all the
 * way back and see the full map in one frame on a 256m+ map.
 */
const MAX_ZOOM_DIST = 600;
const DEFAULT_ZOOM_DIST = 50;
const WHEEL_ZOOM_PCT = 0.0015; // per delta-px

const BASE_PAN_SPEED = 20; // m/sec (keyboard)
const FAST_PAN_MULT = 2.5; // Shift held

const ROTATE_SENSITIVITY = 0.006; // rad/px (RMB drag)

/**
 * Mouse-drag pan: world-meters per pixel of drag. Calibrated so that a
 * full screen sweep moves the camera by ~the visible ground width at
 * the current zoom distance. Tuned by feel against MapSceneManager.
 */
const MOUSE_PAN_SPEED_PER_DIST = 0.0025; // multiplied by `distance`

const EDGE_PAN_PX = 20;
const EDGE_PAN_SPEED_M = 30; // m/sec when at edge

/**
 * Vertical clearance kept between the camera position and the terrain
 * under it. 2m → camera never tunnels into a hill, even when zoomed in
 * close. Loud-over-silent: if the sampler returns a non-finite value
 * (out-of-bounds with a buggy sampler), the clamp is skipped silently —
 * we'd rather render the camera in a slightly weird spot than NaN-corrupt
 * its position.
 */
const CAMERA_TERRAIN_CLEARANCE_M = 2;

/**
 * Pan bounds: PIVOT clamps to the map AABB exactly; CAMERA position is
 * allowed to extend this far outside the map (so when zoomed out + tilted
 * back, the player can frame the map edge without the pivot pinning it).
 */
const CAMERA_BOUNDS_EXPAND_M = 50;

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

/**
 * Optional injected terrain Y sampler. The camera uses this to clamp its
 * own position above the heightmap and to keep the pivot glued to the
 * ground. Returning a non-finite value (e.g. out-of-bounds) tells the
 * camera "no terrain known here" — it skips the clamp this frame rather
 * than NaN-corrupting position.
 *
 * Loud-over-silent: an OOB sampler return is plausible at the camera's
 * outer bounds (the camera can extend ±50m past the map). We deliberately
 * don't WARN on this — it would spam every frame. The camera-bounds clamp
 * still keeps things reasonable, and the visible failure mode (camera
 * hovering at its previous Y) is benign.
 */
export type TerrainHeightSampler = (x: number, z: number) => number | null;

export interface RtsCameraOpts {
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;
  readonly bounds: RtsCameraBounds;
  /** World-space starting focus point (usually map center). */
  readonly initialFocus: THREE.Vector3;
  /** Default true — set false to disable mouse edge-pan. */
  readonly edgePanEnabled?: boolean;
  /**
   * Optional heightmap sampler for terrain Y-clamp on the camera + pivot.
   * Omit in unit tests — the clamp becomes a no-op.
   */
  readonly heightAt?: TerrainHeightSampler;
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
  private readonly heightAt: TerrainHeightSampler | null;
  private yaw = 0;
  private pitch = DEFAULT_PITCH_DEG * DEG_TO_RAD;
  private distance = DEFAULT_ZOOM_DIST;
  private readonly keys = new Set<string>();
  /** RMB drag → rotate yaw/pitch around the current pivot. */
  private rotating = false;
  /** MMB drag → pan pivot+camera together by an XZ delta. */
  private panning = false;
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
    this.heightAt = opts.heightAt ?? null;
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
      // Stay-where-deselected: when the runtime releases the focus
      // target, reseat the pan focus to where the camera is currently
      // looking. Without this the camera would lerp back to the original
      // pan focus (typically map center on a fresh match), which the
      // owner found jarring after Task #28. Modern RTS / 3D-editor
      // convention is "deselect = camera stays put". Only do this on
      // the LEADING edge of the null transition — if we're already
      // null, the user is panning/rotating freely and we mustn't
      // hijack their pan focus every frame.
      if (this.focusTarget !== null) {
        this.focus.copy(this.currentPivot);
        this.clampFocus();
      }
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

    // Clamp the pivot to terrain Y so the orbit center sits on the
    // ground. If the sampler returns non-finite (off-map), keep the
    // previous Y rather than NaN-stamping. Done AFTER the lerp so the
    // visible pivot is always grounded.
    if (this.heightAt) {
      const py = this.heightAt(this.currentPivot.x, this.currentPivot.z);
      if (py !== null && Number.isFinite(py)) {
        this.currentPivot.y = py;
      }
    }

    this.applyCameraTransform();

    // After applying yaw/pitch/distance, enforce the camera's own
    // terrain floor + horizontal bounds. The orbit transform may have
    // dropped the camera below ground when zoomed in at a low pitch
    // over high terrain; lift it back up. Horizontal bounds keep the
    // camera from drifting to absurd offsets even if the pivot is at
    // the map edge.
    this.clampCameraPosition();
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

  /**
   * Lift the camera above the terrain (sampler may return non-finite for
   * off-map, in which case we skip — see TerrainHeightSampler doc) and
   * keep the horizontal position inside `bounds` expanded by
   * CAMERA_BOUNDS_EXPAND_M. The expand-margin is what lets the player
   * "pull back to see the edge" without the camera pinning at the map
   * AABB.
   */
  private clampCameraPosition(): void {
    const b = this.bounds;
    const minX = b.minX - CAMERA_BOUNDS_EXPAND_M;
    const maxX = b.maxX + CAMERA_BOUNDS_EXPAND_M;
    const minZ = b.minZ - CAMERA_BOUNDS_EXPAND_M;
    const maxZ = b.maxZ + CAMERA_BOUNDS_EXPAND_M;
    if (this.camera.position.x < minX) this.camera.position.x = minX;
    else if (this.camera.position.x > maxX) this.camera.position.x = maxX;
    if (this.camera.position.z < minZ) this.camera.position.z = minZ;
    else if (this.camera.position.z > maxZ) this.camera.position.z = maxZ;
    if (this.heightAt) {
      const groundY = this.heightAt(this.camera.position.x, this.camera.position.z);
      if (groundY !== null && Number.isFinite(groundY)) {
        const floor = groundY + CAMERA_TERRAIN_CLEARANCE_M;
        if (this.camera.position.y < floor) this.camera.position.y = floor;
      }
    }
  }

  /**
   * MMB-drag pan helper. Translates pivot AND camera by the same XZ
   * delta in world space so the orbit geometry (yaw/pitch/distance) is
   * unchanged. Math mirrors MapSceneManager's "grab the world" pan
   * (commit c5980a5).
   */
  private panByScreenDelta(dxPx: number, dyPx: number): void {
    const speed = MOUSE_PAN_SPEED_PER_DIST * this.distance;
    const dx = -dxPx * speed;
    const dz = -dyPx * speed;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const wx = rx * dx + fx * dz;
    const wz = rz * dx + fz * dz;
    this.focus.x += wx;
    this.focus.z += wz;
    this.currentPivot.x += wx;
    this.currentPivot.z += wz;
    this.clampFocus();
    // Also pin the currentPivot to bounds — otherwise the lerp target
    // (focus) stays clamped but the visible pivot drifts off-map every
    // time the user pan-drags past the edge.
    const b = this.bounds;
    if (this.currentPivot.x < b.minX) this.currentPivot.x = b.minX;
    else if (this.currentPivot.x > b.maxX) this.currentPivot.x = b.maxX;
    if (this.currentPivot.z < b.minZ) this.currentPivot.z = b.minZ;
    else if (this.currentPivot.z > b.maxZ) this.currentPivot.z = b.maxZ;
    // If the user is dragging the world around, that overrides any
    // selection-driven focus target — same rule as WASD pan.
    if (this.focusTarget !== null) this.focusTarget = null;
  }

  // --- Listeners -------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    // Button mapping (rebound 2026-06-07):
    //   button 0 (LMB) → SelectionController (select + marquee).
    //   button 1 (MMB) → pan.
    //   button 2 (RMB) → rotate (CommandController consumes a SHORT click
    //                   as a move command; the drag belongs to us).
    if (e.button === 1) {
      this.panning = true;
      e.preventDefault();
    } else if (e.button === 2) {
      this.rotating = true;
      // No preventDefault here: CommandController also listens for RMB
      // down and prevents the move-command's own default. The contextmenu
      // handler on the canvas suppresses the browser menu separately.
    }
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) this.panning = false;
    else if (e.button === 2) this.rotating = false;
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
    } else if (this.panning) {
      this.panByScreenDelta(e.movementX, e.movementY);
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
