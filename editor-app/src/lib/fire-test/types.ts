/**
 * Fire-Test feature shared types.
 *
 * The Fire Test is a pure-visual layer on top of `resolveInteraction()`.
 * These types describe the request the UI builds, the phases the scene
 * machine goes through, and the per-frame sample shape used by the
 * flight-path samplers.
 *
 * Per the constitutional rules in the brief: no invented physics. The
 * sampler reads `muzzle_velocity_mps`, `mass_kg`, etc. straight from
 * the projectile schematic. NEVER add a "damage" or "range" field to
 * any of these shapes — the schema is the source of truth.
 */

import type { ProjectileSchematic } from "../../types/projectile";
import type { ArmorZone } from "../../types/vulnerability";

export interface FireTestRequest {
  readonly projectile: ProjectileSchematic;
  readonly hitZone: ArmorZone;
  readonly range_m: number;
  /** Time-dilation factor: 1 = real time, 100 = 100x slow-mo (default for visibility). */
  readonly time_dilation: number;
}

export type FlightPhase = "idle" | "flying" | "impact" | "dwell" | "done";

export interface FlightSample {
  /** World-space position at this time. */
  readonly position: readonly [number, number, number];
  /** Normalised 0..1 progress along the flight, for trail/scale interpolation. */
  readonly t: number;
}
