/**
 * UnitTypeRegistry — Phase 1 Week 1C
 *
 * Bridge between the data-driven Unit Schematic catalog and the hot-path
 * ECS. Maps the AUTHORED string id ("mk01", "scout_v2") to the NUMERIC
 * typeId (ui16) that bitECS stores per-entity, and stashes the prefab
 * mesh ref + derived max-health alongside.
 *
 * Why a registry (not enums or constants)?
 *   The catalog is open: a player can pick ANY .json file off disk and
 *   include it in a match. There's no compile-time list of unit types.
 *   The registry materialises that runtime-discovered list into a stable,
 *   integer-keyed table the renderer + sim share.
 *
 * Idempotent registration:
 *   `register(unit)` returns the SAME entry if the schematic id has been
 *   seen before — important because MatchData might be re-scanned (e.g.
 *   if the same unit type is selected twice). The first registration wins.
 *
 * typeId assignment:
 *   Sequential starting from 0. Stable for the registry's lifetime. NOT
 *   stable across matches — a fresh registry resets the counter. That's
 *   fine for v1: replays will pin the registry shape into the .replay
 *   file when they ship (Week 4).
 *
 * deriveMaxHealth:
 *   Falls back to a constant 100 by default; per the brief, if the
 *   schema later grows a real health field we substitute the formula
 *   here. Today the closest physical input is
 *   `vulnerability.structural_integrity_mj`, but that's MEGAJOULES of
 *   structural energy — not "hit points" — and the combat resolver
 *   (Week 3) is the only consumer that will read it directly. Until
 *   then the bitECS Health component is a placeholder so the spawner
 *   has SOMETHING to write; we use a sane default and TODO the real
 *   derivation for when combat lands.
 */

import type { UnitSchematic, MeshAssetRef } from "../types/unit";

export interface UnitTypeEntry {
  /** Sequential numeric id (ui16-bounded) for ECS storage. */
  readonly typeId: number;
  /** Authored string id from the schematic (`unit.id`). */
  readonly schematicId: string;
  /** Human-readable label — falls back to `schematicId` if `name` is empty. */
  readonly displayName: string;
  /**
   * Optional because a unit CAN be authored without a mesh_asset (e.g. an
   * abstract template that hasn't picked one yet). Such units cannot
   * render — `MatchSpawner` skips them with a console.warn rather than
   * crashing (loud-over-silent).
   */
  readonly meshRef: MeshAssetRef | undefined;
  /**
   * Max hit points, derived per `deriveMaxHealth`. The Health bitECS
   * component is seeded to this value at spawn time. See file header
   * for the rationale on the v1 default of 100.
   */
  readonly maxHealth: number;
}

export class UnitTypeRegistry {
  private byTypeId = new Map<number, UnitTypeEntry>();
  private bySchematicId = new Map<string, UnitTypeEntry>();
  private nextTypeId = 0;

  /**
   * Register a unit schematic. Idempotent — re-registering the same
   * schematicId returns the EXISTING entry untouched (no counter bump,
   * no replacement). The first registration's typeId is the one the
   * renderer and ECS will both reference.
   */
  register(unit: UnitSchematic): UnitTypeEntry {
    const existing = this.bySchematicId.get(unit.id);
    if (existing) return existing;
    const typeId = this.nextTypeId++;
    const entry: UnitTypeEntry = {
      typeId,
      schematicId: unit.id,
      displayName: unit.name && unit.name.length > 0 ? unit.name : unit.id,
      meshRef: unit.mesh_asset,
      maxHealth: deriveMaxHealth(unit),
    };
    this.byTypeId.set(typeId, entry);
    this.bySchematicId.set(unit.id, entry);
    return entry;
  }

  /** Look up by numeric ECS id. */
  byId(typeId: number): UnitTypeEntry | undefined {
    return this.byTypeId.get(typeId);
  }

  /** Look up by authored schematic id. */
  bySchematic(schematicId: string): UnitTypeEntry | undefined {
    return this.bySchematicId.get(schematicId);
  }

  /**
   * All registered entries in registration order. Used by
   * MatchSpawner to iterate every type the match was loaded with.
   */
  all(): readonly UnitTypeEntry[] {
    return Array.from(this.byTypeId.values());
  }

  /** Diagnostic — how many types are registered. */
  size(): number {
    return this.byTypeId.size;
  }
}

/**
 * Derive the unit's max health from its schematic.
 *
 * TODO(Week 3 — combat): replace this constant with a real formula.
 * The most physically-grounded candidate is
 * `vulnerability.structural_integrity_mj` (megajoules of structural energy
 * the hull can absorb) scaled to a "hit points" budget the combat
 * resolver will pre-compute. For now Week 1C only needs a non-zero
 * positive number so Health.current + Health.max have something sensible
 * to compare against once damage events land.
 *
 * Per CLAUDE.md "Adaptive over specific": this returns a single default
 * branch so adding a new health-bearing schema field is a one-line
 * change here, not a hunt across the codebase.
 */
function deriveMaxHealth(_unit: UnitSchematic): number {
  // TODO: derive from vulnerability.structural_integrity_mj +
  // chassis.armor_thickness_mm when combat resolver lands (Week 3).
  return 100;
}
