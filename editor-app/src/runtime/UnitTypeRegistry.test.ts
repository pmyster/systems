/**
 * UnitTypeRegistry tests.
 *
 * The registry only reads three fields off a UnitSchematic — id, name,
 * mesh_asset. We mint minimal fixture objects that supply just those
 * fields and cast through `unknown` to avoid faking the entire schema
 * surface (chassis, vulnerability, parts…) which would be a much larger
 * fixture with no extra signal.
 */

import { describe, it, expect } from "vitest";

import { UnitTypeRegistry } from "./UnitTypeRegistry";
import type { UnitSchematic } from "../types/unit";

function mkUnit(id: string, name?: string, hasMesh = true): UnitSchematic {
  return {
    id,
    name: name ?? id,
    mesh_asset: hasMesh
      ? { kind: "template", template_id: "tank" }
      : undefined,
  } as unknown as UnitSchematic;
}

describe("UnitTypeRegistry.register", () => {
  it("assigns sequential typeIds starting at 0", () => {
    const r = new UnitTypeRegistry();
    const a = r.register(mkUnit("mk01"));
    const b = r.register(mkUnit("scout"));
    const c = r.register(mkUnit("flyer"));
    expect(a.typeId).toBe(0);
    expect(b.typeId).toBe(1);
    expect(c.typeId).toBe(2);
  });

  it("returns the same entry on re-register (idempotent on schematic id)", () => {
    const r = new UnitTypeRegistry();
    const a = r.register(mkUnit("mk01", "Mark One"));
    const a2 = r.register(mkUnit("mk01", "DIFFERENT NAME"));
    expect(a2).toBe(a); // identity equal — no replacement
    expect(a2.displayName).toBe("Mark One"); // first registration wins
  });

  it("does not bump the typeId counter on re-register", () => {
    const r = new UnitTypeRegistry();
    r.register(mkUnit("mk01"));
    r.register(mkUnit("mk01")); // dupe
    const next = r.register(mkUnit("scout"));
    expect(next.typeId).toBe(1);
  });

  it("falls back to schematicId as displayName when name is empty", () => {
    const r = new UnitTypeRegistry();
    const e = r.register(mkUnit("mk01", ""));
    expect(e.displayName).toBe("mk01");
  });

  it("retains the mesh_asset ref on the entry", () => {
    const r = new UnitTypeRegistry();
    const e = r.register(mkUnit("mk01"));
    expect(e.meshRef).toEqual({ kind: "template", template_id: "tank" });
  });

  it("permits a unit without mesh_asset (meshRef is undefined)", () => {
    const r = new UnitTypeRegistry();
    const e = r.register(mkUnit("abstract", "Abstract", false));
    expect(e.meshRef).toBeUndefined();
  });

  it("seeds maxHealth to the default (100) when no formula applies", () => {
    const r = new UnitTypeRegistry();
    const e = r.register(mkUnit("mk01"));
    expect(e.maxHealth).toBe(100);
  });
});

describe("UnitTypeRegistry lookups", () => {
  it("byId returns the registered entry", () => {
    const r = new UnitTypeRegistry();
    const e = r.register(mkUnit("mk01"));
    expect(r.byId(e.typeId)).toBe(e);
  });

  it("byId returns undefined for an unknown numeric id", () => {
    const r = new UnitTypeRegistry();
    r.register(mkUnit("mk01"));
    expect(r.byId(999)).toBeUndefined();
  });

  it("bySchematic returns the registered entry", () => {
    const r = new UnitTypeRegistry();
    const e = r.register(mkUnit("mk01"));
    expect(r.bySchematic("mk01")).toBe(e);
  });

  it("bySchematic returns undefined for an unknown schematic id", () => {
    const r = new UnitTypeRegistry();
    r.register(mkUnit("mk01"));
    expect(r.bySchematic("nope")).toBeUndefined();
  });
});

describe("UnitTypeRegistry.all", () => {
  it("returns entries in insertion order", () => {
    const r = new UnitTypeRegistry();
    r.register(mkUnit("first"));
    r.register(mkUnit("second"));
    r.register(mkUnit("third"));
    const all = r.all();
    expect(all.map((e) => e.schematicId)).toEqual(["first", "second", "third"]);
  });

  it("size matches the number of distinct registrations", () => {
    const r = new UnitTypeRegistry();
    r.register(mkUnit("a"));
    r.register(mkUnit("a")); // dupe
    r.register(mkUnit("b"));
    expect(r.size()).toBe(2);
  });
});
