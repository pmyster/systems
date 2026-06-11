/**
 * FireTestScene — Three.js layer that owns the projectile mesh, target
 * marker, the active impact effect, and the screen-space outcome label
 * for the Fire-Test feature.
 *
 * Lifecycle (driven by the BattlefieldPreview render loop):
 *
 *   createFireTestScene(scene, camera, canvas)
 *     → returns FireTestSceneHandle
 *
 *   handle.setTargetMarker(spawn, target)
 *     → render the ring + post at the chosen impact point. Idempotent.
 *
 *   handle.fire(request, outcome)
 *     → spawn projectile, advance through `flying → impact → dwell → done`,
 *       resolve the returned promise on entry to `done`.
 *
 *   handle.tick(dt_ms)
 *     → called once per frame; advances the phase machine, updates the
 *       projectile trail, ticks the impact effect, repositions the
 *       screen-space label.
 *
 *   handle.dispose()
 *     → tears down EVERY allocated GPU resource + removes the DOM label.
 *
 * GPU hygiene: every BufferGeometry, Material, and Texture allocated
 * here is paired with a `.dispose()` either in the per-shot teardown
 * (projectile, trail, impact effect) or in the scene-wide `dispose()`
 * (target marker, persistent ring meshes).
 */

import * as THREE from "three";

import {
  createImpactForProjectile,
  type ImpactEffect,
} from "../../lib/fire-test/effects";
import { samplePositionAtTime } from "../../lib/fire-test/simulator";
import type {
  FireTestRequest,
  FlightPhase,
} from "../../lib/fire-test/types";
import type {
  BeamDelivery,
  EffectKind,
  EnergyMedium,
  ProjectileSchematic,
} from "../../types/projectile";
import type { InteractionOutcome } from "../../types/vulnerability";

/**
 * Projectile body tint by effect kind. Read by the ballistic + guided
 * visual builders so kinetic shells read white-yellow, energy bolts
 * cyan, explosive shells orange, etc. Per the user's "loud over silent"
 * standard: the table is a Record over the EXHAUSTIVE EffectKind union,
 * so adding a new effect kind to the schema produces a TypeScript error
 * here until it's wired up — no silent fallback to a default colour.
 *
 * `inner` is the hot core (mesh body). `trail` is the head-end of the
 * trail gradient (the tail always fades to black or transparent).
 */
const EFFECT_PROJECTILE_TINT: Readonly<
  Record<EffectKind, { inner: number; outer: number; trail: [number, number, number] }>
> = {
  // Kinetic: classic tracer yellow + warm orange halo + warm trail.
  kinetic: { inner: 0xfff4a0, outer: 0xff8830, trail: [1.0, 0.667, 0.25] },
  // Explosive: hotter orange core, deep red halo, smoky orange trail.
  explosive: { inner: 0xffcc60, outer: 0xff4020, trail: [1.0, 0.5, 0.15] },
  // Energy: bright cyan core, electric blue halo, cyan trail.
  energy: { inner: 0xc0f0ff, outer: 0x40a0ff, trail: [0.4, 0.85, 1.0] },
  // Electronic: cool cyan-white core, violet halo, violet trail.
  electronic: { inner: 0xc0e0ff, outer: 0x8060ff, trail: [0.5, 0.4, 1.0] },
  // Persistent area: muted greenish — the carrier shell, not the cloud.
  persistent_area: { inner: 0xe0ffd0, outer: 0x70c050, trail: [0.55, 0.85, 0.4] },
};

/** Maximum number of trail samples retained per ballistic / guided shot. */
const TRAIL_MAX_POINTS = 30;

/** Dwell time the label remains visible after impact (ms). */
const DWELL_MS = 4000;

/**
 * Halo colour for the cinematic beam middle/outer layers. The inner core
 * is always white-hot; the halo carries the medium tint so the beam reads
 * as "blaster bolt with a coloured aura" rather than a thin coloured line.
 */
const BEAM_HALO_COLOR: Readonly<Record<EnergyMedium, number>> = {
  visible: 0x66ddff, // classic sci-fi cyan-white
  ir: 0xff2030,
  uv: 0xaa55ff,
  particle: 0x60ff80,
  plasma: 0x4080ff,
};

/** Beam fade-in window (ms) — opacity ramps up over this. */
const BEAM_FADE_IN_MS = 60;

/** Beam fade-out window (ms) — opacity ramps down over the last N ms of life. */
const BEAM_FADE_OUT_MS = 200;

/** Small forward step (in t) used to estimate the projectile's velocity tangent. */
const BOLT_TANGENT_DELTA_T = 0.01;

