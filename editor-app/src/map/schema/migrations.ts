/**
 * Map manifest migration scaffolding.
 *
 * Every load path calls `migrate(rawParsedJson)` BEFORE validating against
 * the current Zod schema. v1 is the current shape and needs no migration,
 * but we ship the wiring now so future v1→v2 is a one-file change.
 *
 * Convention: each migration is a pure function that takes raw JSON, looks
 * at its `schemaVersion`, and returns raw JSON shaped for the next version.
 * Compose them inside `migrate()`. Never mutate the input.
 *
 * If `schemaVersion` is missing, treat as v1 (defensive — early dev maps
 * may not have the field).
 */

import { MAP_SCHEMA_VERSION } from "./manifest";

/**
 * Migrate raw parsed JSON up to the current MAP_SCHEMA_VERSION.
 *
 * Returns the input unchanged when no migration is needed. Returns a new
 * object when migration is performed (never mutates the input).
 *
 * The caller is responsible for running Zod validation on the result.
 */
export function migrate(raw: unknown): unknown {
  // v1 is current; no migrations needed yet.
  // When v2 lands, this becomes a switch on (raw as any).schemaVersion that
  // dispatches to migrateV1ToV2(), etc., chaining until we hit current.
  void MAP_SCHEMA_VERSION; // referenced for future expansion
  return raw;
}
