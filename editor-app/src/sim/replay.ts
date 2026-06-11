/**
 * /sim/replay.ts — Phase 1 Week 4
 *
 * Deterministic replay codec + canonical state-hash function.
 *
 * A replay is a LOCKSTEP COMMAND LOG: seed + the list of player
 * commands tagged with the tick they should execute, plus enough
 * metadata to reconstruct the match. Replaying === constructing a
 * fresh SimRunner with the same seed, calling
 * `bus.loadFromLog(commands)`, and ticking until `finalTickCount`.
 *
 * Sim-purity safe (enforced by scripts/check-sim-purity.mts):
 *   - No Date.now, performance.now, Math.random, new Date(.
 *   - `recordedAtTickStartIso` is a PARAMETER, not generated here —
 *     the render side timestamps each recording before calling in.
 *   - WebCrypto `crypto.subtle.digest` is permitted: it is
 *     deterministic + available in Node 16+ and browsers.
 *
 * Format versioning:
 *   - `version: 1` ships in Phase 1 Week 4.
 *   - If we ever need v2, add a `migrate` chain — never silently
 *     accept an unknown version.
 *
 * Determinism contract:
 *   - `encodeReplay` produces a string with STABLE key order across
 *     calls so two encodes of the same input are byte-identical
 *     (debug aid; not load-bearing for replay playback).
 *   - `hashSimState` iterates the COMPONENT_REGISTRY (NOT a hardcoded
 *     list) — adaptive-over-specific per CLAUDE.md. A new component
 *     becomes part of the hash by adding to the registry, not by
 *     editing this file.
 *
 * Loud-over-silent on decode:
 *   - Zod tells us exactly which field failed, with path.
 *   - Unknown `version` throws a clear "expected v1 got vN" message.
 */

import { z } from "zod";
import { hasComponent } from "bitecs";

import { COMPONENT_REGISTRY, COMPONENT_TAG_REGISTRY, type SimWorld } from "./world";
import type { SimCommand } from "./commandBus";

// ---------------------------------------------------------------------
// Wire format. Fields are explicit so they survive JSON round-tripping
// without any "well, the field used to be called…" drift.
// ---------------------------------------------------------------------

/** One team's spawn descriptor — restored by the player exactly as authored. */
export interface ReplayTeamSpawn {
  readonly teamId: number;
  readonly spawnYawRad: number;
  readonly spawnCenterXZ: readonly [number, number];
  /** Indices into `schematicAssetKeys` — the unit types this team fielded. */
  readonly unitTypeIdxs: readonly number[];
}

export interface ReplayFile {
  readonly version: 1;
  /** Authoritative match config — replay only valid if host has matching local assets. */
  readonly mapProjectName: string;
  /** Absolute or project-relative asset keys for the schematics used. */
  readonly schematicAssetKeys: readonly string[];
  readonly teams: readonly ReplayTeamSpawn[];
  /** Deterministic seed fed to SimRandom. */
  readonly simSeed: number;
  /** Append-only lockstep command log (copied verbatim from CommandBus.snapshot). */
  readonly commands: readonly SimCommand[];
  /** Audit only — not used for playback. ISO 8601 string from RENDER side. */
  readonly recordedAtTickStartIso: string;
  /** Total ticks the recorded match ran. */
  readonly finalTickCount: number;
  /** Hex-encoded SHA-256 of the canonical state snapshot at the end. */
  readonly finalStateHash: string;
}

// ---------------------------------------------------------------------
// Zod schemas — Zod is the single source of "is this thing well-formed?"
// They mirror the TS shape; any drift between the TS interface and the
// Zod schema is a bug we want surfaced loudly at decode time.
// ---------------------------------------------------------------------

const SimCommandSchema: z.ZodType<SimCommand> = z.object({
  tick: z.number().int().nonnegative(),
  playerId: z.number().int().nonnegative(),
  kind: z.enum(["spawnUnit", "move", "attack", "stop"]),
  payload: z.record(z.union([z.number(), z.string()])),
});

const ReplayTeamSpawnSchema: z.ZodType<ReplayTeamSpawn> = z.object({
  teamId: z.number().int().nonnegative(),
  spawnYawRad: z.number(),
  spawnCenterXZ: z.tuple([z.number(), z.number()]),
  unitTypeIdxs: z.array(z.number().int().nonnegative()),
});

