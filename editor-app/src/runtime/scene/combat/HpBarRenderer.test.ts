/**
 * HpBarRenderer tests.
 *
 * Pure unit tests against an in-memory SimWorld. No WebGL — Three.js
 * Sprites can be instantiated under jsdom (they're just objects with
 * Materials), and we read sprite.visible / sprite.scale / sprite.material
 * directly. No renderer.render() call.
 */

import { describe, it, expect } from "vitest";
import { addComponent, addEntity, removeComponent } from "bitecs";
import * as THREE from "three";

import {
  Dead,
  Health,
  Position,
  Renderable,
  WeaponInstanceTag,
  createSimWorld,
  type SimWorld,
} from "../../../sim/world";
import {
  HpBarRenderer,
  DEFAULT_BAR_WIDTH,
  DEFAULT_Y_OFFSET,
  HP_BAR_TARGET_WIDTH_PX,
  HP_BAR_TARGET_HEIGHT_PX,
  HP_BAR_MIN_DISTANCE,
  computeWorldUnitsPerPixel,
} from "./HpBarRenderer";

/** Spawn a minimal "unit" entity with Position + Health + Renderable. */
function spawnUnit(
  world: SimWorld,
  x: number,
  y: number,
  z: number,
  hpCurrent: number,
  hpMax: number,
): number {
  const eid = addEntity(world);
  addComponent(world, eid, Renderable);
  addComponent(world, eid, Position);
  addComponent(world, eid, Health);
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  Health.current[eid] = hpCurrent;
  Health.max[eid] = hpMax;
  return eid;
}

