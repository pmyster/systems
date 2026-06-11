/**
 * CommandController tests — focus on the RMB click-vs-drag disambiguation
 * added 2026-06-07. The classic RTS convention is "right-click on empty
 * ground = move command"; the rebound camera now ALSO uses RMB-drag for
 * rotation. We disambiguate at release time by comparing the down→up
 * displacement and elapsed time against thresholds.
 *
 * What we test here is purely the controller's input math — does a short,
 * still press fire the move? Does a drag suppress it? Does a long-hold
 * also suppress it? The SelectionController / PathFollowController /
 * raycast paths are stubbed because they're not the contract under test.
 */

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

import { CommandController } from "./CommandController";
import { CommandBus } from "../../sim/commandBus";
import { SimClock } from "../../sim/clock";
import type { SelectionController } from "./SelectionController";
import type { PathFollowController } from "../pathfinding/PathFollowController";

/**
 * Build the controller + a way to drive RMB down/up via real MouseEvents.
 * The terrain is a unit-sized horizontal mesh so the raycaster hits
 * something predictable when the cursor is at NDC=(0,0). (Actual
 * geometry of the hit is irrelevant — the test only checks whether the
 * move command was ENQUEUED.)
 */
function makeController(opts?: { withSelection?: boolean }): {
  cmd: CommandController;
  dom: HTMLElement;
  bus: CommandBus;
  requestMove: ReturnType<typeof vi.fn>;
} {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, 0);

  const dom = document.createElement("div");
  Object.defineProperty(dom, "getBoundingClientRect", {
    value: () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      }) as DOMRect,
  });

  // A horizontal terrain mesh large enough to catch the centre-screen
  // raycast. Geometry math need not match reality — the controller
  // calls .intersectObject(terrainMesh) which is happy with any THREE
  // mesh whose bounding sphere the ray pierces.
  // Make the terrain HUGE so any ray from a nearly-overhead camera
  // intersects. The default-orientation PlaneGeometry faces +Z; we
  // rotate it to face up (+Y). updateMatrix() must run BEFORE
  // updateMatrixWorld() — modifying .rotation alone does NOT propagate
  // to .matrix in Three.js.
  const terrainMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshBasicMaterial(),
  );
  terrainMesh.rotation.x = -Math.PI / 2; // face up
  terrainMesh.updateMatrix();
  terrainMesh.updateMatrixWorld(true);
  // Also ensure camera's matrices are up to date — Raycaster.setFromCamera
  // reads camera.projectionMatrix and matrixWorldInverse.
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const bus = new CommandBus();
  const clock = new SimClock({ hz: 30 });

  const selection = {
    getSelectedEids: () => (opts?.withSelection === false ? [] : [1]),
  } as unknown as SelectionController;

  const requestMove = vi.fn();
  const pathFollower = { requestMove } as unknown as PathFollowController;

  const cmd = new CommandController({
    camera,
    domElement: dom,
    terrainMesh,
    commands: bus,
    clock,
    selection,
    pathFollower,
  });
  return { cmd, dom, bus, requestMove };
}

/**
 * Fire a synthetic RMB press-release pair. `holdMs` controls the gap
 * between down and up via a manual time advance — we install a single
 * stub on `performance.now` for the lifetime of the press, then
 * restore. The stub reads from a mutable `currentMs` so we can move
 * time forward between down and up without stacking spies.
 */
function rmbPressRelease(
  dom: HTMLElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  holdMs: number,
): void {
  let currentMs = 1_000_000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => currentMs);
  try {
    dom.dispatchEvent(
      new MouseEvent("mousedown", { button: 2, clientX: fromX, clientY: fromY }),
    );
    currentMs += holdMs;
    window.dispatchEvent(
      new MouseEvent("mouseup", { button: 2, clientX: toX, clientY: toY }),
    );
  } finally {
    spy.mockRestore();
  }
}

describe("CommandController — RMB click vs drag", () => {
  it("short, still press → move command enqueued (click)", () => {
    const { dom, bus, requestMove } = makeController();
    rmbPressRelease(dom, 50, 50, 51, 50, 80); // 1px, 80ms
    expect(requestMove).toHaveBeenCalledTimes(1);
    expect(bus.snapshot().length).toBe(1);
  });

  it("displacement past threshold → drag, no command", () => {
    const { dom, bus, requestMove } = makeController();
    rmbPressRelease(dom, 50, 50, 70, 70, 100); // ~28px, 100ms
    expect(requestMove).not.toHaveBeenCalled();
    expect(bus.snapshot().length).toBe(0);
  });

  it("hold past time threshold → drag, no command", () => {
    const { dom, bus, requestMove } = makeController();
    rmbPressRelease(dom, 50, 50, 51, 50, 300); // 1px but 300ms
    expect(requestMove).not.toHaveBeenCalled();
    expect(bus.snapshot().length).toBe(0);
  });

  it("press at threshold-boundary (exactly 5px) counts as drag", () => {
    // Boundary cases matter — the controller uses >= so 5px is a drag.
    const { dom, requestMove } = makeController();
    rmbPressRelease(dom, 50, 50, 53, 54, 80); // hypot = 5px exactly
    expect(requestMove).not.toHaveBeenCalled();
  });

  it("RMB click with empty selection → no command", () => {
    const { dom, bus, requestMove } = makeController({ withSelection: false });
    rmbPressRelease(dom, 50, 50, 50, 50, 50);
    expect(requestMove).not.toHaveBeenCalled();
    expect(bus.snapshot().length).toBe(0);
  });
});
