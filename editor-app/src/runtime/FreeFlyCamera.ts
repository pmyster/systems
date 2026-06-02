/**
 * FreeFlyCamera — render-side WASD + mouse-look controller.
 *
 * Lives OUTSIDE `/sim` because:
 *   - It reads `performance.now()` (wall-clock smoothing for camera).
 *   - It touches DOM (pointer/keyboard event listeners).
 *   - It mutates a Three.js camera in place.
 * None of that is allowed inside the headless sim. Camera state is
 * pure presentation.
 *
 * Controls (matches the Map Editor's free-fly convention so muscle
 * memory carries between modes):
 *   - WASD             → horizontal pan, camera-relative
 *   - Q / E            → down / up, world-vertical
 *   - Shift            → 3x speed
 *   - Right-mouse drag → yaw + pitch (pitch clamped to ±89°)
 *
 * Sensitivity is fixed at 0.003 rad/px — feel-tested in the brief.
 * If we ever expose a user preference, surface it via the Settings
 * panel, not by hardcoding a different default.
 */

import * as THREE from "three";

/** Pitch clamp keeps the camera from going over the pole and inverting. */
const MAX_PITCH = (Math.PI / 2) * 0.99;
const LOOK_SENSITIVITY = 0.003;
const BASE_SPEED = 5;       // m/s
const FAST_SPEED = 15;      // m/s with Shift held

export class FreeFlyCamera {
  private readonly keys = new Set<string>();
  private dragging = false;
  private yaw = 0;
  private pitch = 0;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
  ) {
    // Initial yaw/pitch derived from the camera's existing orientation
    // so a constructor-after-camera-setup doesn't snap the view.
    this.euler.setFromQuaternion(camera.quaternion);
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
    this.bind();
  }

  private bind(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.domElement.addEventListener("contextmenu", this.preventCtx);
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
  }

  /** Unbind every listener — call in the React effect cleanup. */
  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.domElement.removeEventListener("contextmenu", this.preventCtx);
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.keys.clear();
  }

  /** Per-frame update. `dt` is REAL seconds (not sim-tick seconds). */
  update(dt: number): void {
    // --- Look ---
    this.euler.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(this.euler);

    // --- Move ---
    const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")
      ? FAST_SPEED
      : BASE_SPEED;
    const step = speed * dt;

    // Build camera-relative forward and right vectors from yaw only,
    // so W/A/S/D pan along the horizontal plane regardless of pitch
    // (standard FPS feel).
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.keys.has("KeyW")) this.camera.position.addScaledVector(this.forward, step);
    if (this.keys.has("KeyS")) this.camera.position.addScaledVector(this.forward, -step);
    if (this.keys.has("KeyA")) this.camera.position.addScaledVector(this.right, -step);
    if (this.keys.has("KeyD")) this.camera.position.addScaledVector(this.right, step);
    if (this.keys.has("KeyE")) this.camera.position.addScaledVector(this.up, step);
    if (this.keys.has("KeyQ")) this.camera.position.addScaledVector(this.up, -step);
  }

  // --- Listener implementations -----------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly preventCtx = (e: Event): void => {
    e.preventDefault();
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    // 2 = right button. Left-click is reserved for future unit
    // selection so we don't burn it on look-around.
    if (e.button === 2) this.dragging = true;
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.dragging = false;
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    this.yaw -= e.movementX * LOOK_SENSITIVITY;
    this.pitch -= e.movementY * LOOK_SENSITIVITY;
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;
  };
}
