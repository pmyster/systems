/**
 * Projectile file operations.
 *
 * Projectiles are STANDALONE .proj.json files under units/projectiles/.
 * The weapon part only stores a `projectile_id`; the file itself owns
 * delivery + effect + cluster physics.
 *
 * Validation contract mirrors unit save/open:
 *   - Save: validate with Zod BEFORE writing. Block on failure.
 *   - Load: read via the Rust `read_unit_file` command, parse JSON,
 *     validate with Zod. Throw on either failure.
 *   - List: invoke the Rust `list_projectile_files` command; any file
 *     that fails to parse is logged to stderr Rust-side AND surfaces
 *     to the caller (loud, not silent). The catch-all bucket is the
 *     console warning — never an empty array hiding bad files.
 *   - Cycle prevention: `hasCycle` walks the cluster graph before
 *     save. Depth > 5 throws — projectiles that nest deeper than
 *     "shell → submunition → sub-submunition" should be re-authored.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ZodIssue } from "zod";

import { ProjectileSchematicSchema } from "../lib/zod-schemas";
import type { ProjectileSchematic } from "../types/projectile";

/** Thrown when a projectile fails schema validation before write. */
export class ProjectileSaveValidationError extends Error {
  readonly issues: readonly ZodIssue[];
  constructor(issues: readonly ZodIssue[]) {
    super("Projectile failed schema validation; save aborted");
    this.name = "ProjectileSaveValidationError";
    this.issues = issues;
  }
}

/** Thrown when a loaded projectile parses as JSON but fails Zod. */
export class ProjectileLoadValidationError extends Error {
  readonly issues: readonly ZodIssue[];
  readonly path: string;
  constructor(path: string, issues: readonly ZodIssue[]) {
    super(`Projectile at ${path} failed schema validation`);
    this.name = "ProjectileLoadValidationError";
    this.path = path;
    this.issues = issues;
  }
}

/** Thrown when the chosen file isn't valid JSON. */
export class ProjectileParseError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(
      `Projectile at ${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "ProjectileParseError";
    this.path = path;
  }
}

/** Thrown when cluster graph depth exceeds the safe authoring limit. */
export class ProjectileCycleError extends Error {
  readonly chain: readonly string[];
  constructor(chain: readonly string[], reason: "cycle" | "too_deep") {
    super(
      reason === "cycle"
        ? `Cluster cycle detected: ${chain.join(" → ")}`
        : `Cluster nesting too deep (>5): ${chain.join(" → ")}`,
    );
    this.name = "ProjectileCycleError";
    this.chain = chain;
  }
}

/** Metadata row returned by the Rust list command. */
export interface ProjectileFileEntry {
  readonly path: string;
  readonly id: string;
  readonly name: string;
}

/**
 * Canonical JSON for a projectile — same conventions as unit save:
 * 2-space indent + trailing newline, UTF-8.
 */
export function toCanonicalProjectileJson(p: ProjectileSchematic): string {
  return JSON.stringify(p, null, 2) + "\n";
}

/**
 * Load a projectile from an absolute path.
 *
 * Reads via Rust (bypasses the fs-plugin scope, same rationale as
 * `read_unit_file`). Parses, validates, returns the typed shape.
 */
export async function loadProjectile(
  path: string,
): Promise<ProjectileSchematic> {
  const text = await invoke<string>("read_unit_file", { path });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new ProjectileParseError(path, cause);
  }
  const result = ProjectileSchematicSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProjectileLoadValidationError(path, result.error.issues);
  }
  // The Zod-inferred shape is structurally compatible with
  // ProjectileSchematic (sync-checked at compile time in zod-schemas.ts).
  // One cast at the IO boundary is the price.
  return result.data as ProjectileSchematic;
}

/**
 * Save a projectile. Validates → cycle-checks → writes canonical JSON.
 *
 * `existingResolver` is optional. When present, `hasCycle` will use it
 * to look up child projectiles by id and detect inter-file cycles.
 * Without it, only direct self-reference is caught (i.e. p references
 * itself as a child). Production wiring should pass a resolver backed
 * by the units/projectiles/ directory.
 */
export async function saveProjectile(
  p: ProjectileSchematic,
  path: string,
  existingResolver?: (id: string) => Promise<ProjectileSchematic | null>,
): Promise<void> {
  const result = ProjectileSchematicSchema.safeParse(p);
  if (!result.success) {
    throw new ProjectileSaveValidationError(result.error.issues);
  }
  // Cycle check BEFORE write — never persist a known-bad graph.
  await assertNoCycle(p, existingResolver);
  const text = toCanonicalProjectileJson(p);
  await invoke("write_unit_file", { path, contents: text });
}

/**
 * List all projectile files in a directory. Surfaces each file's id
 * and name so the picker can render rows without round-tripping the
 * whole projectile body.
 */
export async function listProjectiles(
  dir: string,
): Promise<readonly ProjectileFileEntry[]> {
  return await invoke<ProjectileFileEntry[]>("list_projectile_files", { dir });
}

/**
 * Walks the cluster graph from a starting projectile and throws if a
 * cycle or depth-overflow is detected.
 *
 * Implementation note: when a resolver is provided we look up each
 * child by id and recurse. When it isn't, we only catch the trivial
 * "this projectile's cluster.child_projectile_id === this.id" case.
 * That's still useful (the most common authoring mistake) but
 * obviously not exhaustive.
 */
export async function hasCycle(
  projId: string,
  cluster: ProjectileSchematic["cluster"],
  visited: Set<string>,
  depth: number,
  resolver?: (id: string) => Promise<ProjectileSchematic | null>,
): Promise<boolean> {
  if (depth > 5) {
    throw new ProjectileCycleError([...visited, projId], "too_deep");
  }
  if (visited.has(projId)) {
    throw new ProjectileCycleError([...visited, projId], "cycle");
  }
  if (!cluster) return false;
  const childId = cluster.child_projectile_id;
  if (childId === projId) {
    throw new ProjectileCycleError([projId, childId], "cycle");
  }
  if (!resolver) return false;
  const child = await resolver(childId);
  if (!child) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(projId);
  return hasCycle(childId, child.cluster, nextVisited, depth + 1, resolver);
}

/** Internal — calls hasCycle with a fresh visited set. */
async function assertNoCycle(
  p: ProjectileSchematic,
  resolver?: (id: string) => Promise<ProjectileSchematic | null>,
): Promise<void> {
  await hasCycle(p.id, p.cluster, new Set<string>(), 0, resolver);
}