export interface FireTestSceneHandle {
  setTargetMarker(
    spawn: readonly [number, number, number],
    target: readonly [number, number, number],
  ): void;
  /**
   * Update the floating hit-zone label sprite anchored above the target
   * marker. The label is rebuilt only when the zone string changes — a
   * range/position-only update reuses the existing texture.
   *
   * The label is parented under the marker group so it tracks marker
   * visibility and position automatically; toggling the marker hides
   * the label too.
   */
  setHitZoneLabel(zone: string): void;
  /**
   * Fire a shot. Spawn + target are passed FRESH at every call — the scene
   * never caches them between setTargetMarker and fire. This is the
   * document-is-source-of-truth pattern: editing hardpoint pos/rot in the
   * form between aim-change and fire propagates through unmistakably,
   * because the caller re-reads the unit's live state and hands it to us
   * here.
   */
  fire(
    request: FireTestRequest,
    outcome: InteractionOutcome,
    spawn: readonly [number, number, number],
    target: readonly [number, number, number],
  ): Promise<void>;
  reset(): void;
  tick(dt_ms: number): void;
  getPhase(): FlightPhase;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal types.
// ---------------------------------------------------------------------------

interface TargetMarker {
  readonly group: THREE.Group;
  readonly ringGeom: THREE.RingGeometry;
  readonly ringMat: THREE.MeshBasicMaterial;
  readonly postGeom: THREE.CylinderGeometry;
  readonly postMat: THREE.MeshBasicMaterial;
  /**
   * Floating hit-zone label sprite. The current zone is cached so
   * setHitZoneLabel can short-circuit when nothing changed (the texture
   * upload cost matters when the controller spams aim-change calls).
   * Null until the first label is set.
   */
  zoneLabel: HitZoneLabel | null;
  currentZone: string | null;
}

interface HitZoneLabel {
  readonly sprite: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
  readonly texture: THREE.CanvasTexture;
}

/**
 * Build a small canvas-rendered sprite for the hit-zone label. The
 * style mirrors HardpointVisuals.createHardpointLabel — a dark
 * rounded-rect pill with white text, billboarded by the sprite
 * material so it always faces the camera. Inlined rather than reused
 * because the styling differs (no halo around the hardpoint id; here
 * we use a small ⊕ crosshair glyph + the zone in uppercase).
 */
function buildHitZoneLabel(zone: string): HitZoneLabel {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    // Loud-over-silent: a missing 2D context would ship a blank label.
    // We still build the sprite so the caller doesn't crash; the user
    // sees nothing and the warning surfaces the cause.
    // eslint-disable-next-line no-console
    console.warn(
      "[HitZoneLabel] could not acquire 2D canvas context — label will be empty.",
    );
  }
  const text = `⊕ ${zone.toUpperCase()}`;
  const FONT_PX = 36;
  const font = `600 ${FONT_PX}px -apple-system, "Segoe UI", sans-serif`;
  let textW = 80;
  if (ctx !== null) {
    ctx.font = font;
    textW = Math.ceil(ctx.measureText(text).width);
  }
  const padX = 16;
  const canvasW = Math.max(80, textW + padX * 2);
  const canvasH = 64;
  canvas.width = canvasW;
  canvas.height = canvasH;