const ReplayFileSchema: z.ZodType<ReplayFile> = z.object({
  version: z.literal(1),
  mapProjectName: z.string().min(1),
  schematicAssetKeys: z.array(z.string()),
  teams: z.array(ReplayTeamSpawnSchema),
  simSeed: z.number().int().nonnegative(),
  commands: z.array(SimCommandSchema),
  recordedAtTickStartIso: z.string().min(1),
  finalTickCount: z.number().int().nonnegative(),
  finalStateHash: z.string().regex(/^[0-9a-f]+$/),
});

// ---------------------------------------------------------------------
// Encode + decode
// ---------------------------------------------------------------------

export interface EncodeReplayArgs {
  readonly mapProjectName: string;
  readonly schematicAssetKeys: readonly string[];
  readonly teams: readonly ReplayTeamSpawn[];
  readonly simSeed: number;
  readonly commands: readonly SimCommand[];
  /** ISO 8601 timestamp generated RENDER-SIDE (sim purity forbids it here). */
  readonly recordedAtTickStartIso: string;
  readonly finalTickCount: number;
  readonly finalStateHash: string;
}

/**
 * Encode a replay into a JSON string.
 *
 * Stable key order: we build the object literal with keys in a fixed
 * order and rely on V8's insertion-order iteration (spec since ES2015).
 * This makes diffs across encodes of the same replay show only payload
 * changes, never spurious key-order shuffles.
 *
 * Number precision: floats inside command payloads pass through verbatim
 * — JSON.stringify uses the IEEE-754 round-trip representation, which is
 * lossless. We deliberately do NOT toFixed(6) round here because rounding
 * a payload could change the sim's outcome on replay (move(1.0000004,…)
 * → move(1.000000,…) is a different command). The brief mentions
 * toFixed(6) as a precision OPTION; v1 ships without it because lossless
 * is strictly stronger.
 */
