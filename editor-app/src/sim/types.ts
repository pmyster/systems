/**
 * /sim — Headless simulation core: type aliases.
 *
 * IMPORTANT: nothing in `/sim/**` may import from:
 *   - three / @react-three / *
 *   - react / react-dom
 *   - the editor's zustand store(s)
 *   - DOM / Tauri APIs
 *   - global time sources (Date.now, performance.now, Math.random)
 *
 * That isolation is what lets the sim run unchanged inside a Worker,
 * a Node test harness, or a future dedicated-server process. Enforced
 * by `scripts/check-sim-purity.mts`.
 */

/** Monotonic tick counter — one tick = one fixed simulation step (1/30 s @ 30 Hz). */
export type TickId = number;

/** Stable identifier for an ECS entity. Sourced from bitECS `addEntity`. */
export type EntityId = number;

/** Identifier for a player / faction issuing commands. */
export type PlayerId = number;

/**
 * Per-tick context passed to systems.
 *
 * `dtSec` is the FIXED step — never variable. Variable frame time is
 * absorbed by the accumulator in `SimClock` so systems can do
 * dimensional integration with a constant dt.
 */
export interface TickContext {
  readonly tickId: TickId;
  readonly dtSec: number;
}
