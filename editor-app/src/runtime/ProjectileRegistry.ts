/**
 * ProjectileRegistry — Phase 1 Week 3
 *
 * Parallel to UnitTypeRegistry. Maps authored projectile_id strings to
 * a numeric typeId (ui16) for ECS storage, holds the full
 * ProjectileSchematic so impactSystem can call computeDamage() with the
 * authored physics, and exposes lookup helpers for the runtime spawners.
 *
 * Why a registry?
 *   Projectile schematics are open-ended files on disk (units/projectiles/
 *   *.proj.json). At match-load time the MatchLoader discovers every
 *   projectile_id referenced by the loaded units, loads each .proj.json
 *   once, and registers it here. Subsequent weapon-fire events lookup
 *   by numeric id — the bitECS hot path never touches strings.
 *
 * Idempotent: registering the same projectile_id twice returns the same
 * typeId (matches UnitTypeRegistry).
 *
 * Loud-over-silent: looking up an unknown typeId returns undefined and
 * the caller logs. We do NOT silently return a fallback projectile;
 * silent fallbacks hide load failures.
 */

import type { ProjectileSchematic } from "../types/projectile";
import { NO_PROJECTILE_TYPE as SIM_NO_PROJECTILE_TYPE } from "../sim/world";

export interface ProjectileTypeEntry {
  /** Sequential numeric id (ui16-bounded) for ECS storage. */
  readonly typeId: number;
  /** Authored string id from the projectile JSON. */
  readonly schematicId: string;
  /** The full projectile data — read by impactSystem and projectileSystem. */
  readonly schematic: ProjectileSchematic;
}

/** Sentinel: weapon has no projectile linked (can't fire). Re-exported from /sim. */
export const NO_PROJECTILE_TYPE = SIM_NO_PROJECTILE_TYPE;

export class ProjectileRegistry {
  private byTypeId = new Map<number, ProjectileTypeEntry>();
  private bySchematicId = new Map<string, ProjectileTypeEntry>();
  private nextTypeId = 0;

  register(schematic: ProjectileSchematic): ProjectileTypeEntry {
    const existing = this.bySchematicId.get(schematic.id);
    if (existing) return existing;
    const typeId = this.nextTypeId++;
    if (typeId >= NO_PROJECTILE_TYPE) {
      // Shouldn't happen with normal use (ui16 = 65535 slots), but a
      // loud warn is the right call if it ever does.
      console.warn(
        `[ProjectileRegistry] typeId overflow (${typeId}); cap is ui16. Re-using sentinel will collide.`,
      );
    }
    const entry: ProjectileTypeEntry = {
      typeId,
      schematicId: schematic.id,
      schematic,
    };
    this.byTypeId.set(typeId, entry);
    this.bySchematicId.set(schematic.id, entry);
    return entry;
  }

  byId(typeId: number): ProjectileTypeEntry | undefined {
    return this.byTypeId.get(typeId);
  }

  bySchematic(schematicId: string): ProjectileTypeEntry | undefined {
    return this.bySchematicId.get(schematicId);
  }

  all(): readonly ProjectileTypeEntry[] {
    return Array.from(this.byTypeId.values());
  }

  size(): number {
    return this.byTypeId.size;
  }
}
