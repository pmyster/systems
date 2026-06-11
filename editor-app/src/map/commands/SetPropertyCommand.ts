/**
 * SetPropertyCommand — write a value at an arbitrary path inside an
 * `objects[id]` or `spawnPoints[id]` record, with full do/undo support.
 *
 * The property path is a dotted string (e.g. `"position.x"` or
 * `"properties.maxHp"`). At construction we capture the old value at
 * that path so undo is exact even if the same property gets edited
 * again by something else later.
 *
 * Design choice: we deep-clone the affected record on do/undo rather
 * than mutating in place. The records are tiny (a transform + a
 * properties bag) and immutability lets selectors short-circuit on
 * reference equality.
 */

import type { Command } from "./Command";
import { mapStore } from "../state/mapStore";
import type {
  InstanceObject,
  SpawnPoint,
} from "../state/mapStore";

export type SetPropertyEntityKind = "object" | "spawn";

function getAtPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Return a shallow-cloned copy of `root` where the path-targeted leaf is
 * replaced with `value`. Each intermediate object on the path is cloned
 * so callers can safely keep the original reference.
 *
 * Throws if any intermediate segment doesn't exist on the original —
 * this is a property SETTER, not a property creator. Adding new
 * top-level properties requires a separate command type.
 */
function setAtPath<T extends object>(
  root: T,
  path: string[],
  value: unknown,
): T {
  if (path.length === 0) {
    throw new Error("SetPropertyCommand: empty path");
  }
  const clone: T = { ...root };
  let cur: Record<string, unknown> = clone as unknown as Record<
    string,
    unknown
  >;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const child = cur[seg];
    if (child === null || typeof child !== "object") {
      throw new Error(
        `SetPropertyCommand: path segment "${seg}" missing or not an object`,
      );
    }
    const childClone = { ...(child as Record<string, unknown>) };
    cur[seg] = childClone;
    cur = childClone;
  }
  cur[path[path.length - 1]] = value;
  return clone;
}

export interface SetPropertyParams {
  entityKind: SetPropertyEntityKind;
  id: string;
  /** Dotted property path, e.g. "position.x" or "properties.label". */
  propertyPath: string;
  newValue: unknown;
  /** ms-since-epoch for merge windowing. Defaults to Date.now(). */
  timestamp?: number;
}

export class SetPropertyCommand implements Command {
  readonly kind = "SetProperty";
  readonly timestamp: number;
  private readonly entityKind: SetPropertyEntityKind;
  private readonly id: string;
  private readonly path: string[];
  private readonly oldValue: unknown;
  private readonly newValue: unknown;

  constructor(params: SetPropertyParams) {
    this.entityKind = params.entityKind;
    this.id = params.id;
    this.path = params.propertyPath.split(".");
    this.newValue = params.newValue;
    this.timestamp = params.timestamp ?? Date.now();
    const entity = this.readEntity();
    if (!entity) {
      throw new Error(
        `SetPropertyCommand: no ${params.entityKind} with id ${params.id}`,
      );
    }
    this.oldValue = getAtPath(entity, this.path);
  }

  private readEntity(): InstanceObject | SpawnPoint | undefined {
    const s = mapStore.getState();
    return this.entityKind === "object"
      ? s.objects[this.id]
      : s.spawnPoints[this.id];
  }

  private writeEntity(value: unknown): void {
    const s = mapStore.getState();
    const entity = this.readEntity();
    if (!entity) return;
    if (this.entityKind === "object") {
      const next = setAtPath(entity as InstanceObject, this.path, value);
      s._setObjects({ ...s.objects, [this.id]: next });
    } else {
      const next = setAtPath(entity as SpawnPoint, this.path, value);
      s._setSpawnPoints({ ...s.spawnPoints, [this.id]: next });
    }
  }

  do(): void {
    this.writeEntity(this.newValue);
  }

  undo(): void {
    this.writeEntity(this.oldValue);
  }
}
