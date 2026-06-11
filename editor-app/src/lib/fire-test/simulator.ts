/**
 * Pure flight-path simulator for the Fire-Test feature.
 *
 * Every function in this file is pure: same inputs → same output, no
 * side effects, no clocks, no Three.js. The Battlefield Preview's
 * fire-test scene calls these on every frame to advance the projectile
 * mesh along its path.
 *
 * Physics first:
 *   - Flight duration is derived from `muzzle_velocity_mps` / cruise
 *     speed / free-fall time — NEVER from a hand-picked "looks right"
 *     number that overrides the schema.
 *   - Time-dilation is applied AFTER the real flight time is computed,
 *     so the author always sees the physics-true timing as
 *     `duration / time_dilation`. Beams ignore dilation because they
 *     read as visually instantaneous regardless of timing.
 *
 * Sanity clamping:
 *   - Real flight times can be sub-frame (high-velocity dart at 50m) or
 *     many seconds (slow guided round at 3km). Both are unwatchable.
 *   - We clamp the FINAL on-screen duration to [200ms, 8000ms] so the
 *     animation is always perceivable but never tedious. Time-dilation
 *     gives the author fine control inside that band.
 */

import type {
  BallisticDelivery,
  ProjectileSchematic,
} from "../../types/projectile";

import type { FlightSample } from "./types";

/** Minimum on-screen flight duration (ms) — anything faster is unwatchable. */
const MIN_FLIGHT_MS = 200;

/** Maximum on-screen flight duration (ms) — anything slower is tedious. */
const MAX_FLIGHT_MS = 8000;

/** Guided cruise speed (m/s) — placeholder until the guided-flight model lands. */
const GUIDED_CRUISE_MPS = 400;

/** Beam visual lifetime (ms) — visually instant regardless of range. */
const BEAM_FLASH_MS = 80;

/** Placed visual lifetime (ms) — short vertical drop to mark placement. */
const PLACED_DROP_MS = 600;

/** Synthetic spawn height for dropped delivery (m) — gives a watchable fall arc. */
const DROPPED_SPAWN_HEIGHT_M = 15;

/** Map-half size in metres — used to convert range_m into world coords. */

/**
 * Compute the on-screen flight time in milliseconds for a fire test.
 *
 * Real-world physics duration is computed FIRST per delivery kind, then
 * multiplied by the time-dilation factor, then clamped to the watchable
 * band. Beam ignores time_dilation by design — it's the visual flash,
 * not the physical dwell.
 */
export function computeFlightDurationMs(
  p: ProjectileSchematic,
  range_m: number,
  time_dilation: number,
): number {
  const dilation = Math.max(0.01, time_dilation);
  const d = p.delivery_params;
  let raw_ms: number;
  switch (d.kind) {
    case "ballistic": {
      const b = d as BallisticDelivery;
      const v = Math.max(1, b.muzzle_velocity_mps);
      raw_ms = (range_m / v) * 1000 * dilation;
      break;
    }
    case "guided": {
      raw_ms = (range_m / GUIDED_CRUISE_MPS) * 1000 * dilation;
      break;
    }
    case "beam": {
      // Beams are visually instant — no dilation applied.
      return BEAM_FLASH_MS;
    }
    case "placed": {
      raw_ms = PLACED_DROP_MS * dilation;
      break;
    }
    case "dropped": {
      // Free-fall time t = sqrt(2h/g).
      const t_s = Math.sqrt((2 * DROPPED_SPAWN_HEIGHT_M) / 9.81);
      raw_ms = t_s * 1000 * dilation;
      break;
    }
    default: {
      // Loud over silent: if a new delivery kind lands here we fall
      // through to a safe minimum so the scene still animates and the
      // author notices the missing branch.
      const _exh: never = d;
      void _exh;
      raw_ms = MIN_FLIGHT_MS;
      break;
    }
  }
  if (!Number.isFinite(raw_ms) || raw_ms < MIN_FLIGHT_MS) return MIN_FLIGHT_MS;
  if (raw_ms > MAX_FLIGHT_MS) return MAX_FLIGHT_MS;
  return raw_ms;
}

