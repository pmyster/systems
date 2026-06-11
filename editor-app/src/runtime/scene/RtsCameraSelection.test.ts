/**
 * RtsCamera × selection integration test.
 *
 * Verifies the per-frame contract GameRuntime.tsx implements:
 *   - If exactly one entity has the Selected component, the camera's
 *     orbit pivot eases toward that entity's Position each frame.
 *   - If zero or two-plus are selected, the pivot returns to the pan
 *     focus (map center until the player has panned).
 *   - If the unit moves while selected, the pivot tracks it (this is
 *     what gets us "follow the mobile chassis" for free once Task #13
 *     lands).
 *
 * We don't construct a real SelectionController here — clicking + DOM
 * raycast against an InstancedMesh requires WebGL. Instead we write the
 * `Selected` component directly and `query` for it, which is exactly
 * what the controller would do internally. The contract under test is
 * "per-frame ECS read drives camera focus", not "DOM click → ECS write".
 */

import { describe, it, expect } from "vitest";
import { addComponent, addEntity, removeComponent, query } from "bitecs";
import * as THREE from "three";

import {
  Position,
  Selected,
  createSimWorld,
  type SimWorld,
} from "../../sim/world";
import { RtsCamera } from "./RtsCamera";

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

function makeCamera(): RtsCamera {
  const threeCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  return new RtsCamera({
    camera: threeCam,
    domElement: makeStubDom(),
    bounds: { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
    initialFocus: new THREE.Vector3(50, 0, 50),
    edgePanEnabled: false,
  });
}

function spawnAt(
  world: SimWorld,
  x: number,
  y: number,
  z: number,
): number {
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  return eid;
}

/**
 * Re-implements the per-frame snippet from GameRuntime.tsx that links
 * selection state to the camera. Keeping the snippet in one helper here
 * lets the test pin the contract without copying brittle wiring code.
 */
function driveCameraFromSelection(
  world: SimWorld,
  cam: RtsCamera,
  tmp: THREE.Vector3,
): void {
  const sel = query(world, [Selected]);
  if (sel.length === 1) {
    const eid = sel[0];
    cam.setFocusTarget(
      tmp.set(Position.x[eid], Position.y[eid], Position.z[eid]),
    );
  } else {
    cam.setFocusTarget(null);
  }
}

describe("RtsCamera × selection", () => {
  it("selecting one unit causes the pivot to ease toward that unit", () => {
    const world = createSimWorld();
    const cam = makeCamera();
    const tmp = new THREE.Vector3();
    const eid = spawnAt(world, 90, 0, 10);
    addComponent(world, eid, Selected);

    // Simulate ~30 frames of the GameRuntime loop.
    // 60 frames at 18% lerp ≈ 1e-5 residual on a 40m gap — plenty
    // tight for the ±0.5m tolerance below.
    for (let i = 0; i < 60; i++) {
      driveCameraFromSelection(world, cam, tmp);
      cam.update(1 / 60);
    }

    const pivot = cam.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(90, 0); // within 0.5m
    expect(pivot.z).toBeCloseTo(10, 0);
  });

  it("the pivot tracks a unit that moves while selected", () => {
    const world = createSimWorld();
    const cam = makeCamera();
    const tmp = new THREE.Vector3();
    const eid = spawnAt(world, 60, 0, 60);
    addComponent(world, eid, Selected);

    // Phase 1: settle on initial position (60 frames ≈ fully converged).
    for (let i = 0; i < 60; i++) {
      driveCameraFromSelection(world, cam, tmp);
      cam.update(1 / 60);
    }
    expect(cam.getCurrentPivot().x).toBeCloseTo(60, 0);

    // Phase 2: move the unit.
    Position.x[eid] = 30;
    Position.z[eid] = 30;
    // 60 frames at 18% lerp ≈ 1e-5 residual on a 40m gap — plenty
    // tight for the ±0.5m tolerance below.
    for (let i = 0; i < 60; i++) {
      driveCameraFromSelection(world, cam, tmp);
      cam.update(1 / 60);
    }
    const pivot = cam.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(30, 0);
    expect(pivot.z).toBeCloseTo(30, 0);
  });

  it("deselecting keeps the pivot where it was — does not glide back to map center", () => {
    // 2026-06-07: rebound from the original "glide back to map center"
    // to "stay-where-deselected" — the owner found the auto-glide-home
    // disorienting. New contract: on deselect, the pan focus is
    // reseated to wherever the camera was looking, so the next frame's
    // lerp target is the same point. The camera holds still.
    const world = createSimWorld();
    const cam = makeCamera();
    const tmp = new THREE.Vector3();
    const eid = spawnAt(world, 90, 0, 10);
    addComponent(world, eid, Selected);

    // 60 frames at 18% lerp ≈ 1e-5 residual on a 40m gap — plenty
    // tight for the ±0.5m tolerance below.
    for (let i = 0; i < 60; i++) {
      driveCameraFromSelection(world, cam, tmp);
      cam.update(1 / 60);
    }
    expect(cam.getCurrentPivot().x).toBeCloseTo(90, 0);

    // Deselect — pivot must STAY near (90, _, 10), not return to (50, _, 50).
    removeComponent(world, eid, Selected);
    for (let i = 0; i < 60; i++) {
      driveCameraFromSelection(world, cam, tmp);
      cam.update(1 / 60);
    }
    const pivot = cam.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(90, 0);
    expect(pivot.z).toBeCloseTo(10, 0);
  });

  it("multi-select (2+) leaves the pivot at the pan focus", () => {
    const world = createSimWorld();
    const cam = makeCamera();
    const tmp = new THREE.Vector3();
    const eidA = spawnAt(world, 10, 0, 10);
    const eidB = spawnAt(world, 90, 0, 90);
    addComponent(world, eidA, Selected);
    addComponent(world, eidB, Selected);

    // 60 frames at 18% lerp ≈ 1e-5 residual on a 40m gap — plenty
    // tight for the ±0.5m tolerance below.
    for (let i = 0; i < 60; i++) {
      driveCameraFromSelection(world, cam, tmp);
      cam.update(1 / 60);
    }
    // No focus target ever set; pivot stays at the pan focus (map center).
    expect(cam.getFocusTarget()).toBeNull();
    const pivot = cam.getCurrentPivot();
    expect(pivot.x).toBeCloseTo(50, 5);
    expect(pivot.z).toBeCloseTo(50, 5);
  });
});