  if (ctx !== null) {
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(20, 24, 32, 0.85)";
    const radius = 10;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(0, 0, canvasW, canvasH, radius);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
    // Border tinted with the marker's red so the label reads as part of
    // the target system rather than a free-floating chip.
    ctx.strokeStyle = "rgba(255, 80, 80, 0.85)";
    ctx.lineWidth = 2;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(1, 1, canvasW - 2, canvasH - 2, radius);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, canvasW / 2, canvasH / 2 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.premultiplyAlpha = true;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  // Scale so the sprite reads as ~0.6m tall in world units — comfortably
  // visible against terrain at the default zoom but not dominating.
  const worldH = 0.6;
  const aspect = canvasW / canvasH;
  sprite.scale.set(worldH * aspect, worldH, 1);
  // ~0.5m above the marker group's local origin (which sits on the
  // ground). The post is 1.5m tall, so this lands above the post tip
  // while still feeling pinned to the marker.
  sprite.position.set(0, 2.0, 0);
  sprite.renderOrder = 999;

  return { sprite, material, texture };
}

function disposeHitZoneLabel(l: HitZoneLabel): void {
  l.material.dispose();
  l.texture.dispose();
}

interface ProjectileVisual {
  readonly group: THREE.Group;
  /** Per-shot disposables — geometry, materials, trail buffers. */
  dispose(): void;
  /** Update the projectile mesh + trail given an updated world position. */
  update(position: readonly [number, number, number], t01: number): void;
}

interface ActiveShot {
  readonly request: FireTestRequest;
  readonly outcome: InteractionOutcome;
  readonly spawn: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly visual: ProjectileVisual;
  /** Total flight duration in ms (already dilation-adjusted + clamped). */
  readonly flight_ms: number;
  /** Optional cluster split-point marker for slice-1. */
  readonly clusterMarker: ImpactEffect | null;
  /** Elapsed time in ms in the current phase. */
  elapsed_ms: number;
  phase: FlightPhase;
  impactEffect: ImpactEffect | null;
  resolve: () => void;
}

// ---------------------------------------------------------------------------
// Target marker factory.
// ---------------------------------------------------------------------------

function buildTargetMarker(): TargetMarker {
  const group = new THREE.Group();
  group.name = "FireTestTargetMarker";

  const ringGeom = new THREE.RingGeometry(1.85, 2.0, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff5050,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02; // float just above terrain
  group.add(ring);

  const postGeom = new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8);
  const postMat = new THREE.MeshBasicMaterial({ color: 0xff5050 });
  const post = new THREE.Mesh(postGeom, postMat);
  post.position.y = 0.75;
  group.add(post);

  group.visible = false;
  return {
    group,
    ringGeom,
    ringMat,
    postGeom,
    postMat,
    zoneLabel: null,
    currentZone: null,
  };
}

function disposeTargetMarker(m: TargetMarker): void {
  m.ringGeom.dispose();
  m.ringMat.dispose();
  m.postGeom.dispose();
  m.postMat.dispose();
  if (m.zoneLabel) {
    if (m.zoneLabel.sprite.parent) {
      m.zoneLabel.sprite.parent.remove(m.zoneLabel.sprite);
    }
    disposeHitZoneLabel(m.zoneLabel);
  }
}

// ---------------------------------------------------------------------------
// Projectile visual factories — per delivery kind.
// ---------------------------------------------------------------------------

/**
 * Style knobs for the bolt/missile visual family. Keeps the trail +
 * orientation plumbing shared between ballistic and guided shots while
 * letting each carry distinct mesh geometry and trail colours.
 *
 *  - `mesh`: 'capsule' is the cinematic ballistic bolt (two stacked
 *     capsules — hot inner, additive halo). 'missile' is the guided
 *     missile (cylinder body + cone nose).
 *  - `innerColor` / `outerColor`: read from EFFECT_PROJECTILE_TINT so
 *     the projectile colour reads the effect kind at a glance.
 *  - `trailHeadColor`: RGB triple [0..1]^3 for the head of the trail
 *     gradient. Tail fades to either black (warm tracer feel) or
 *     transparent (smoke feel) per `trailMode`.
 *  - `trailMode`: 'tracer' = bright→black additive feel; 'smoke' =
 *     opaque white-grey fading to alpha — slower, lingering feel.
 *  - `outerScale`: multiplies the inner capsule radius for the additive
 *     halo (only used for 'capsule'). The 'missile' style has no halo.
 */
interface BoltVisualStyle {
  readonly mesh: "capsule" | "missile";
  readonly innerColor: number;
  readonly outerColor: number;
  readonly trailHeadColor: readonly [number, number, number];
  readonly trailMode: "tracer" | "smoke";
}

function resolveBoltStyle(
  projectile: ProjectileSchematic | null,
  meshShape: "capsule" | "missile",
  trailMode: "tracer" | "smoke",
): BoltVisualStyle {
  // Project the effect kind onto a tint. When the projectile is null
  // (unknown delivery fallback path), default to kinetic — but that
  // path doesn't use this style anyway; the unknown visual is magenta.
  const effectKind: EffectKind = projectile?.effect_params.kind ?? "kinetic";
  const tint = EFFECT_PROJECTILE_TINT[effectKind];
  return {
    mesh: meshShape,
    innerColor: tint.inner,
    outerColor: tint.outer,
    trailHeadColor: tint.trail,
    trailMode,
  };
}

function buildBoltVisual(
  withTrail: boolean,
  projectile: ProjectileSchematic | null,
  spawn: readonly [number, number, number],
  target: readonly [number, number, number],
  style: BoltVisualStyle,
): ProjectileVisual {
  const group = new THREE.Group();
  group.name = "FireTestProjectile";

  // The bolt is built on a pivot whose lookAt() each frame aligns the
  // local +Z axis with the velocity tangent. The inner `boltOrient`
  // pre-rotates the +Y-axis geometry onto +Z so everything points
  // forward at rest.
  const boltPivot = new THREE.Group();
  boltPivot.name = "FireTestBolt";
  const boltOrient = new THREE.Group();
  boltOrient.rotation.x = Math.PI / 2;
  boltPivot.add(boltOrient);

  // Per-mesh-shape geometry. We keep the geometry/material handles in
  // a single array so dispose() can release them without branching.
  const ownedGeoms: THREE.BufferGeometry[] = [];
  const ownedMats: THREE.Material[] = [];

  if (style.mesh === "capsule") {
    // Cinematic bolt: hot inner core + additive halo.
    const innerGeom = new THREE.CapsuleGeometry(0.18, 0.9, 4, 8);
    const innerMat = new THREE.MeshBasicMaterial({ color: style.innerColor });
    const inner = new THREE.Mesh(innerGeom, innerMat);
    boltOrient.add(inner);
    ownedGeoms.push(innerGeom);
    ownedMats.push(innerMat);

    const outerGeom = new THREE.CapsuleGeometry(0.36, 1.4, 4, 8);
    const outerMat = new THREE.MeshBasicMaterial({
      color: style.outerColor,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const outer = new THREE.Mesh(outerGeom, outerMat);
    boltOrient.add(outer);
    ownedGeoms.push(outerGeom);
    ownedMats.push(outerMat);
  } else {
    // Missile body: thin cylinder + pointed cone nose. Cylinder/Cone
    // default along +Y; the boltOrient pre-rotation puts them along +Z
    // so the nose leads. Push the nose forward of the body so the two
    // visually fuse into a single missile silhouette.
    const bodyLen = 1.1;
    const bodyR = 0.12;
    const bodyGeom = new THREE.CylinderGeometry(bodyR, bodyR, bodyLen, 12);
    const bodyMat = new THREE.MeshBasicMaterial({ color: style.outerColor });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    boltOrient.add(body);
    ownedGeoms.push(bodyGeom);
    ownedMats.push(bodyMat);

    const noseLen = 0.35;
    const noseGeom = new THREE.ConeGeometry(bodyR, noseLen, 12);
    const noseMat = new THREE.MeshBasicMaterial({ color: style.innerColor });
    const nose = new THREE.Mesh(noseGeom, noseMat);
    // Body centred at origin (length along +Y in geom-space → +Z after
    // pivot rotation). Place the nose at +Y bodyLen/2 + noseLen/2 in
    // the orient frame so it sits just past the body tip.
    nose.position.y = bodyLen / 2 + noseLen / 2;
    boltOrient.add(nose);
    ownedGeoms.push(noseGeom);
    ownedMats.push(noseMat);

    // A tiny stabilising fin ring near the tail so the missile reads as
    // a missile rather than a sausage. Cheap — 8 verts.
    const finGeom = new THREE.RingGeometry(bodyR, bodyR * 1.8, 8);
    const finMat = new THREE.MeshBasicMaterial({
      color: style.outerColor,
      side: THREE.DoubleSide,
    });
    const fins = new THREE.Mesh(finGeom, finMat);
    fins.position.y = -bodyLen / 2;
    // Ring lies in XY plane; rotate so it sits perpendicular to the
    // missile axis (i.e. faces along +Y in orient-space).
    fins.rotation.x = Math.PI / 2;
    boltOrient.add(fins);
    ownedGeoms.push(finGeom);
    ownedMats.push(finMat);
  }

  group.add(boltPivot);

  // Trail — fading polyline of last N positions. Tracer mode bakes the
  // gradient into vertex colours fading head→tail (head bright, tail
  // black). Smoke mode uses an opaque-ish white-grey with alpha falloff
  // baked into vertex colours too (LineBasicMaterial doesn't support
  // per-vertex alpha, so we drive the head→tail FADE via the colour's
  // luminance and a lower material opacity for the lingering feel).
  const trailPositions: number[] = [];
  let trailGeom: THREE.BufferGeometry | null = null;
  let trailMat: THREE.LineBasicMaterial | null = null;
  let trail: THREE.Line | null = null;
  if (withTrail) {
    trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3),
    );
    trailGeom.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_POINTS * 3), 3),
    );
    trailGeom.setDrawRange(0, 0);
    trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Smoke is held more opaquely than a tracer so the trail lingers
      // visually behind the missile.
      opacity: style.trailMode === "smoke" ? 0.85 : 1.0,
    });
    trail = new THREE.Line(trailGeom, trailMat);
    group.add(trail);
  }

  // Reusable scratch vectors so the per-frame update never allocates.
  const tangentTarget = new THREE.Vector3();
  const currentPos = new THREE.Vector3();

  return {
    group,
    update(position: readonly [number, number, number], t01: number) {
      boltPivot.position.set(position[0], position[1], position[2]);

      // Orient the bolt along its velocity tangent. We sample the path a
      // tiny step ahead (clamped near t=1 by stepping BACK instead) and
      // point the capsule at that next point. The bolt was authored along
      // +Z (see boltOrient pre-rotation), so lookAt aligns the tip with
      // the tangent automatically.
      if (projectile) {
        const aheadT = t01 + BOLT_TANGENT_DELTA_T;
        const useAhead = aheadT <= 1;
        const probeT = useAhead ? aheadT : t01 - BOLT_TANGENT_DELTA_T;
        const sample = samplePositionAtTime(projectile, spawn, target, probeT);
        currentPos.set(position[0], position[1], position[2]);
        tangentTarget.set(sample.position[0], sample.position[1], sample.position[2]);
        if (!useAhead) {
          // Looking at the previous point would flip the bolt 180deg.
          // Mirror through the current position to get a forward target.
          tangentTarget.subVectors(currentPos, tangentTarget).add(currentPos);
        }
        // Guard against zero-length tangent (e.g. placed/dropped paths
        // where xz doesn't move — tangentTarget can equal currentPos).
        if (currentPos.distanceToSquared(tangentTarget) > 1e-8) {
          boltPivot.lookAt(tangentTarget);
        }
      }

      if (trailGeom && trail) {
        // Push current point, cap to TRAIL_MAX_POINTS.
        trailPositions.push(position[0], position[1], position[2]);
        const maxLen = TRAIL_MAX_POINTS * 3;
        while (trailPositions.length > maxLen) {
          trailPositions.shift();
          trailPositions.shift();
          trailPositions.shift();
        }
        const posAttr = trailGeom.getAttribute("position") as THREE.BufferAttribute;
        const colAttr = trailGeom.getAttribute("color") as THREE.BufferAttribute;
        const count = trailPositions.length / 3;
        // Gradient is driven by style.trailHeadColor (the head/bright end)
        // fading to black at the tail. For 'smoke', we ALSO bias the
        // floor up toward the head colour so even the tail end of the
        // trail keeps a smoky-grey luminance (it doesn't go fully black
        // — only the material's alpha drops it out gradually with the
        // line's overall opacity). For 'tracer' we go all the way to
        // black so the trail reads as a fast hot streak.
        const [hr, hg, hb] = style.trailHeadColor;
        for (let i = 0; i < count; i++) {
          posAttr.setXYZ(
            i,
            trailPositions[i * 3 + 0],
            trailPositions[i * 3 + 1],
            trailPositions[i * 3 + 2],
          );
          const a = (i + 1) / count;
          if (style.trailMode === "smoke") {
            // Bias: tail keeps 35% of head colour so the smoke reads
            // continuous rather than fading to a black void.
            const floor = 0.35;
            const k = floor + (1 - floor) * a;
            colAttr.setXYZ(i, k * hr, k * hg, k * hb);
          } else {
            colAttr.setXYZ(i, a * hr, a * hg, a * hb);
          }
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        trailGeom.setDrawRange(0, count);
        trailGeom.computeBoundingSphere();
      }
    },
    dispose() {
      for (const g of ownedGeoms) g.dispose();
      for (const m of ownedMats) m.dispose();
      if (trailGeom) trailGeom.dispose();
      if (trailMat) trailMat.dispose();
    },
  };
}