/**
 * Resolve the world-space target position for a fire test, given the
 * spawn point AND the spawn's aiming direction (a unit vector). Spawn +
 * direction together come from the muzzle aim — either a rig-tagged
 * muzzle node's animated transform or the legacy bbox/south fallback.
 *
 * Conventions:
 *   - Ballistic / guided / beam fire along `direction`. The target is
 *     `spawn + direction * range_m` — Y included, so an elevated barrel
 *     fires into the sky rather than being snapped flat to terrain. The
 *     visualisation later handles ground clipping if any.
 *   - Placed weapons "trigger" at the unit's feet — range_m only
 *     visualises a trigger-radius ring later, not a target offset.
 *     Direction is ignored.
 *   - Dropped weapons fall straight down from spawn. Direction is ignored.
 */
export function getEffectiveTarget(
  spawn: readonly [number, number, number],
  direction: readonly [number, number, number],
  range_m: number,
  delivery_kind: ProjectileSchematic["delivery_params"]["kind"],
): readonly [number, number, number] {
  switch (delivery_kind) {
    case "ballistic":
    case "guided":
    case "beam":
      return [
        spawn[0] + direction[0] * range_m,
        spawn[1] + direction[1] * range_m,
        spawn[2] + direction[2] * range_m,
      ];
    case "placed":
      // Trigger at the unit's feet. Range is visualised as a ring; the
      // actual "delivery target" is directly under the spawn.
      return [spawn[0], 0, spawn[2]];
    case "dropped":
      return [spawn[0], 0, spawn[2]];
    default: {
      const _exh: never = delivery_kind;
      void _exh;
      return [
        spawn[0] + direction[0] * range_m,
        spawn[1] + direction[1] * range_m,
        spawn[2] + direction[2] * range_m,
      ];
    }
  }
}

// ---------------------------------------------------------------------------
// Path samplers — return a FlightSample for progress ∈ [0,1].
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function quadraticBezier(
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const ut2 = 2 * u * t;
  return [
    uu * p0[0] + ut2 * p1[0] + tt * p2[0],
    uu * p0[1] + ut2 * p1[1] + tt * p2[1],
    uu * p0[2] + ut2 * p1[2] + tt * p2[2],
  ];
}

/**
 * Sample the projectile's world position for `progress` ∈ [0,1].
 *
 * Per the brief:
 *   - Ballistic: quadratic bezier with control point at midpoint raised
 *     by range/4 (visible arc).
 *   - Guided: bezier with control at 70% along, raised by range/6
 *     (smoother, lower arc — guidance pulls it down sooner).
 *   - Beam: linear interpolation (used only for endpoint book-keeping;
 *     the visualization is a static line, not a travelling dot).
 *   - Placed: vertical drop from spawn-height to the target's ground.
 *   - Dropped: vertical free-fall from spawn straight down.
 */
export function samplePositionAtTime(
  p: ProjectileSchematic,
  spawn: readonly [number, number, number],
  target: readonly [number, number, number],
  progress: number,
): FlightSample {
  const t = Math.min(1, Math.max(0, progress));
  const range_m = Math.hypot(target[0] - spawn[0], target[2] - spawn[2]);
  switch (p.delivery_params.kind) {
    case "ballistic": {
      const mid: [number, number, number] = [
        (spawn[0] + target[0]) / 2,
        Math.max(spawn[1], target[1]) + range_m / 4,
        (spawn[2] + target[2]) / 2,
      ];
      return { position: quadraticBezier(spawn, mid, target, t), t };
    }
    case "guided": {
      const ctrl: [number, number, number] = [
        lerp(spawn[0], target[0], 0.7),
        Math.max(spawn[1], target[1]) + range_m / 6,
        lerp(spawn[2], target[2], 0.7),
      ];
      return { position: quadraticBezier(spawn, ctrl, target, t), t };
    }
    case "beam": {
      return {
        position: [
          lerp(spawn[0], target[0], t),
          lerp(spawn[1], target[1], t),
          lerp(spawn[2], target[2], t),
        ],
        t,
      };
    }
    case "placed":
    case "dropped": {
      // Vertical drop from spawn down to target ground. The xz stays at spawn.
      return {
        position: [spawn[0], lerp(spawn[1], target[1], t), spawn[2]],
        t,
      };
    }
    default: {
      const _exh: never = p.delivery_params;
      void _exh;
      return { position: spawn, t };
    }
  }
}
