/**
 * HpBarRenderer — Phase 2 Stage 1 follow-up.
 *
 * Persistent HP bar floating above every living unit. The owner couldn't
 * tell visually whether tanks were damaging each other — bars give the
 * standard RTS feedback loop: green at full HP, fading through yellow to
 * red as damage accumulates, vanishing on death.
 *
 * ------------------------------------------------------------------
 * Approach: THREE.Sprite pool (one pair of sprites per slot)
 * ------------------------------------------------------------------
 *
 * Two Sprites per unit slot:
 *   - background: dark bar so the empty portion is still visible
 *   - fill:       coloured bar scaled by health.current / health.max
 *
 * Both sprites use `center.x = 0` so scaling X grows rightward from the
 * left edge. Both are stamped at the same world position (unit XYZ +
 * Y_OFFSET); Three.js auto-billboards them to the camera each frame.
 *
 * Why Sprite, not InstancedMesh?
 *   At Phase 1 scale (≤ ~100 units, ~200 sprites = 200 draw calls) the
 *   Sprite path is simpler and ships first. Sprite material gives us
 *   billboarding + per-instance colour + per-instance scale.x for free.
 *   An InstancedMesh design (two instanced quads + a billboard vertex
 *   shader + an instanceColor attribute) is a real ~3-4x perf win at
 *   500+ units, but the code budget is ~2x.
 *
 *   The upgrade path is documented at the bottom of this file. Cross the
 *   bridge when the unit budget actually pushes 500+ and the profile
 *   shows draw-call cost in the top 3.
 *
 * ------------------------------------------------------------------
 * Pool / slot model
 * ------------------------------------------------------------------
 *
 * We never destroy a sprite — sprites stay parented to `group`, just
 * toggled `visible = false` when their slot is vacant or the unit is
 * dead/full-hidden. New units claim the lowest-index inactive slot. This
 * matches the InstancedUnitRenderer's "slot is an index, not an entity"
 * model and avoids per-spawn allocation.
 *
 * Slot map: { eid → slot } AND a free-list of slot indices. Lookup +
 * release are O(1).
 *
 * ------------------------------------------------------------------
 * Loud-over-silent (CLAUDE.md)
 * ------------------------------------------------------------------
 *
 * If `updateFromWorld` is asked to render a slot whose entity has no
 * `Health` component (i.e. someone registered a non-combatant), we warn
 * ONCE per eid and skip — we don't render a degenerate 0/0 bar. The
 * warn surfaces the contract gap without spamming.
 *
 * ------------------------------------------------------------------
 * Determinism
 * ------------------------------------------------------------------
 *
 * Visual-only. Reads ECS state, never writes. Lives in /runtime/scene/,
 * outside the /sim/ purity fence.
 */

import * as THREE from "three";
import { hasComponent, query } from "bitecs";

import {
  Dead,
  Health,
  Position,
  Renderable,
  WeaponInstanceTag,
  type SimWorld,
} from "../../../sim/world";

/** Default vertical offset above the unit Position.y. Tuned for mk01 (~3m tall). */
export const DEFAULT_Y_OFFSET = 3.2;

/**
 * Legacy fixed world-space bar size. Retained as a fallback for the
 * (deprecated) no-camera code path — the constant-screen-size path
 * computes scale per-frame from camera distance and ignores these.
 *
 * They still seed each sprite's initial scale at construction; the first
 * camera-aware `updateFromWorld` overwrites those values immediately.
 */
export const DEFAULT_BAR_WIDTH = 2.5;
export const DEFAULT_BAR_HEIGHT = 0.35;

/**
 * Constant-screen-size targets — what the owner actually sees.
 *
 * The bar should READ at any zoom: small enough at close range that it
 * doesn't cover the unit, large enough at far range that it's still
 * legible. Per-frame we re-scale each sprite so it lands on these pixel
 * dimensions in the final render — `world_units_per_pixel` derived from
 * the camera's FOV + the entity's distance + the viewport height.
 *
 * 60 × 8 px is the standard SC2-ish proportion: long-thin, ~3 mm tall on
 * a 1080p monitor at typical seating distance, readable at a glance.
 */
