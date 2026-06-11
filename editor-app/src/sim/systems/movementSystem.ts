/**
 * /sim/systems/movementSystem.ts — Phase 1 Week 2
 *
 * Headless, deterministic translation system.
 *
 * Each tick, for every entity with `Position + MovementTarget +
 * MovementSpeed`, advance Position straight-line toward
 * MovementTarget at MovementSpeed * dt. When the entity arrives
 * (within ARRIVAL_RADIUS_M of the target on the XZ plane), clear
 * `MovementTarget.hasTarget` — the render-side PathFollowController
 * polls this flag, sees the transition 1 → 0, and writes the next
 * recast waypoint into MovementTarget if more are queued.
 *
 * Why straight-line, not curve-follow?
 *   The recast path is COMPUTED once at command time and stored as a
 *   short list of waypoints render-side. Walking is just "head toward
 *   the current waypoint" — the polyline shape gives us the bend, no
 *   per-tick steering integration needed. This keeps the sim pure
 *   numeric (no recast in /sim) and replay-stable.
 *
 *   Crowd avoidance is a separate render-side concern (Crowd lives in
 *   /runtime). For Week 2 MVP, entities can clip through each other if
 *   the path was computed naïvely; the PathFollowController OPTIONALLY
 *   re-plans by pushing fresh waypoints. Hardening lockstep determinism
 *   for the pathfinding output lands Week 4.
 *
 * Y axis handling:
 *   Position.y is NOT touched by this system. The render side resamples
 *   the heightmap each frame (see GameRuntime's heightAt() pattern) so
 *   units sit on the ground. Driving Y from the sim would force the
 *   /sim layer to know the heightmap layout — that's a /runtime concept
 *   that we deliberately keep on the render side.
 *
 * Determinism:
 *   - Only inputs: SoA arrays + `dtSec` (passed in by SimRunner.simStep,
 *     itself driven by the fixed-step clock).
 *   - No wall clock, no Math.random.
 *   - The dist/step branches use the same floats on every platform; no
 *     order-of-iteration sensitivity because the systems writes only to
 *     the entity it's reading.
 */

import { query } from "bitecs";

import {
  Position,
  MovementTarget,
  MovementSpeed,
  type SimWorld,
} from "../world";

/**
 * Arrival radius in meters. 0.5 m is "close enough" — tighter and a
 * unit that lands exactly on a polygon edge can oscillate on a
 * neighbouring tick due to f32 quantisation; looser and the visible
 * approach looks lazy. Tuned by feel — adjust if Week 3 combat needs
 * tighter convergence on target-melee.
 *
 * Distance is measured XZ-only (planar). Y is render-resampled from
 * the heightmap so it would always drift slightly and waste the budget.
 */
export const ARRIVAL_RADIUS_M = 0.5;

const MOVEMENT_QUERY_TERMS = [Position, MovementTarget, MovementSpeed];

/**
 * Run one tick's worth of movement. `dtSec` is the sim tick interval
 * (1/30 in the default config) — NOT real-wall time.
 *
 * Entities without a live target (`hasTarget === 0`) are skipped on a
 * cheap typed-array read; no early-exit cost over a separate query.
 */
export function movementSystem(world: SimWorld, dtSec: number): void {
  const ents = query(world, MOVEMENT_QUERY_TERMS);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    if (MovementTarget.hasTarget[eid] === 0) continue;

    const px = Position.x[eid];
    const pz = Position.z[eid];
    const tx = MovementTarget.x[eid];
    const tz = MovementTarget.z[eid];

    const dx = tx - px;
    const dz = tz - pz;
    const dist2 = dx * dx + dz * dz;

    if (dist2 < ARRIVAL_RADIUS_M * ARRIVAL_RADIUS_M) {
      // Signal arrival — render-side path follower sees the 1→0
      // transition and writes the next waypoint, or leaves it clear
      // if the path is exhausted.
      MovementTarget.hasTarget[eid] = 0;
      continue;
    }

    const dist = Math.sqrt(dist2);
    // Cap the step at `dist` so a fast unit can't overshoot a near
    // target on a single tick.
    const step = Math.min(MovementSpeed.value[eid] * dtSec, dist);
    const inv = step / dist;
    Position.x[eid] = px + dx * inv;
    Position.z[eid] = pz + dz * inv;
    // Position.y left untouched — see header comment.
  }
}
