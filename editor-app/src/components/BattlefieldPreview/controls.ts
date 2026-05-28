/**
 * Viewer controls for the Battlefield Preview.
 *
 * Scope per the brief: zoom + light rotation only. No selection, no
 * box-select, no click-to-move. The brief explicitly removes the
 * prototype's unit interactions.
 *
 * Inputs (all relative to the renderer's canvas):
 *   - Mouse wheel        → strategic zoom (camera distance).
 *   - Middle-drag        → orbit the sun azimuth (preview lighting from
 *                          different angles).
 *   - Q / E              → tilt-clamped pitch (held-key driven; the
 *                          render loop calls `tickKeys`).
 *
 * The hand-rolled approach matches prototype 3's pattern; OrbitControls
 * is not pulled in because the brief forbids new dependencies.
 *
 * `attachControls` wires DOM listeners on the canvas and the document
 * (for keys). It returns a detach function the mount effect uses for
 * cleanup. The function is pure with respect to React state — it
 * mutates the `cameraRig` and `lighting` handles directly, exactly
 * like the prototype mutated globals.
 */

import type { CameraRig } from "./scene";
import type { LightingHandle } from "./lighting";

/** Keyboard map populated by attachControls; consumed by tickKeys. */
export interface KeyState {
  q: boolean;
  e: boolean;
}

/** Per-tick rate for keyboard pitch (radians/sec). */
const KEY_PITCH_RATE = 0.6;

export interface ControlsHandle {
  /** Currently held keys. */
  readonly keys: KeyState;
  /**
   * Apply held-key state to the camera. Call once per render-loop
   * frame with `dt` in seconds.
   */
  tickKeys(dt: number): boolean;
  /** Detach all DOM listeners; safe to call multiple times. */
  detach(): void;
}

/**
 * Attach controls to a canvas. The owning React effect should detach
 * on unmount via the returned handle.
 */
export function attachControls(
  canvas: HTMLCanvasElement,
  cameraRig: CameraRig,
  lighting: LightingHandle,
): ControlsHandle {
  const keys: KeyState = { q: false, e: false };

  // ---- Mouse wheel: strategic zoom -----------------------------------------
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    cameraRig.setZoom(cameraRig.zoom + e.deltaY * 0.05);
  };

  // ---- Middle-drag: orbit the sun ------------------------------------------
  // Dragging horizontally rotates the sun's azimuth; vertically tilts
  // its elevation. The lighting handle clamps elevation away from the
  // horizon/zenith to keep shadows readable.
  let sunDragging = false;
  let sunDragX = 0;
  let sunDragY = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 1) return; // middle button only
    sunDragging = true;
    sunDragX = e.clientX;
    sunDragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!sunDragging) return;
    const dx = e.clientX - sunDragX;
    const dy = e.clientY - sunDragY;
    sunDragX = e.clientX;
    sunDragY = e.clientY;
    const az = lighting.getSunAzimuth() + dx * 0.01;
    const elevRaw = lighting.getSunElevation() - dy * 0.005;
    const elev = Math.max(0.12, Math.min(Math.PI / 2 - 0.05, elevRaw));
    lighting.setSunDirection(az, elev);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!sunDragging) return;
    sunDragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };

  // Suppress the browser's context menu on right-click so a future
  // right-drag (if we ever add one) isn't pre-empted. Cheap and safe.
  const onContextMenu = (e: Event) => e.preventDefault();

  // ---- Keys: Q / E pitch ---------------------------------------------------
  // Guard against typing in form inputs (the centre AttributeForm) so
  // the operator's "Q" in a field name doesn't pitch the camera.
  function isEditingInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    );
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (isEditingInput(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === "q") keys.q = true;
    else if (k === "e") keys.e = true;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "q") keys.q = false;
    else if (k === "e") keys.e = false;
  };

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };

  return {
    keys,
    tickKeys(dt: number) {
      let changed = false;
      if (keys.q) {
        cameraRig.setPitch(cameraRig.pitch - dt * KEY_PITCH_RATE);
        changed = true;
      }
      if (keys.e) {
        cameraRig.setPitch(cameraRig.pitch + dt * KEY_PITCH_RATE);
        changed = true;
      }
      return changed;
    },
    detach,
  };
}