export const HP_BAR_TARGET_WIDTH_PX = 60;
export const HP_BAR_TARGET_HEIGHT_PX = 8;

/**
 * Safety floor on the distance used for scale computation. Without it, a
 * unit directly under the camera (distance ≈ 0) would receive a near-zero
 * world scale → effectively invisible — followed by a divide-by-near-zero
 * spike if anyone refactors the formula. 1m is far below any practical
 * RTS camera distance (the camera is always well above the ground), so
 * this floor never bites in normal gameplay; it exists to make the math
 * robust.
 */
export const HP_BAR_MIN_DISTANCE = 1;

/** Pool cap. Same order of magnitude as the per-type instance cap. */
export const DEFAULT_MAX_BARS = 256;

/** Colour thresholds + RGB values (multiplicative tint applied to SpriteMaterial.color). */
const COLOR_GREEN = new THREE.Color(0x3aff5a);
const COLOR_YELLOW = new THREE.Color(0xffd84a);
const COLOR_RED = new THREE.Color(0xff3a3a);
const COLOR_BG = new THREE.Color(0x1a1a1a);

/** Internal — pick a colour by health fraction. */
function colourFor(fraction: number): THREE.Color {
  if (fraction > 0.66) return COLOR_GREEN;
  if (fraction > 0.33) return COLOR_YELLOW;
  return COLOR_RED;
}

/**
 * World-units-per-screen-pixel at a given camera distance.
 *
 * Derivation (perspective projection):
 *   The view frustum at distance `d` has height
 *     H_world = 2 * d * tan(fov / 2)
 *   which maps to `viewportHeightPx` pixels on screen. Therefore one
 *   screen pixel covers
 *     H_world / viewportHeightPx
 *   world units.
 *
 * Used to convert a target pixel size (e.g. 60 px wide HP bar) into the
 * world scale a `THREE.Sprite` must take this frame so it lands on that
 * pixel size in the final raster.
 *
 * `distance` is clamped to >= HP_BAR_MIN_DISTANCE to keep the scale
 * positive and finite when the camera is right on top of a unit.
 *
 * Exported for tests.
 */
export function computeWorldUnitsPerPixel(
  distance: number,
  fovDegrees: number,
  viewportHeightPx: number,
): number {
  const safeDistance = Math.max(HP_BAR_MIN_DISTANCE, distance);
  const safeViewport = Math.max(1, viewportHeightPx);
  const fovRad = (fovDegrees * Math.PI) / 180;
  return (2 * safeDistance * Math.tan(fovRad / 2)) / safeViewport;
}

interface BarSlot {
  bg: THREE.Sprite;
  fill: THREE.Sprite;
  /** Currently bound eid, or -1 if the slot is free. */
  eid: number;
}

export interface HpBarRendererOptions {
  /** Cap on simultaneous bars. */
  maxBars?: number;
  /** World units above unit Position.y. */
  yOffset?: number;
  /** Full-width bar in world units. */
  barWidth?: number;
  /** Bar height in world units. */
  barHeight?: number;
  /**
   * If true, hide bars for units at full health. Default false — owner's
   * stated need is "always-visible feedback during combat verification".
   * Switch to true if perf or visual clutter becomes a problem.
   */
  hideAtFullHealth?: boolean;
}

/**
 * Per-frame HP bar layer.
 *
 *   const bars = new HpBarRenderer();
 *   scene.add(bars.group);
 *   // in RAF:
 *   bars.updateFromWorld(sim.world);
 *
 * The toggle (H key) flips `setVisible(false)` which hides the whole
 * group at the Three.js level — no per-bar work needed.
 */
