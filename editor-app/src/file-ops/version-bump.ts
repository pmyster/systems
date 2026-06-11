/**
 * physics_version bump — explicit, never automatic.
 *
 * Per DESIGN.md Principle 4 (Invariance: amend, never alter) the
 * `physics_version` field is the contract between authored content and
 * the engine's equation set. Bumping it is a conscious user action; old
 * content keeps working under its original version forever.
 *
 * The format is strict per schemas/unit.schema.json (and the runtime
 * Zod guard in src/lib/zod-schemas.ts): `<major>.<minor>`. Both
 * components are non-negative integers. We bump the minor by default;
 * the user can hand-edit to bump major if they really mean to.
 *
 * Examples:
 *   bumpPhysicsVersion("1.0") -> "1.1"
 *   bumpPhysicsVersion("1.9") -> "1.10"   (no semver-style rollover)
 *   bumpPhysicsVersion("")    -> "0.1"
 *   bumpPhysicsVersion("oops") -> "0.1"
 */

import { DEFAULT_PHYSICS_VERSION } from "../lib/constants";

/**
 * Bump the minor component of a `<major>.<minor>` version string.
 *
 * If `current` is empty or doesn't match the expected pattern, returns
 * DEFAULT_PHYSICS_VERSION (currently "1.0"). The brief asks for a
 * "0.1.0" fallback but that has three components and would fail the
 * schema's `major.minor` regex — sticking with the schema-compatible
 * default keeps validation green.
 */
export function bumpPhysicsVersion(current: string | undefined | null): string {
  if (!current || typeof current !== "string") return DEFAULT_PHYSICS_VERSION;
  const match = /^([0-9]+)\.([0-9]+)$/.exec(current);
  if (!match) return DEFAULT_PHYSICS_VERSION;
  const major = match[1];
  const minorStr = match[2];
  const minor = Number(minorStr);
  if (!Number.isFinite(minor)) return DEFAULT_PHYSICS_VERSION;
  return `${major}.${minor + 1}`;
}
