/**
 * RtsCamera tests — focus on the orbit-pivot behaviour (no WebGL).
 *
 * The camera math runs entirely on THREE.PerspectiveCamera (which is
 * just a small JS object — no GL context needed). We construct one,
 * hand it to RtsCamera with a stub DOM element, and assert against:
 *   - `getCurrentPivot()` for orbit-center state
 *   - `getFocusTarget()` for the selection override
 *   - `camera.position` for "did the orbit math apply"
 *
 * Why test the controller directly instead of through GameRuntime?
 *   GameRuntime is a React effect with ~50 dependencies (WebGL,
 *   audio, navmesh, recast). The orbit-pivot rule is a pure
 *   property of the camera state machine; unit-test it in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";

import { RtsCamera } from "./RtsCamera";

/**
 * Minimal stub DOM element. RtsCamera only needs:
 *   - addEventListener / removeEventListener
 *   - getBoundingClientRect (read in edge-pan; returns 0×0 → branch skipped)
 * Anything else is fine to ignore.
 */
function makeStubDom(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });
  return el;
}

/** Build a fresh RtsCamera + scratch camera at map center. */
function makeCamera(): { rts: RtsCamera; threeCam: THREE.PerspectiveCamera } {
  const threeCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const dom = makeStubDom();
  const rts = new RtsCamera({
    camera: threeCam,
    domElement: dom,
    bounds: { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
    initialFocus: new THREE.Vector3(50, 0, 50),
    edgePanEnabled: false,
  });
  return { rts, threeCam };
}

function dist2(a: THREE.Vector3, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

describe("RtsCamera — orbit pivot defaults", () => {
  it("starts orbiting around the initial focus (map center)", () => {
    const { rts } = makeCamera();
    const pivot = rts.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(50, 5);
    expect(pivot.z).toBeCloseTo(50, 5);
    expect(rts.getFocusTarget()).toBeNull();
  });

  it("update() with no focus target keeps the pivot at the pan focus", () => {
    const { rts } = makeCamera();
    rts.update(1 / 60);
    rts.update(1 / 60);
    const pivot = rts.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(50, 5);
    expect(pivot.z).toBeCloseTo(50, 5);
  });
});

describe("RtsCamera — setFocusTarget()", () => {
  it("records the target without snapping the pivot immediately", () => {
    const { rts } = makeCamera();
    rts.setFocusTarget(new THREE.Vector3(80, 0, 80));
    // setFocusTarget is INTENT only — actual easing happens in update().
    expect(rts.getFocusTarget()).not.toBeNull();
    // Pivot still where it was on construction.
    const pivot = rts.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(50, 5);
    expect(pivot.z).toBeCloseTo(50, 5);
  });

  it("lerps the pivot toward the target over multiple frames", () => {
    const { rts } = makeCamera();
    rts.setFocusTarget(new THREE.Vector3(80, 0, 80));
    const targetPos = { x: 80, y: 0, z: 80 };
    const initialDist2 = dist2(rts.getCurrentPivot() as THREE.Vector3, targetPos);
    rts.update(1 / 60);
    const d1 = dist2(rts.getCurrentPivot() as THREE.Vector3, targetPos);
    rts.update(1 / 60);
    const d2 = dist2(rts.getCurrentPivot() as THREE.Vector3, targetPos);
    // Monotonically converging.
    expect(d1).toBeLessThan(initialDist2);
    expect(d2).toBeLessThan(d1);
  });

  it("converges to within 1m of the target inside ~60 frames", () => {
    // At 60 Hz with FOCUS_LERP_RATE = 0.18, residual after N frames is
    // ~initial * (0.82)^N. 60 frames ⇒ ~initial * 5e-6. With an initial
    // gap of 30 along each axis, the residual is well below the 1m
    // tolerance used here (matches what a player would visually see).
    const { rts } = makeCamera();
    rts.setFocusTarget(new THREE.Vector3(80, 0, 80));
    for (let i = 0; i < 60; i++) rts.update(1 / 60);
    const pivot = rts.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(80, 0); // ±0.5
    expect(pivot.z).toBeCloseTo(80, 0);
  });

  it("setFocusTarget(null) releases back to the pan focus", () => {
    const { rts } = makeCamera();
    rts.setFocusTarget(new THREE.Vector3(80, 0, 80));
    // Fully converge to the unit target (60 frames @ 18% lerp ⇒ ~1e-5
    // residual; tolerance of 1m below is generous).
    for (let i = 0; i < 60; i++) rts.update(1 / 60);
    expect(rts.getCurrentPivot().x).toBeCloseTo(80, 0);

    // Deselect → pivot should ease back to the map-center pan focus.
    rts.setFocusTarget(null);
    expect(rts.getFocusTarget()).toBeNull();
    for (let i = 0; i < 60; i++) rts.update(1 / 60);
    const pivot = rts.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(50, 0);
    expect(pivot.z).toBeCloseTo(50, 0);
  });

  it("camera position orbits around the CURRENT pivot, not the pan focus", () => {
    const { rts, threeCam } = makeCamera();
    // Pivot starts at (50, 0, 50); zoom + pitch put the camera somewhere
    // ABOVE that point. After moving the orbit pivot to (80, 0, 80) and
    // converging, the camera position should also shift by roughly the
    // same XZ delta.
    const startPos = threeCam.position.clone();
    rts.setFocusTarget(new THREE.Vector3(80, 0, 80));
    for (let i = 0; i < 50; i++) rts.update(1 / 60);
    const endPos = threeCam.position.clone();
    // The XZ delta of the camera should match the XZ delta of the pivot.
    expect(endPos.x - startPos.x).toBeCloseTo(30, 0);
    expect(endPos.z - startPos.z).toBeCloseTo(30, 0);
  });
});

describe("RtsCamera — setFocusTarget() loud-over-silent guards", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("rejects targets with absurdly negative Y and warns", () => {
    const { rts } = makeCamera();
    // First set a valid target so we have something to keep.
    rts.setFocusTarget(new THREE.Vector3(70, 0, 70));
    const before = rts.getFocusTarget();
    expect(before).not.toBeNull();
    // Then try a clearly-broken target (Y = -9999).
    rts.setFocusTarget(new THREE.Vector3(80, -9999, 80));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Previous target preserved — no chaotic jump.
    const after = rts.getFocusTarget()!;
    expect(after.x).toBeCloseTo(70, 5);
    expect(after.y).toBeCloseTo(0, 5);
    expect(after.z).toBeCloseTo(70, 5);
  });

  it("rejects non-finite targets and warns", () => {
    const { rts } = makeCamera();
    rts.setFocusTarget(new THREE.Vector3(NaN, 0, 0));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(rts.getFocusTarget()).toBeNull();
  });
});

describe("RtsCamera — frameSelected()", () => {
  it("snaps the pivot to the unit position with no lerp", () => {
    const { rts } = makeCamera();
    rts.frameSelected(new THREE.Vector3(75, 0, 25));
    const pivot = rts.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(75, 5);
    expect(pivot.z).toBeCloseTo(25, 5);
    // Pan focus also moved — so deselect doesn't spring back.
    const focus = rts.getFocus();
    expect(focus.x).toBeCloseTo(75, 5);
    expect(focus.z).toBeCloseTo(25, 5);
  });

  it("clears any pending focus target (snap supersedes lerp)", () => {
    const { rts } = makeCamera();
    rts.setFocusTarget(new THREE.Vector3(80, 0, 80));
    rts.frameSelected(new THREE.Vector3(20, 0, 20));
    expect(rts.getFocusTarget()).toBeNull();
    const pivot = rts.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(20, 5);
  });

  it("ignores non-finite inputs and keeps state intact", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { rts } = makeCamera();
      rts.frameSelected(new THREE.Vector3(Infinity, 0, 0));
      const pivot = rts.getCurrentPivot();
      expect(pivot.x).toBeCloseTo(50, 5); // still at construction-time focus
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("RtsCamera — pan releases focus target", () => {
  it("WASD pan while a focus target is set releases the target", () => {
    const { rts } = makeCamera();
    rts.setFocusTarget(new THREE.Vector3(80, 0, 80));
    expect(rts.getFocusTarget()).not.toBeNull();

    // Simulate the user holding W (forward pan).
    const keyDown = new KeyboardEvent("keydown", { code: "KeyW" });
    window.dispatchEvent(keyDown);
    rts.update(1 / 60);
    const keyUp = new KeyboardEvent("keyup", { code: "KeyW" });
    window.dispatchEvent(keyUp);

    expect(rts.getFocusTarget()).toBeNull();
  });
});
