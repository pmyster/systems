/**
 * DecalRegistry + built-in decal kinds.
 *
 * Decals are flat textured quads placed on the terrain surface for visual
 * storytelling (scorch marks, tire tracks, blast craters). We deliberately
 * generate the textures via canvas at registry-load time rather than
 * shipping image assets — no extra build pipeline, no async loading, no
 * texture-atlas thinking, and the decal palette is easy to iterate.
 *
 * Defensive pattern: the registry is data-driven so adding a new decal
 * kind is a single `register({...})` call. Unknown kinds at render time
 * are LOGGED (loud-over-silent) but the data still round-trips through
 * save/load — so authoring with a not-yet-registered kind degrades
 * gracefully and re-registering it later restores the visual.
 */

import * as THREE from "three";

export interface DecalDef {
  readonly kind: string;
  readonly displayName: string;
  /** Side length of the decal quad in meters at scale=1. */
  readonly baseSize: number;
  /**
   * Build the shared material once. The material can be reused across
   * every instance of this decal — per-instance state lives on the
   * quad mesh (transform + per-mesh opacity multiplier).
   */
  build(): { material: THREE.Material };
}

class DecalRegistry {
  private byKind = new Map<string, DecalDef>();

  register(d: DecalDef): void {
    this.byKind.set(d.kind, d);
  }

  get(kind: string): DecalDef | undefined {
    return this.byKind.get(kind);
  }

  list(): readonly DecalDef[] {
    return Array.from(this.byKind.values());
  }
}

export const decalRegistry = new DecalRegistry();

// ---------------------------------------------------------------------------
// Built-in decal palette — generated procedurally via canvas.
// ---------------------------------------------------------------------------

function makeRadialCanvas(
  size: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  paint(ctx);
  return c;
}

function makeDecalMaterial(canvas: HTMLCanvasElement): THREE.Material {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // polygonOffset pulls the decal slightly toward the camera in depth-
  // buffer space so it wins the depth test against the terrain triangle
  // it's lying on — without this we'd see z-fighting flicker on close-up
  // viewing angles. We ALSO lift the quad 0.05m above terrain in
  // DecalRenderer for the same reason at grazing angles.
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

decalRegistry.register({
  kind: "scorch",
  displayName: "Scorch mark",
  baseSize: 3,
  build: () => {
    const canvas = makeRadialCanvas(256, (ctx) => {
      const r = 128;
      const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, "rgba(20,15,10,0.95)");
      grad.addColorStop(0.4, "rgba(45,30,18,0.7)");
      grad.addColorStop(0.7, "rgba(80,55,30,0.35)");
      grad.addColorStop(1, "rgba(80,55,30,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      // Sprinkle a few darker dots so the burn doesn't look like a pure
      // mathematical radial — gives the eye texture to latch onto.
      ctx.fillStyle = "rgba(10,5,2,0.5)";
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * r * 0.7;
        const x = r + Math.cos(a) * rr;
        const y = r + Math.sin(a) * rr;
        ctx.fillRect(x, y, 3, 3);
      }
    });
    return { material: makeDecalMaterial(canvas) };
  },
});

decalRegistry.register({
  kind: "tire_track",
  displayName: "Tire tracks",
  baseSize: 4,
  build: () => {
    const canvas = makeRadialCanvas(256, (ctx) => {
      ctx.clearRect(0, 0, 256, 256);
      // Two parallel dark strips.
      ctx.fillStyle = "rgba(30,22,16,0.7)";
      ctx.fillRect(60, 30, 30, 196);
      ctx.fillRect(166, 30, 30, 196);
      // Tread pattern stamped across each strip.
      ctx.fillStyle = "rgba(20,14,10,0.85)";
      for (let y = 30; y < 226; y += 16) {
        ctx.fillRect(60, y, 30, 8);
        ctx.fillRect(166, y, 30, 8);
      }
    });
    return { material: makeDecalMaterial(canvas) };
  },
});

decalRegistry.register({
  kind: "blast_crater",
  displayName: "Blast crater",
  baseSize: 6,
  build: () => {
    const canvas = makeRadialCanvas(256, (ctx) => {
      const r = 128;
      const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, "rgba(15,10,8,0.95)");
      grad.addColorStop(0.2, "rgba(35,25,18,0.8)");
      grad.addColorStop(0.5, "rgba(90,65,40,0.5)");
      grad.addColorStop(0.85, "rgba(130,100,65,0.25)");
      grad.addColorStop(1, "rgba(130,100,65,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
    });
    return { material: makeDecalMaterial(canvas) };
  },
});