export function encodeReplay(args: EncodeReplayArgs): string {
  const file: ReplayFile = {
    version: 1,
    mapProjectName: args.mapProjectName,
    schematicAssetKeys: [...args.schematicAssetKeys],
    teams: args.teams.map((t) => ({
      teamId: t.teamId,
      spawnYawRad: t.spawnYawRad,
      spawnCenterXZ: [t.spawnCenterXZ[0], t.spawnCenterXZ[1]] as const,
      unitTypeIdxs: [...t.unitTypeIdxs],
    })),
    simSeed: args.simSeed >>> 0,
    commands: args.commands.map((c) => ({
      tick: c.tick,
      playerId: c.playerId,
      kind: c.kind,
      payload: { ...c.payload },
    })),
    recordedAtTickStartIso: args.recordedAtTickStartIso,
    finalTickCount: args.finalTickCount,
    finalStateHash: args.finalStateHash,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Decode + validate a replay JSON string.
 *
 * Throws on malformed JSON or schema mismatch. The error message
 * includes the offending field path so a host can show the user a
 * useful "your replay file is from version X / has a missing field Y"
 * diagnostic instead of a generic "decode failed".
 */
export function decodeReplay(json: string): ReplayFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[replay.decode] JSON parse failed: ${msg}`);
  }
  // Pull `version` out early so a v2-on-v1-decoder gets a helpful error.
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    (parsed as { version: unknown }).version !== 1
  ) {
    const v = (parsed as { version: unknown }).version;
    throw new Error(
      `[replay.decode] unsupported replay version: expected 1, got ${String(v)}. ` +
        `Re-record the replay with the current build, or add a v${String(v)}→v1 migration.`,
    );
  }
  const result = ReplayFileSchema.safeParse(parsed);
  if (!result.success) {
    // Pick the first issue to surface at the head of the message; full
    // list joined behind so log readers can scroll for context.
    const issues = result.error.issues;
    const head = issues[0];
    const path = head.path.length === 0 ? "(root)" : head.path.join(".");
    const summary = issues
      .map((i) => `  - ${i.path.length === 0 ? "(root)" : i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[replay.decode] schema mismatch at "${path}": ${head.message}\n` +
        `All issues:\n${summary}`,
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------
// Canonical state hash
// ---------------------------------------------------------------------

/**
 * Hex-encode a Uint8Array as a lowercase hex string. Hand-rolled
 * (no Buffer) so this stays cross-platform between Node and browser.
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += (b < 0x10 ? "0" : "") + b.toString(16);
  }
  return out;
}

/**
 * Encode a number with its FULL precision into the hashing stream.
 *
 * We need the EXACT float bytes so two runs that produce nominally
 * "same" floats (down to the last ULP) hash the same. JSON's number
 * round-trip is a safe choice for finite floats; for NaN / ±Infinity
 * we emit literal tokens (defensive — they should never legitimately
 * appear in a deterministic sim, but if they do we want them visible
 * in the hash, not silently coerced to "null").
 */
function encodeNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (n === Number.POSITIVE_INFINITY) return "+Inf";
  if (n === Number.NEGATIVE_INFINITY) return "-Inf";
  // toString on a finite number gives the SHORTEST round-trip form,
  // which is stable across runs and platforms (defined by ECMA-262).
  return n.toString();
}

/**
 * Build the canonical byte sequence describing every live entity that
 * carries a registered component. Format (one line per entity-component):
 *
 *   <eid>|<componentName>|<field1>=<value1>|<field2>=<value2>|...
 *
 * Lines are joined with "\n". Entity ids iterate in NUMERIC order
 * (smallest first) for determinism. Components iterate in
 * COMPONENT_REGISTRY order. Fields within a component iterate in
 * registry order.
 *
 * Entity-id range note: bitECS allocates eids starting at 1, growing as
 * we add entities. Across a recording the max eid is bounded by the
 * number of entities ever created. We use `Position.x.length` as a
 * generous upper bound — typed-array storage in bitECS is pre-sized to
 * the max-entities cap, and `length` reports that cap.
 */
function buildHashPayload(world: SimWorld): string {
  // The hash iterates entity ids 0..N. We need an upper bound. Pick the
  // storage length of the first registered component's first field —
  // bitECS legacy pre-allocates typed arrays to the world's max-entities
  // cap (default 100k), so this covers any live entity.
  if (COMPONENT_REGISTRY.length === 0) return "";
  const probeArr = COMPONENT_REGISTRY[0].fields[0]?.arr;
  const maxEid = probeArr?.length ?? 0;

  // We use a string builder via array.join — V8 is well-optimised for
  // this pattern and it avoids the O(n²) string concat trap.
  const parts: string[] = [];

  for (let eid = 1; eid < maxEid; eid++) {
    for (const entry of COMPONENT_REGISTRY) {
      // hasComponent is the load-bearing filter — entities that don't
      // carry a component contribute NOTHING to the hash for it (not
      // a "field=0" line, which would be ambiguous with "field
      // explicitly zero on a live entity").
      if (!hasComponent(world, eid, entry.component as Parameters<typeof hasComponent>[2])) continue;
      const fieldParts: string[] = [];
      for (const f of entry.fields) {
        fieldParts.push(`${f.name}=${encodeNumber(f.arr[eid] ?? 0)}`);
      }
      parts.push(`${eid}|${entry.name}|${fieldParts.join("|")}`);
    }
    // Tag components (presence-only). Emit as `eid|TagName|<tag>` so a
    // tag that comes and goes shows up in the hash.
    for (const tag of COMPONENT_TAG_REGISTRY) {
      if (!hasComponent(world, eid, tag.component as Parameters<typeof hasComponent>[2])) continue;
      parts.push(`${eid}|${tag.name}|<tag>`);
    }
  }
  return parts.join("\n");
}

/**
 * Canonical SHA-256 hash of the simulation's current state.
 *
 * Returns a Promise<string> of lowercase hex digits (64 chars).
 *
 * Async because WebCrypto's `subtle.digest` is async — that's a
 * platform contract, not a design choice. Callers await it once per
 * recording-end / playback-end; it is not on a hot per-tick path.
 *
 * Iterating COMPONENT_REGISTRY rather than a hardcoded component list
 * is the adaptive-over-specific gate: adding a sim component to the
 * registry adds it to the hash with no edit here.
 */
export async function hashSimState(world: SimWorld): Promise<string> {
  const payload = buildHashPayload(world);
  // TextEncoder is universally available in Node + browsers.
  const bytes = new TextEncoder().encode(payload);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Synchronous, plain-text variant of the canonical payload — for
 * tests that want to diff two states and SEE the difference, not just
 * a hash mismatch. Not part of the wire format; debug aid only.
 */
export function debugSimStatePayload(world: SimWorld): string {
  return buildHashPayload(world);
}