export class HpBarRenderer {
  readonly group: THREE.Group;

  private readonly slots: BarSlot[] = [];
  private readonly freeList: number[] = [];
  private readonly eidToSlot = new Map<number, number>();
  private readonly maxBars: number;
  private readonly yOffset: number;
  private readonly barWidth: number;
  private readonly barHeight: number;
  private readonly hideAtFullHealth: boolean;
  private readonly warnedMissingHealth = new Set<number>();
  private visible = true;
  /**
   * Scratch vector reused for camera→unit distance math. Pre-allocated to
   * keep `updateFromWorld` allocation-free (called every frame at 60Hz).
   */
  private readonly _tmpVec = new THREE.Vector3();

  constructor(opts: HpBarRendererOptions = {}) {
    this.maxBars = opts.maxBars ?? DEFAULT_MAX_BARS;
    this.yOffset = opts.yOffset ?? DEFAULT_Y_OFFSET;
    this.barWidth = opts.barWidth ?? DEFAULT_BAR_WIDTH;
    this.barHeight = opts.barHeight ?? DEFAULT_BAR_HEIGHT;
    this.hideAtFullHealth = opts.hideAtFullHealth ?? false;

    this.group = new THREE.Group();
    this.group.name = "HpBars";

    // Pre-allocate the whole pool. Sprites with `visible = false` cost
    // ~zero to render (Three.js culls them before draw).
    for (let i = 0; i < this.maxBars; i++) {
      const bg = this.makeSprite(COLOR_BG, this.barWidth, this.barHeight);
      const fill = this.makeSprite(COLOR_GREEN, this.barWidth, this.barHeight);
      // Render fill in front of bg. `renderOrder` is honoured for sprites
      // even though they share a Z plane facing the camera.
      bg.renderOrder = 10;
      fill.renderOrder = 11;
      this.group.add(bg);
      this.group.add(fill);
      this.slots.push({ bg, fill, eid: -1 });
      this.freeList.push(i);
    }
  }

