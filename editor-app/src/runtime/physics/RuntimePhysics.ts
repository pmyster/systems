/**
 * RuntimePhysics — Phase 1 Week 1B
 *
 * Wraps a Rapier3D world + the heightfield collider built from the loaded
 * map. Owned by the runtime shell; stepped from the same frame that drives
 * `/sim` (but currently Week 1B doesn't step it — no entities yet — the
 * world exists so Week 1C's body creation has a target).
 *
 * Why @dimforge/rapier3d-compat:
 *   The `-compat` build ships a single JS file (no separate WASM fetch),
 *   which keeps Vite + Tauri packaging simple. The trade-off: a one-time
 *   async `RAPIER.init()` call before any Rapier API can be used.
 *
 *   `initRapier()` below is module-level idempotent — concurrent callers
 *   share one promise. The MatchLoader awaits it before constructing
 *   anything that touches Rapier types.
 *
 * Heightfield collider:
 *   Rapier's heightfield expects an `nrows × ncols` flat Float32 array
 *   indexed `i = row * ncols + col`, and a `scale` Vector3 that gives the
 *   field's full extent: `scale.x = world width` (X axis), `scale.z = world
 *   depth` (Z axis), `scale.y = vertical multiplier on the height values`.
 *   Since our heightmap is already in world meters, `scale.y = 1`.
 *
 *   The collider is centred on its own origin; we translate the static body
 *   to (widthM/2, 0, depthM/2) so its corner aligns with the
 *   RuntimeTerrain mesh corner at (0, 0, 0).
 *
 *   We tested visually by walking entities across in Week 1C — they ride
 *   the slopes exactly when the manifest's tileSizeM matches the editor's.
 */

import * as RAPIER from "@dimforge/rapier3d-compat";

import type { LoadedMap } from "../loader/mapLoader";

const DEFAULT_TILE_SIZE_M = 1;

/**
 * Module-level singleton init. Rapier-compat REQUIRES `await RAPIER.init()`
 * before any constructor (RigidBodyDesc, World, ColliderDesc) — calling
 * `new World(...)` before init throws cryptically inside the WASM glue.
 *
 * We make the call once and cache the promise so every load path awaits
 * the same warm-up.
 */
let rapierInitPromise: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init();
  }
  return rapierInitPromise;
}

export interface RuntimePhysicsOptions {
  readonly gravity?: { x: number; y: number; z: number };
}

export class RuntimePhysics {
  readonly world: RAPIER.World;
  /** Width of the terrain in world meters; matches RuntimeTerrain.widthM. */
  readonly widthM: number;
  /** Depth of the terrain in world meters; matches RuntimeTerrain.depthM. */
  readonly depthM: number;

  private readonly heightfieldCollider: RAPIER.Collider;

  constructor(map: LoadedMap, options: RuntimePhysicsOptions = {}) {
    const gravity = options.gravity ?? { x: 0, y: -9.81, z: 0 };
    this.world = new RAPIER.World(gravity);

    const w = map.manifest.terrain.widthPx;
    const h = map.manifest.terrain.heightPx;
    const tileM = map.manifest.terrain.tileSizeM ?? DEFAULT_TILE_SIZE_M;
    this.widthM = (w - 1) * tileM;
    this.depthM = (h - 1) * tileM;

    // Rapier wants its own Float32Array (no shared buffer between worlds in
    // a future multi-instance setup). Cheap to copy ~16k floats once.
    const heights = new Float32Array(map.heightmap.length);
    heights.set(map.heightmap);

    // nrows = h - 1, ncols = w - 1 means each pixel maps to a heightfield
    // corner. Matches the PlaneGeometry segment count in RuntimeTerrain so
    // the collider tracks the rendered mesh vertex-for-vertex.
    const colliderDesc = RAPIER.ColliderDesc.heightfield(
      h - 1,
      w - 1,
      heights,
      { x: this.widthM, y: 1.0, z: this.depthM },
    );

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
      this.widthM / 2,
      0,
      this.depthM / 2,
    );
    const body = this.world.createRigidBody(bodyDesc);
    this.heightfieldCollider = this.world.createCollider(colliderDesc, body);
  }

  /**
   * Step the world by `dt` seconds. Week 1B doesn't call this from the
   * frame loop (no bodies yet); Week 1C wires it in alongside sim.advance.
   */
  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** Suppress unused-private-field — keeps the collider rooted for tests. */
  getHeightfieldCollider(): RAPIER.Collider {
    return this.heightfieldCollider;
  }

  /** Free WASM resources. Call on match teardown. */
  dispose(): void {
    this.world.free();
  }
}
