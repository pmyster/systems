/**
 * /sim/systems/commandApplySystem.ts — Phase 1 Week 2
 *
 * Reads commands for the current tick out of the CommandBus and mutates
 * the ECS accordingly. This is the bridge between "what the player
 * pressed" (encoded as `SimCommand` records) and "what the world does"
 * (encoded as component writes).
 *
 * Why headless?
 *   Per the LOCKED rule, `/sim` cannot import Three.js, Rapier, or
 *   anything DOM-aware. Commands arrive as plain JSON-primitive
 *   payloads (numbers + strings) — the UI is the only thing that
 *   knows about pixels, raycasts, or pointer events, and it converts
 *   THAT to a `move` / `stop` / `attack` payload here.
 *
 * Loud-over-silent (CLAUDE.md):
 *   - Unknown `kind` values: WARNING log with the offending payload.
 *     The sim does NOT silently drop them. This is the canary that
 *     catches a UI/sim version skew (UI ships a new command before
 *     the sim understands it).
 *   - `entityIds` is a comma-separated string per the CommandBus
 *     JSON-primitive constraint. Splitting + Number-parsing is
 *     defensive: empty strings → empty array, NaN entries get
 *     filtered with a warn so a malformed payload is visible, not
 *     silently a no-op.
 *
 * Adaptive over specific:
 *   Dispatch table is a `switch` keyed by `cmd.kind`. The default
 *   branch logs. Future commands (`attack`, `patrol`, `stance`) plug
 *   in as new cases; the default keeps catching anything we forgot.
 */

import type { SimCommand } from "../commandBus";
import {
  MovementTarget,
  type SimWorld,
} from "../world";

/**
 * Apply every command in `commands` against `world`. Commands are
 * expected to already be filtered to the current tick by
 * `SimRunner.simStep` — this function is order-deterministic in
 * insertion order (the same order CommandBus.forTick returns).
 */
export function applyCommands(
  world: SimWorld,
  commands: readonly SimCommand[],
): void {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    switch (cmd.kind) {
      case "move":
        applyMove(world, cmd);
        break;
      case "stop":
        applyStop(world, cmd);
        break;
      case "spawnUnit":
        // Week 1C spawn happens before the sim is even ticking, so we
        // currently ignore "spawnUnit" replay entries during apply.
        // Replay support (Week 4) will wire a spawn-at-tick path here.
        break;
      case "attack":
        // Week 3.
        break;
      default: {
        // Loud-over-silent: an unknown kind is almost certainly a UI
        // shipping a command the sim doesn't know about. Surface it
        // every time so the asymmetry can't sit in a CI log unnoticed.
        const unknown: { kind: string } = cmd as unknown as { kind: string };
        console.warn(
          `[commandApplySystem] unknown command kind="${unknown.kind}"; payload=`,
          cmd.payload,
        );
        break;
      }
    }
    void world; // touched conditionally — silence "unused" lint when all branches are stubs.
  }
}

/**
 * Move command shape:
 *   payload.x: number
 *   payload.z: number
 *   payload.entityIds: comma-separated entity ids
 *
 * y is intentionally not provided; the render side resamples the
 * heightmap each frame so y in the sim would drift anyway. We stamp
 * y = 0 so the field is initialised but never read by movementSystem.
 */
function applyMove(world: SimWorld, cmd: SimCommand): void {
  const tx = Number(cmd.payload.x);
  const tz = Number(cmd.payload.z);
  if (!Number.isFinite(tx) || !Number.isFinite(tz)) {
    console.warn(
      "[commandApplySystem] move: non-finite target, skipping",
      cmd.payload,
    );
    return;
  }
  const ids = parseEntityIds(cmd.payload.entityIds);
  for (let i = 0; i < ids.length; i++) {
    const eid = ids[i];
    MovementTarget.x[eid] = tx;
    MovementTarget.y[eid] = 0;
    MovementTarget.z[eid] = tz;
    MovementTarget.hasTarget[eid] = 1;
  }
  void world;
}

function applyStop(world: SimWorld, cmd: SimCommand): void {
  const ids = parseEntityIds(cmd.payload.entityIds);
  for (let i = 0; i < ids.length; i++) {
    MovementTarget.hasTarget[ids[i]] = 0;
  }
  void world;
}

/**
 * Convert the comma-separated entityIds payload field into a flat
 * numeric array. Empty string returns [] (legitimate: "stop everyone
 * I have nothing selected" is a no-op, not an error). NaN entries are
 * filtered with a single warn so a malformed payload surfaces in the
 * console but doesn't crash the apply pass for the surviving ids.
 */
function parseEntityIds(raw: number | string | undefined): number[] {
  if (raw === undefined || raw === null) return [];
  const s = String(raw);
  if (s.length === 0) return [];
  const parts = s.split(",");
  const out: number[] = [];
  let bad = 0;
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      bad++;
      continue;
    }
    out.push(n);
  }
  if (bad > 0) {
    console.warn(
      `[commandApplySystem] parseEntityIds: ignored ${bad} non-integer entry/entries from "${s}"`,
    );
  }
  return out;
}