/**
 * Unknown-delivery debug visual — the "loud over silent" fallback.
 *
 * When a projectile lands here, the delivery_kind discriminator was
 * not one we handle (a new schema variant landed without scene
 * wiring, or a hand-edited file has a bad value). Instead of
 * silently rendering a ballistic-shaped bolt and pretending nothing
 * is wrong, we draw a bright MAGENTA arrow from spawn → target that
 * is impossible to miss, and log a console warning so the cause
 * surfaces in the next debugging pass.
 *
 * The arrow is stationary for the duration of the shot (the flight
 * sample updates its tip endpoint each frame anyway, but visually
 * the magenta beam stays put — the user immediately sees "this is
 * the unknown-delivery fallback, fix the schema").
 */
function buildUnknownDebugVisual(
  spawn: readonly [number, number, number],
  target: readonly [number, number, number],
): ProjectileVisual {
  const group = new THREE.Group();
  group.name = "FireTestUnknownDebugArrow";

  const spawnV = new THREE.Vector3(spawn[0], spawn[1], spawn[2]);
  const targetV = new THREE.Vector3(target[0], target[1], target[2]);
  const delta = new THREE.Vector3().subVectors(targetV, spawnV);
  const length = Math.max(1e-3, delta.length());
  const dir = delta.clone().normalize();

  // Magenta. Bright. Unmissable.
  const MAGENTA = 0xff00ff;

  // Build the arrow shaft (thicker than a normal beam so it shouts
  // "debug, not a real visual") + a cone tip.
  const shaftRadius = 0.10;
  const shaftLen = Math.max(0.01, length - 0.6);
  const shaftGeom = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 12);
  const shaftMat = new THREE.MeshBasicMaterial({
    color: MAGENTA,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const shaft = new THREE.Mesh(shaftGeom, shaftMat);
  // Cylinder is along +Y; we'll re-orient the whole group below.
  shaft.position.y = shaftLen / 2;
  group.add(shaft);

  const tipGeom = new THREE.ConeGeometry(shaftRadius * 2.5, 0.6, 14);
  const tipMat = new THREE.MeshBasicMaterial({
    color: MAGENTA,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
  });
  const tip = new THREE.Mesh(tipGeom, tipMat);
  tip.position.y = shaftLen + 0.3;
  group.add(tip);

  // Orient: align local +Y with spawn→target direction.
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir,
  );
  group.position.copy(spawnV);
  group.quaternion.copy(quat);

  return {
    group,
    update(_position, t01) {
      // Gentle fade-in at the start, fade-out at the end so it
      // reads as a discrete event rather than an indefinite line.
      let env = 1;
      if (t01 < 0.1) env = t01 / 0.1;
      else if (t01 > 0.85) env = Math.max(0, 1 - (t01 - 0.85) / 0.15);
      shaftMat.opacity = 0.95 * env;
      tipMat.opacity = 1.0 * env;
    },
    dispose() {
      shaftGeom.dispose();
      shaftMat.dispose();
      tipGeom.dispose();
      tipMat.dispose();
    },
  };
}