/** Approx equality for floats. */
function near(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

describe("HpBarRenderer", () => {
  it("binds a slot for a living unit with damage taken", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 10, 0, 20, 50, 100);

    bars.updateFromWorld(world);

    expect(bars.slotOf(eid)).toBeGreaterThanOrEqual(0);
    expect(bars.activeCount()).toBe(1);

    const fill = bars.getFillSpriteForTesting(eid)!;
    const bg = bars.getBgSpriteForTesting(eid)!;
    expect(fill.visible).toBe(true);
    expect(bg.visible).toBe(true);

    bars.dispose();
  });

  it("scales the fill sprite by health fraction (50% → half width)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 50, 100);

    bars.updateFromWorld(world);

    const fill = bars.getFillSpriteForTesting(eid)!;
    expect(near(fill.scale.x, DEFAULT_BAR_WIDTH * 0.5)).toBe(true);

    const bg = bars.getBgSpriteForTesting(eid)!;
    expect(near(bg.scale.x, DEFAULT_BAR_WIDTH)).toBe(true);

    bars.dispose();
  });

  it("colours bar green when health > 66%", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 80, 100);

    bars.updateFromWorld(world);
    const fill = bars.getFillSpriteForTesting(eid)!;
    const c = (fill.material as THREE.SpriteMaterial).color;
    expect(c.getHex()).toBe(0x3aff5a);
    bars.dispose();
  });

  it("colours bar yellow when 33% < health < 66%", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 50, 100);

    bars.updateFromWorld(world);
    const fill = bars.getFillSpriteForTesting(eid)!;
    const c = (fill.material as THREE.SpriteMaterial).color;
    expect(c.getHex()).toBe(0xffd84a);
    bars.dispose();
  });

  it("colours bar red when health <= 33%", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 20, 100);

    bars.updateFromWorld(world);
    const fill = bars.getFillSpriteForTesting(eid)!;
    const c = (fill.material as THREE.SpriteMaterial).color;
    expect(c.getHex()).toBe(0xff3a3a);
    bars.dispose();
  });

  it("hides the bar for entities tagged Dead", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 30, 100);

    bars.updateFromWorld(world);
    expect(bars.slotOf(eid)).toBeGreaterThanOrEqual(0);

    // Kill the entity and re-update — bar should release.
    addComponent(world, eid, Dead);
    bars.updateFromWorld(world);
    expect(bars.slotOf(eid)).toBe(-1);
    expect(bars.activeCount()).toBe(0);

    bars.dispose();
  });

  it("toggle off via setVisible hides all bars (group.visible = false)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    spawnUnit(world, 0, 0, 0, 50, 100);
    spawnUnit(world, 5, 0, 0, 90, 100);

    bars.updateFromWorld(world);
    expect(bars.activeCount()).toBe(2);
    expect(bars.group.visible).toBe(true);

    bars.setVisible(false);
    expect(bars.group.visible).toBe(false);
    expect(bars.isVisible()).toBe(false);

    // Subsequent updates while hidden don't crash and don't allocate slots.
    bars.updateFromWorld(world);

    // Toggle back on.
    bars.setVisible(true);
    bars.updateFromWorld(world);
    expect(bars.group.visible).toBe(true);
    expect(bars.activeCount()).toBe(2);

    bars.dispose();
  });

  it("releases the slot when an entity disappears from the query (despawn)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid1 = spawnUnit(world, 0, 0, 0, 50, 100);
    const eid2 = spawnUnit(world, 10, 0, 0, 50, 100);

    bars.updateFromWorld(world);
    expect(bars.activeCount()).toBe(2);

    // Strip Renderable from eid1 to simulate despawn (the bitECS-y way
    // for a test without invoking the full sim teardown).
    removeComponent(world, eid1, Renderable);

    bars.updateFromWorld(world);
    expect(bars.slotOf(eid1)).toBe(-1);
    expect(bars.slotOf(eid2)).toBeGreaterThanOrEqual(0);
    expect(bars.activeCount()).toBe(1);

    bars.dispose();
  });

  it("skips WeaponInstanceTag entities (they're Renderable but not units)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const unit = spawnUnit(world, 0, 0, 0, 50, 100);
    const weapon = spawnUnit(world, 0, 0, 0, 50, 100);
    addComponent(world, weapon, WeaponInstanceTag);

    bars.updateFromWorld(world);
    expect(bars.slotOf(unit)).toBeGreaterThanOrEqual(0);
    expect(bars.slotOf(weapon)).toBe(-1);
    expect(bars.activeCount()).toBe(1);

    bars.dispose();
  });

  it("hideAtFullHealth=true hides bars at exactly max HP", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer({ hideAtFullHealth: true });
    const full = spawnUnit(world, 0, 0, 0, 100, 100);
    const damaged = spawnUnit(world, 5, 0, 0, 50, 100);

    bars.updateFromWorld(world);
    expect(bars.slotOf(full)).toBe(-1);
    expect(bars.slotOf(damaged)).toBeGreaterThanOrEqual(0);

    bars.dispose();
  });

  it("default (hideAtFullHealth=false) shows bars at full HP", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const full = spawnUnit(world, 0, 0, 0, 100, 100);

    bars.updateFromWorld(world);
    expect(bars.slotOf(full)).toBeGreaterThanOrEqual(0);

    bars.dispose();
  });

  it("positions the bar above the unit by yOffset", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 7, 2, -3, 50, 100);

    bars.updateFromWorld(world);
    const fill = bars.getFillSpriteForTesting(eid)!;
    expect(near(fill.position.x, 7)).toBe(true);
    expect(near(fill.position.y, 2 + DEFAULT_Y_OFFSET)).toBe(true);
    expect(near(fill.position.z, -3)).toBe(true);

    bars.dispose();
  });

  // --- Constant-screen-size scaling --------------------------------------
  //
  // These tests cover the camera-aware code path. The renderer scales each
  // sprite's world size per-frame so it lands on a constant pixel size
  // (HP_BAR_TARGET_WIDTH_PX × HP_BAR_TARGET_HEIGHT_PX) regardless of the
  // camera's distance from the unit. Far units get LARGER world-scale,
  // near units get SMALLER — both end up the same on screen.

  /** Standard test camera at a known position, FOV, and viewport height. */
  function makeTestCamera(): {
    camera: THREE.PerspectiveCamera;
    viewportHeightPx: number;
  } {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
    const viewportHeightPx = 720;
    return { camera, viewportHeightPx };
  }

  it("computeWorldUnitsPerPixel: matches the closed-form perspective formula", () => {
    // For fov=60°, viewport=720px, distance=10m:
    //   H_world = 2 * 10 * tan(30°) ≈ 11.547
    //   per pixel = 11.547 / 720 ≈ 0.016037
    const wpp = computeWorldUnitsPerPixel(10, 60, 720);
    const expected = (2 * 10 * Math.tan(Math.PI / 6)) / 720;
    expect(near(wpp, expected, 1e-6)).toBe(true);
  });

  it("constant-screen scaling: at distance 10m the sprite matches the formula", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 100, 100);

    const { camera, viewportHeightPx } = makeTestCamera();
    // Place camera 10m directly above the unit's bar anchor (y + yOffset).
    camera.position.set(0, DEFAULT_Y_OFFSET + 10, 0);

    bars.updateFromWorld(world, camera, viewportHeightPx);

    const bg = bars.getBgSpriteForTesting(eid)!;
    const expectedPerPx = computeWorldUnitsPerPixel(10, 60, viewportHeightPx);
    const expectedWidth = HP_BAR_TARGET_WIDTH_PX * expectedPerPx;
    const expectedHeight = HP_BAR_TARGET_HEIGHT_PX * expectedPerPx;

    expect(near(bg.scale.x, expectedWidth, 1e-4)).toBe(true);
    expect(near(bg.scale.y, expectedHeight, 1e-4)).toBe(true);

    bars.dispose();
  });

  it("constant-screen scaling: distance 100m → world scale is 10× distance 10m (linear)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 100, 100);

    const { camera, viewportHeightPx } = makeTestCamera();

    // First sample at 10m.
    camera.position.set(0, DEFAULT_Y_OFFSET + 10, 0);
    bars.updateFromWorld(world, camera, viewportHeightPx);
    const scaleAt10 = bars.getBgSpriteForTesting(eid)!.scale.x;

    // Then sample at 100m.
    camera.position.set(0, DEFAULT_Y_OFFSET + 100, 0);
    bars.updateFromWorld(world, camera, viewportHeightPx);
    const scaleAt100 = bars.getBgSpriteForTesting(eid)!.scale.x;

    // Linear in distance → 100m should be ~10× larger world scale than 10m.
    expect(near(scaleAt100 / scaleAt10, 10, 1e-3)).toBe(true);

    bars.dispose();
  });

  it("constant-screen scaling: distance below MIN_DISTANCE clamps (no infinity / no shrink to zero)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 100, 100);

    const { camera, viewportHeightPx } = makeTestCamera();
    // Camera ON TOP OF the bar anchor — distance ≈ 0.
    camera.position.set(0, DEFAULT_Y_OFFSET, 0);

    bars.updateFromWorld(world, camera, viewportHeightPx);

    const bg = bars.getBgSpriteForTesting(eid)!;
    // Scale must equal the floor (MIN_DISTANCE), not be 0 or Infinity.
    const expectedPerPx = computeWorldUnitsPerPixel(
      HP_BAR_MIN_DISTANCE,
      60,
      viewportHeightPx,
    );
    const expectedWidth = HP_BAR_TARGET_WIDTH_PX * expectedPerPx;

    expect(Number.isFinite(bg.scale.x)).toBe(true);
    expect(bg.scale.x).toBeGreaterThan(0);
    expect(near(bg.scale.x, expectedWidth, 1e-4)).toBe(true);

    bars.dispose();
  });

  it("constant-screen scaling: fill width still scales by health fraction (50% damaged)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 50, 100);

    const { camera, viewportHeightPx } = makeTestCamera();
    camera.position.set(0, DEFAULT_Y_OFFSET + 20, 0);

    bars.updateFromWorld(world, camera, viewportHeightPx);

    const bg = bars.getBgSpriteForTesting(eid)!;
    const fill = bars.getFillSpriteForTesting(eid)!;
    // Fill should be exactly half the background's width — independent of
    // the world scale chosen for the constant-pixel target.
    expect(near(fill.scale.x, bg.scale.x * 0.5, 1e-4)).toBe(true);
    // Heights match (only X is the health indicator).
    expect(near(fill.scale.y, bg.scale.y, 1e-4)).toBe(true);

    bars.dispose();
  });

  it("constant-screen scaling: no-camera path uses legacy fixed world size (back-compat)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 100, 100);

    // Call without camera/viewport — exercises the legacy fallback.
    bars.updateFromWorld(world);

    const bg = bars.getBgSpriteForTesting(eid)!;
    expect(near(bg.scale.x, DEFAULT_BAR_WIDTH)).toBe(true);

    bars.dispose();
  });

  it("warns once and skips when max HP is 0 (loud-over-silent)", () => {
    const world = createSimWorld();
    const bars = new HpBarRenderer();
    const eid = spawnUnit(world, 0, 0, 0, 0, 0);

    const warnSpy = (globalThis as { console: Console }).console.warn;
    let warns = 0;
    (globalThis as { console: Console }).console.warn = () => {
      warns++;
    };
    try {
      bars.updateFromWorld(world);
      bars.updateFromWorld(world); // second pass — should not re-warn
      expect(warns).toBe(1);
      expect(bars.slotOf(eid)).toBe(-1);
    } finally {
      (globalThis as { console: Console }).console.warn = warnSpy;
    }

    bars.dispose();
  });
});