  /**
   * Build a left-anchored sprite of the requested colour + base size.
   * `center = (0, 0.5)` means scale.x grows the bar rightward — perfect
   * for filling a fraction of the visible width.
   */
  private makeSprite(
    colour: THREE.Color,
    width: number,
    height: number,
  ): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      color: colour.clone(),
      depthTest: false, // bars draw on top of geometry even when behind
      depthWrite: false,
      transparent: true,
    });
    const s = new THREE.Sprite(mat);
    s.center.set(0, 0.5);
    s.scale.set(width, height, 1);
    s.visible = false;
    return s;
  }

  /**
   * Toggle all bars on/off. Default ON. Wired to the `H` hotkey in
   * GameRuntime.tsx. Hides the parent group, so per-bar visibility state
   * is preserved across toggles.
   */
  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Per-frame ECS→Sprite sync. Reads:
   *   - Renderable + Position + Health (sets visible bars at the right pose)
   *   - Dead (hides those bars)
   *   - WeaponInstanceTag (skipped — weapon-instance entities aren't units)
   *
   * Slots vacated by units that despawned this frame are released to the
   * free list — the sprite stays parented but invisible until a new eid
   * claims its slot.
   *
   * Constant-screen-size scaling: when `camera` + `viewportHeightPx` are
   * supplied, each sprite's world scale is computed from the camera→unit
   * distance so the bar lands on HP_BAR_TARGET_WIDTH_PX × HP_BAR_TARGET_HEIGHT_PX
   * in the final raster — readable at any zoom level. When they are
   * omitted (e.g. unit tests without a camera) we fall back to the legacy
   * fixed world-space size — visible but not zoom-stable.
   *
   * Performance: at 200 units this completes in well under 1ms on dev
   * hardware (mostly typed-array reads + Vector3.set + bool toggles).
   * The `query` call is bitECS's memoised SparseSet view — cheap.
   */
  updateFromWorld(
    world: SimWorld,
    camera?: THREE.PerspectiveCamera,
    viewportHeightPx?: number,
  ): void {
    // If the toggle is off, nothing to do — keep the bookkeeping in case
    // the user toggles back on without state drift.
    if (!this.visible) {
      // Still release slots for despawned/dead entities so the toggle-on
      // path doesn't show stale bars. But skip the visual updates.
      this.reapDespawned(world);
      return;
    }

    const ents = query(world, [Renderable, Position, Health]);

    // Tracks which slots we touched this frame. Anything previously
    // bound but not touched here despawned — release its slot.
    const seenEids = new Set<number>();

    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];

      // Skip weapon-instance entities — they're Renderable but not units.
      // Same exclusion as UnitRenderSystem.
      if (hasComponent(world, eid, WeaponInstanceTag)) continue;

      seenEids.add(eid);

      const dead = hasComponent(world, eid, Dead);
      const maxHp = Health.max[eid];
      const curHp = Health.current[eid];

      // Loud-over-silent: 0/0 health is almost certainly a missing
      // spawn-time init. Warn ONCE per eid and skip — don't render a
      // degenerate bar.
      if (maxHp <= 0) {
        if (!this.warnedMissingHealth.has(eid)) {
          this.warnedMissingHealth.add(eid);
          console.warn(
            `[HpBarRenderer] eid ${eid} has Health.max=${maxHp}; skipping bar (likely spawn-time init gap).`,
          );
        }
        this.releaseIfBound(eid);
        continue;
      }

      const fraction = Math.max(0, Math.min(1, curHp / maxHp));

      // Hide rules:
      //   - dead
      //   - full health AND hideAtFullHealth
      const hide = dead || (this.hideAtFullHealth && fraction >= 1);
      if (hide) {
        this.releaseIfBound(eid);
        continue;
      }

      // Claim or reuse a slot for this eid.
      let slot = this.eidToSlot.get(eid);
      if (slot === undefined) {
        const claimed = this.freeList.pop();
        if (claimed === undefined) {
          // Pool exhausted. Loud-over-silent: warn once + skip. The pool
          // cap should be tuned upward in HpBarRendererOptions if this
          // ever fires in practice.
          if (!this.warnedMissingHealth.has(-1)) {
            this.warnedMissingHealth.add(-1);
            console.warn(
              `[HpBarRenderer] pool exhausted (maxBars=${this.maxBars}); some units will lack HP bars.`,
            );
          }
          continue;
        }
        slot = claimed;
        this.eidToSlot.set(eid, slot);
        this.slots[slot].eid = eid;
      }

      const s = this.slots[slot];
      const px = Position.x[eid];
      const py = Position.y[eid] + this.yOffset;
      const pz = Position.z[eid];

      // Position both sprites at the unit's "above-head" anchor.
      s.bg.position.set(px, py, pz);
      s.fill.position.set(px, py, pz);

      // ---- Per-frame size ------------------------------------------------
      //
      // If a camera+viewport are provided we compute the world scale this
      // frame so the sprite lands at exactly TARGET_WIDTH_PX × TARGET_HEIGHT_PX
      // in the final raster. The further the camera is, the larger the
      // world units behind one pixel — linear in distance.
      //
      // Without a camera (test/headless path), fall back to the legacy
      // fixed world-space size.
      let widthWorld = this.barWidth;
      let heightWorld = this.barHeight;
      if (camera && viewportHeightPx !== undefined) {
        this._tmpVec.set(px, py, pz);
        const distance = camera.position.distanceTo(this._tmpVec);
        const worldPerPx = computeWorldUnitsPerPixel(
          distance,
          camera.fov,
          viewportHeightPx,
        );
        widthWorld = HP_BAR_TARGET_WIDTH_PX * worldPerPx;
        heightWorld = HP_BAR_TARGET_HEIGHT_PX * worldPerPx;
      }

      // Width: bg stays at full; fill scales horizontally by fraction.
      s.bg.scale.set(widthWorld, heightWorld, 1);
      s.fill.scale.set(widthWorld * fraction, heightWorld, 1);

      // Colour by zone.
      (s.fill.material as THREE.SpriteMaterial).color.copy(colourFor(fraction));

      s.bg.visible = true;
      s.fill.visible = true;
    }

    // Release slots for eids that disappeared from the query.
    for (const [eid, slot] of this.eidToSlot) {
      if (seenEids.has(eid)) continue;
      this.releaseSlot(slot);
    }
  }

  /**
   * Test/diag helper — current slot for an eid, or -1 if unbound.
   */
  slotOf(eid: number): number {
    return this.eidToSlot.get(eid) ?? -1;
  }

  /** Number of currently-active (visible) bars. */
  activeCount(): number {
    return this.eidToSlot.size;
  }

  /** Total pool capacity. */
  capacity(): number {
    return this.maxBars;
  }

  /** Diagnostic: read back the fill sprite for inspection (tests). */
  getFillSpriteForTesting(eid: number): THREE.Sprite | null {
    const slot = this.eidToSlot.get(eid);
    if (slot === undefined) return null;
    return this.slots[slot].fill;
  }

  /** Diagnostic: read back the background sprite for inspection (tests). */
  getBgSpriteForTesting(eid: number): THREE.Sprite | null {
    const slot = this.eidToSlot.get(eid);
    if (slot === undefined) return null;
    return this.slots[slot].bg;
  }

  /**
   * When toggled OFF: still walk the world to release slots for
   * despawned eids so toggling back ON doesn't show ghosts. Bounded by
   * eidToSlot.size (i.e. only ever proportional to active bars).
   */
  private reapDespawned(world: SimWorld): void {
    if (this.eidToSlot.size === 0) return;
    const ents = query(world, [Renderable, Position, Health]);
    const live = new Set<number>();
    for (let i = 0; i < ents.length; i++) live.add(ents[i]);
    for (const [eid, slot] of this.eidToSlot) {
      if (!live.has(eid)) this.releaseSlot(slot);
    }
  }

  private releaseIfBound(eid: number): void {
    const slot = this.eidToSlot.get(eid);
    if (slot === undefined) return;
    this.releaseSlot(slot);
  }

  private releaseSlot(slot: number): void {
    const s = this.slots[slot];
    if (s.eid >= 0) this.eidToSlot.delete(s.eid);
    s.eid = -1;
    s.bg.visible = false;
    s.fill.visible = false;
    this.freeList.push(slot);
  }

  /** Dispose every sprite material. Geometry is owned by Three.js (Sprite uses a shared plane). */
  dispose(): void {
    for (const s of this.slots) {
      (s.bg.material as THREE.SpriteMaterial).dispose();
      (s.fill.material as THREE.SpriteMaterial).dispose();
      this.group.remove(s.bg);
      this.group.remove(s.fill);
    }
    this.slots.length = 0;
    this.freeList.length = 0;
    this.eidToSlot.clear();
  }
}

/**
 * Upgrade path (deferred; do not implement until profiling demands it):
 *
 * Two `THREE.InstancedMesh` of unit quads (1 m × 1 m, anchored at left
 * edge by translating the geometry +0.5 X). One instance per bar; the
 * fill instance gets a per-instance scale.x via instanceMatrix and a
 * per-instance colour via instanceColor. Billboarding via a vertex
 * shader that rotates the quad to face the camera each frame
 * (gl_Position trick: project the centre, add quad corners in screen
 * space). Cost: ~1 draw call per layer regardless of unit count.
 *
 * Trade-off: needs a custom ShaderMaterial (billboarding) + per-frame
 * instanceMatrix writes. Sprite is half the code; do that first; cross
 * to instanced when unit budget pushes past ~500 OR the profile names
 * draw-call cost.
 */