function buildBeamVisual(
  spawn: readonly [number, number, number],
  target: readonly [number, number, number],
  haloColor: number,
  beam_power_kw: number,
  flight_ms: number,
): ProjectileVisual {
  const group = new THREE.Group();
  group.name = "FireTestBeam";

  // Inner core radius scales with beam power, clamped so even high-power
  // weapons stay readable (and even low-power weapons are visible).
  const coreRadius = 0.06 + Math.min(0.20, Math.max(0, beam_power_kw) / 500000);
  const haloRadius = coreRadius * 2.5;
  const glowRadius = coreRadius * 5;

  // Beam geometry: cylinder along its own Y axis, length = spawn→target distance.
  const spawnV = new THREE.Vector3(spawn[0], spawn[1], spawn[2]);
  const targetV = new THREE.Vector3(target[0], target[1], target[2]);
  const length = Math.max(1e-3, spawnV.distanceTo(targetV));
  const midpoint = new THREE.Vector3().addVectors(spawnV, targetV).multiplyScalar(0.5);

  // CylinderGeometry's axis is Y. We rotate the whole group so its local
  // +Y points from spawn→target, then position it at the midpoint. Using
  // lookAt aligns local -Z with the target, so we pre-rotate -90deg about
  // X to swap the +Y axis onto -Z. Cleaner: build a quaternion that
  // rotates (0,1,0) to the beam direction.
  const dir = new THREE.Vector3().subVectors(targetV, spawnV).normalize();
  const beamQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir,
  );

  const coreGeom = new THREE.CylinderGeometry(coreRadius, coreRadius, length, 12, 1, true);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  const core = new THREE.Mesh(coreGeom, coreMat);

  const haloGeom = new THREE.CylinderGeometry(haloRadius, haloRadius, length, 16, 1, true);
  const haloMat = new THREE.MeshBasicMaterial({
    color: haloColor,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeom, haloMat);

  const glowGeom = new THREE.CylinderGeometry(glowRadius, glowRadius, length, 20, 1, true);
  const glowMat = new THREE.MeshBasicMaterial({
    color: haloColor,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeom, glowMat);

  // Position + orient all three layers together.
  group.position.copy(midpoint);
  group.quaternion.copy(beamQuat);
  group.add(core);
  group.add(halo);
  group.add(glow);

  // Cache base opacities so the fade envelope is a pure multiplier.
  const baseCoreOpacity = 1.0;
  const baseHaloOpacity = 0.65;
  const baseGlowOpacity = 0.18;

  return {
    group,
    update(_position, t01) {
      // Fade envelope: ramp in over BEAM_FADE_IN_MS, hold, ramp out over
      // the last BEAM_FADE_OUT_MS. t01 is elapsed/flight_ms.
      const elapsed_ms = t01 * flight_ms;
      let env = 1;
      if (elapsed_ms < BEAM_FADE_IN_MS) {
        env = elapsed_ms / BEAM_FADE_IN_MS;
      } else if (elapsed_ms > flight_ms - BEAM_FADE_OUT_MS) {
        const out_t = (elapsed_ms - (flight_ms - BEAM_FADE_OUT_MS)) / BEAM_FADE_OUT_MS;
        env = Math.max(0, 1 - out_t);
      }
      coreMat.opacity = baseCoreOpacity * env;
      haloMat.opacity = baseHaloOpacity * env;
      glowMat.opacity = baseGlowOpacity * env;
    },
    dispose() {
      coreGeom.dispose();
      coreMat.dispose();
      haloGeom.dispose();
      haloMat.dispose();
      glowGeom.dispose();
      glowMat.dispose();
    },
  };
}

function buildPlacedVisual(): ProjectileVisual {
  const group = new THREE.Group();
  group.name = "FireTestPlaced";

  const geom = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0x808080 });
  const body = new THREE.Mesh(geom, mat);
  group.add(body);

  return {
    group,
    update(position, _t01) {
      body.position.set(position[0], position[1], position[2]);
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}

function buildProjectileVisual(
  projectile: ProjectileSchematic,
  spawn: readonly [number, number, number],
  target: readonly [number, number, number],
  flight_ms: number,
): ProjectileVisual {
  switch (projectile.delivery_params.kind) {
    case "ballistic": {
      // Ballistic shells: capsule bolt + warm tracer trail tinted by
      // effect kind so kinetic shells read white-yellow, energy bolts
      // cyan, explosive shells orange. The orientation + path tangent
      // plumbing is shared with guided via buildBoltVisual.
      const style = resolveBoltStyle(projectile, "capsule", "tracer");
      return buildBoltVisual(true, projectile, spawn, target, style);
    }
    case "guided": {
      // Guided missiles: distinct silhouette (cylinder body + cone
      // nose + tail fin ring) and a smoke trail (lingering, opaque-
      // grey-ish biased by the effect tint). Visually slower and
      // smoother than ballistic — the flight duration multiplier
      // lives in simulator.ts (GUIDED_CRUISE_MPS = 400 m/s, much
      // slower than typical muzzle velocities), so we don't override
      // it here; the shape change carries the "this is a missile"
      // read on its own.
      const style = resolveBoltStyle(projectile, "missile", "smoke");
      return buildBoltVisual(true, projectile, spawn, target, style);
    }
    case "beam": {
      // Halo tint follows the energy medium. ENERGY_MEDIUM_COLOR is also
      // used by the impact-flash and persisted for back-compat; the beam
      // body specifically uses the saturated BEAM_HALO_COLOR variant so
      // the visible-spectrum beam reads as cyan-white rather than washed.
      const medium: EnergyMedium =
        projectile.effect_params.kind === "energy"
          ? projectile.effect_params.medium
          : "visible";
      const haloColor = BEAM_HALO_COLOR[medium];
      return buildBeamVisual(
        spawn,
        target,
        haloColor,
        projectile.delivery_params.beam_power_kw,
        flight_ms,
      );
    }
    case "placed":
      return buildPlacedVisual();
    case "dropped": {
      // Dropped ordnance: capsule bolt, no trail (free-fall is short
      // and a trail through air just clutters the scene). Tinted by
      // effect kind for parity with ballistic.
      const style = resolveBoltStyle(projectile, "capsule", "tracer");
      return buildBoltVisual(false, projectile, spawn, target, style);
    }
    default: {
      // Loud over silent: a delivery_kind not in the schema union
      // landed here. Surface it with a magenta arrow + console
      // warning so the cause is impossible to miss in a debugging
      // session, instead of silently rendering a generic bolt.
      const unknownKind =
        (projectile.delivery_params as { kind?: unknown })?.kind;
      // eslint-disable-next-line no-console
      console.warn(
        `[FireTestScene] Unknown delivery_kind: '${String(unknownKind)}'. ` +
          `Falling back to debug arrow.`,
      );
      const _exh: never = projectile.delivery_params;
      void _exh;
      return buildUnknownDebugVisual(spawn, target);
    }
  }
}

// ---------------------------------------------------------------------------
// Outcome label DOM overlay.
// ---------------------------------------------------------------------------

interface LabelDom {
  readonly el: HTMLDivElement;
  setText(text: string, catastrophic: boolean): void;
  hide(): void;
  position(x_px: number, y_px: number): void;
  setOpacity(opacity: number): void;
  dispose(): void;
}

function buildLabelDom(canvas: HTMLCanvasElement): LabelDom {
  const parent = canvas.parentElement;
  const el = document.createElement("div");
  el.className = "fire-test-outcome-label";
  Object.assign(el.style, {
    position: "absolute",
    pointerEvents: "none",
    transform: "translate(-50%, -50%)",
    padding: "6px 10px",
    background: "rgba(20, 24, 32, 0.85)",
    color: "#ffffff",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: "6px",
    font: "12px/1.35 -apple-system, Segoe UI, sans-serif",
    letterSpacing: "0.02em",
    boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
    whiteSpace: "nowrap",
    maxWidth: "min(420px, 60vw)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    opacity: "0",
    transition: "opacity 200ms ease-out",
    zIndex: "10",
  } as Partial<CSSStyleDeclaration>);
  el.style.display = "none";
  if (parent) parent.appendChild(el);
  else canvas.parentNode?.appendChild(el);

  return {
    el,
    setText(text: string, catastrophic: boolean) {
      el.textContent = text;
      el.style.borderColor = catastrophic
        ? "rgba(220, 80, 60, 0.9)"
        : "rgba(255,255,255,0.18)";
      el.style.display = "block";
    },
    hide() {
      el.style.display = "none";
      el.style.opacity = "0";
    },
    position(x_px: number, y_px: number) {
      el.style.left = `${x_px}px`;
      el.style.top = `${y_px}px`;
    },
    setOpacity(opacity: number) {
      el.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    },
    dispose() {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}

// ---------------------------------------------------------------------------
// Main scene factory.
// ---------------------------------------------------------------------------

export function createFireTestScene(
  scene: THREE.Scene,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): FireTestSceneHandle {
  const marker = buildTargetMarker();
  scene.add(marker.group);

  const label = buildLabelDom(canvas);

  let phase: FlightPhase = "idle";
  // Active shot pool — supports multi-hardpoint simultaneous fire. Each
  // entry tracks its own ProjectileVisual, elapsed time, phase, and
  // resolution promise. The pool replaced an earlier single-active-shot
  // model that force-finished a prior shot when a new fire() landed —
  // that meant N rapid fire() calls would only visualise the last one.
  //
  // Element ordering is insertion order. Shots are removed from the
  // pool in `teardownShot` once their dwell ends. The outcome label is
  // a SHARED DOM overlay (one element per scene) so it tracks whichever
  // shot most recently transitioned to the impact phase — overlapping
  // beams onto the same target produce one label, which reads correctly
  // for convergent fire (the intent is "this shot hit the target with
  // these effects", not "barrel A then barrel B").
  const activeShots: ActiveShot[] = [];
  // NOTE: spawn/target are NOT cached here. fire() receives fresh values
  // every call so a hardpoint edit between setTargetMarker and fire is
  // honoured. setTargetMarker still moves the visual marker (purely
  // cosmetic; one-frame lag against the document is acceptable for the
  // marker, but never for the shot itself).
  // Reusable Vector3 for screen-space projection — avoid per-frame alloc.
  const projVec = new THREE.Vector3();

  function teardownShot(shot: ActiveShot): void {
    scene.remove(shot.visual.group);
    shot.visual.dispose();
    if (shot.impactEffect) {
      scene.remove(shot.impactEffect.group);
      shot.impactEffect.dispose();
      shot.impactEffect = null;
    }
    if (shot.clusterMarker) {
      scene.remove(shot.clusterMarker.group);
      shot.clusterMarker.dispose();
    }
  }

  function teardownAll(): void {
    for (const shot of activeShots) teardownShot(shot);
    activeShots.length = 0;
  }

  function projectToScreen(
    world: readonly [number, number, number],
  ): { x: number; y: number; visible: boolean } {
    projVec.set(world[0], world[1], world[2]);
    projVec.project(camera);
    const rect = canvas.getBoundingClientRect();
    const canvasRect = canvas.parentElement?.getBoundingClientRect() ?? rect;
    // Account for the canvas inside its parent — the label is appended to
    // the parent, so we need parent-relative coordinates.
    const x = (projVec.x * 0.5 + 0.5) * rect.width + (rect.left - canvasRect.left);
    const y = (projVec.y * -0.5 + 0.5) * rect.height + (rect.top - canvasRect.top);
    // z > 1 = behind the camera.
    const visible = projVec.z < 1 && projVec.z > -1;
    return { x, y, visible };
  }

  // TODO(slice-2): Full sub-arc rendering — currently a single yellow ring at
  // the cluster split point. The brief explicitly allows this simplification.

  return {
    setTargetMarker(_spawn, target) {
      // Marker only — does NOT cache spawn/target for fire(). The marker
      // is pinned to the ground (y=0) at the target's xz so it reads as
      // a sight on the terrain. The spawn argument is intentionally
      // unused: fire() takes its own fresh spawn/target so the shot is
      // always live against the current document, even if the marker
      // lags by a frame.
      void _spawn;
      marker.group.position.set(target[0], 0, target[2]);
      marker.group.visible = true;
    },

    setHitZoneLabel(zone: string) {
      // No-op when nothing changed — avoids re-rendering the canvas +
      // re-uploading the texture every frame the controller broadcasts.
      if (marker.currentZone === zone && marker.zoneLabel !== null) return;
      // Dispose the previous label (canvas texture + sprite material)
      // before building the new one. The sprite is detached + the GPU
      // resources released; the new sprite re-parents under the marker
      // group so it inherits the marker's position and visibility.
      if (marker.zoneLabel !== null) {
        if (marker.zoneLabel.sprite.parent) {
          marker.zoneLabel.sprite.parent.remove(marker.zoneLabel.sprite);
        }
        disposeHitZoneLabel(marker.zoneLabel);
      }
      const label = buildHitZoneLabel(zone);
      marker.group.add(label.sprite);
      marker.zoneLabel = label;
      marker.currentZone = zone;
    },

    fire(
      request: FireTestRequest,
      outcome: InteractionOutcome,
      spawnIn: readonly [number, number, number],
      targetIn: readonly [number, number, number],
    ): Promise<void> {
      return new Promise<void>((resolve) => {
        // Multiple concurrent shots are allowed (one per hardpoint in a
        // multi-HP volley). The single-active-shot teardown that lived
        // here previously was wrong for the multi-HP path — every new
        // fire() simply pushes onto the pool now. Per-shot disposal
        // happens when each shot's dwell ends.

        // Use the caller-supplied fresh spawn/target. The caller
        // (BattlefieldPreview.handleFire) re-computes these from the
        // live document immediately before calling us — no cache
        // between aim-change and fire.
        const spawn: [number, number, number] = [
          spawnIn[0],
          spawnIn[1],
          spawnIn[2],
        ];
        const target: [number, number, number] = [
          targetIn[0],
          targetIn[1],
          targetIn[2],
        ];

        const flight_ms = (() => {
          // Beams are visually instant.
          if (request.projectile.delivery_params.kind === "beam") {
            const d = request.projectile.delivery_params as BeamDelivery;
            return Math.min(800, Math.max(80, d.dwell_time_s * 1000));
          }
          // Delegate the rest to the simulator's clamped duration.
          // Re-import-free — derive inline by walking the same constants.
          // (This is intentional to keep the scene fully self-contained
          // and avoid a circular dependency.)
          // Conservative: cap to [200, 8000].
          // The simulator's computeFlightDurationMs is the canonical
          // implementation; we mirror the clamping behaviour.
          const D = request.projectile.delivery_params;
          const dilation = Math.max(0.01, request.time_dilation);
          let raw_ms: number;
          switch (D.kind) {
            case "ballistic":
              raw_ms = (request.range_m / Math.max(1, D.muzzle_velocity_mps)) * 1000 * dilation;
              break;
            case "guided":
              raw_ms = (request.range_m / 400) * 1000 * dilation;
              break;
            case "placed":
              raw_ms = 600 * dilation;
              break;
            case "dropped":
              raw_ms = Math.sqrt((2 * 15) / 9.81) * 1000 * dilation;
              break;
            default:
              raw_ms = 200;
          }
          if (!Number.isFinite(raw_ms) || raw_ms < 200) return 200;
          if (raw_ms > 8000) return 8000;
          return raw_ms;
        })();

        const visual = buildProjectileVisual(request.projectile, spawn, target, flight_ms);
        scene.add(visual.group);

        // Slice-1 cluster marker — yellow flash ring at the spawn
        // position to signal the parent split. Full sub-arc rendering
        // is deferred to slice 2.
        let clusterMarker: ImpactEffect | null = null;
        if (request.projectile.cluster) {
          const ringGeom = new THREE.TorusGeometry(1, 0.06, 6, 32);
          const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffd040,
            transparent: true,
            opacity: 1,
          });
          const ringMesh = new THREE.Mesh(ringGeom, ringMat);
          ringMesh.rotation.x = -Math.PI / 2;
          const group = new THREE.Group();
          group.position.set(spawn[0], spawn[1], spawn[2]);
          group.add(ringMesh);
          scene.add(group);
          clusterMarker = {
            group,
            lifetime_ms: 600,
            update(t01: number) {
              if (t01 >= 1) return false;
              ringMesh.scale.setScalar(1 + 3 * t01);
              ringMat.opacity = 1 - t01;
              return true;
            },
            dispose() {
              ringGeom.dispose();
              ringMat.dispose();
            },
          };
        }

        const shot: ActiveShot = {
          request,
          outcome,
          spawn,
          target,
          visual,
          flight_ms,
          clusterMarker,
          elapsed_ms: 0,
          phase: "flying",
          impactEffect: null,
          resolve,
        };
        activeShots.push(shot);
        phase = "flying";

        // Prime the visual at t=0.
        const initial = samplePositionAtTime(request.projectile, spawn, target, 0);
        visual.update(initial.position, 0);
      });
    },

    reset() {
      teardownAll();
      phase = "idle";
      label.hide();
      marker.group.visible = false;
    },

    tick(dt_ms: number) {
      if (activeShots.length === 0) return;

      // Tick every active shot. Removals happen in a single sweep at the
      // end so we don't mutate the array while iterating. The shared
      // outcome label tracks whichever shot most recently impacted —
      // overlapping shots on the same target produce one label per
      // impact transition, which is what the user expects.
      const finishedIndices: number[] = [];
      // Track the latest impact this frame so the label/marker move to it
      // exactly once per frame (instead of N times for N shots).
      let labelTargetThisFrame: readonly [number, number, number] | null = null;

      for (let i = 0; i < activeShots.length; i++) {
        const shot = activeShots[i];
        shot.elapsed_ms += dt_ms;

        // Cluster marker advances on its own clock.
        if (shot.clusterMarker) {
          const alive = shot.clusterMarker.update(
            Math.min(1, shot.elapsed_ms / shot.clusterMarker.lifetime_ms),
          );
          if (!alive) {
            scene.remove(shot.clusterMarker.group);
            shot.clusterMarker.dispose();
            (shot as { clusterMarker: ImpactEffect | null }).clusterMarker = null;
          }
        }

        if (shot.phase === "flying") {
          const progress = Math.min(1, shot.elapsed_ms / shot.flight_ms);
          const sample = samplePositionAtTime(
            shot.request.projectile,
            shot.spawn,
            shot.target,
            progress,
          );
          shot.visual.update(sample.position, progress);
          if (progress >= 1) {
            // Transition → impact.
            shot.elapsed_ms = 0;
            shot.phase = "impact";
            phase = "impact";

            const impact = createImpactForProjectile(shot.request.projectile, shot.target);
            scene.add(impact.group);
            shot.impactEffect = impact;

            label.setText(shot.outcome.readable_summary, shot.outcome.catastrophic);
            // Show immediately; opacity is driven each frame.
            label.setOpacity(1);
            labelTargetThisFrame = shot.target;

            // Beam visual is already fading out; ballistic/guided trails
            // and placed-cylinder remain visible until dwell ends.
          }
        } else if (shot.phase === "impact" || shot.phase === "dwell") {
          if (shot.phase === "impact") {
            shot.phase = "dwell";
            phase = "dwell";
          }
          if (shot.impactEffect) {
            const t01 = Math.min(1, shot.elapsed_ms / shot.impactEffect.lifetime_ms);
            const alive = shot.impactEffect.update(t01);
            if (!alive) {
              scene.remove(shot.impactEffect.group);
              shot.impactEffect.dispose();
              shot.impactEffect = null;
            }
          }

          // Track this shot's target as the label anchor. If multiple
          // shots are in the dwell phase the LAST one wins this frame's
          // label position — fine for the common convergent-fire case
          // where every shot shares the same world target, and a
          // reasonable approximation otherwise.
          labelTargetThisFrame = shot.target;

          if (shot.elapsed_ms >= DWELL_MS) {
            finishedIndices.push(i);
          }
        }
      }

      // Update the shared label/position once per frame from the freshest
      // impact target. Opacity is driven by the freshest dwell elapsed —
      // we use the maximum elapsed dwell time across active shots so the
      // fade-out happens after the LAST shot dwells out.
      if (labelTargetThisFrame !== null) {
        const proj = projectToScreen(labelTargetThisFrame);
        if (proj.visible) {
          label.position(proj.x, proj.y);
        }
        let maxDwellElapsed = 0;
        for (const s of activeShots) {
          if (s.phase === "dwell" && s.elapsed_ms > maxDwellElapsed) {
            maxDwellElapsed = s.elapsed_ms;
          }
        }
        const fadeStart = Math.max(0, DWELL_MS - 600);
        if (maxDwellElapsed < fadeStart) {
          label.setOpacity(1);
        } else {
          const f = (maxDwellElapsed - fadeStart) / Math.max(1, DWELL_MS - fadeStart);
          label.setOpacity(1 - f);
        }
      }

      // Sweep finished shots (highest index first so splice indices stay
      // valid). Each finished shot disposes its GPU resources and
      // resolves its caller promise — callers awaiting fire() return
      // here.
      for (let i = finishedIndices.length - 1; i >= 0; i--) {
        const idx = finishedIndices[i];
        const shot = activeShots[idx];
        const resolveFn = shot.resolve;
        teardownShot(shot);
        activeShots.splice(idx, 1);
        resolveFn();
      }
      if (activeShots.length === 0 && finishedIndices.length > 0) {
        phase = "done";
        label.hide();
      }
    },

    getPhase() {
      return phase;
    },

    dispose() {
      teardownAll();
      scene.remove(marker.group);
      disposeTargetMarker(marker);
      label.dispose();
    },
  };
}
