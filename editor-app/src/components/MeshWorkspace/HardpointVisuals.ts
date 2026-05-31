/**
 * HardpointVisuals — pure Three.js factory for the orange-arrow gizmo
 * markers that show a hardpoint's position + forward axis in the Mesh
 * Workspace viewer.
 *
 * The arrow always points along the LOCAL +Z axis of the returned Group —
 * matching the Three.js convention used by `Object3D.getWorldDirection()`,
 * so what the artist sees in the viewer is exactly what the runtime uses
 * to fire projectiles. The runtime reads `getWorldDirection()` directly;
 * no axis-guessing band-aid is needed.
 *
 * Visual: a short cylinder "shaft" along +Z with a cone "head" at the
 * tip, both painted orange by default. A floating ID label (canvas
 * sprite) hovers above the arrow tip — billboarded toward the camera by
 * the sprite material so it stays readable from any angle.
 *
 * Tint modes (composed by the caller's state, applied via `colorArrow`):
 *   - "default"  — orange. The resting colour for every arrow.
 *   - "gizmo"    — yellow. Used by MeshViewer to mark the arrow currently
 *                   attached to the TransformControls gizmo.
 *   - "highlight" — cyan. Used by the BattlefieldPreview fire-test bar to
 *                   mark hardpoints that are checked for the next fire.
 *
 * When the caller wants BOTH gizmo and highlight to be visible at once,
 * pass "highlight" — cyan wins, because the fire-test selection is the
 * more decision-relevant state in that moment (the gizmo's attached
 * arrow is already identifiable by the gizmo itself).
 *
 * GPU ownership: the factory hands back a Group plus a `dispose` function
 * that frees BOTH geometries, BOTH materials, the label sprite material,
 * AND the label canvas texture. The caller MUST invoke dispose when the
 * arrow is removed from the scene — never let an arrow fall out of the
 * active set without dispose() (memory hygiene rule).
 */

import * as THREE from "three";

const COLOR_DEFAULT = 0xffaa00; // orange
const COLOR_GIZMO = 0xffff00; // yellow
const COLOR_HIGHLIGHT = 0x00ffff; // cyan

const SHAFT_RADIUS = 0.02;
const SHAFT_LENGTH = 0.5;
const HEAD_RADIUS = 0.08;
const HEAD_HEIGHT = 0.25;

/** Tint modes accepted by `colorArrow`. See file header. */
export type HardpointArrowTint = "default" | "gizmo" | "highlight";

export interface HardpointArrow {
  /** Root group — set its `position`/`quaternion` to place the hardpoint. */
  readonly group: THREE.Group;
  /** Free the arrow's GPU resources. Call after removing from the scene. */
  readonly dispose: () => void;
}

// ---------------------------------------------------------------------------
// Floating label canvas factory.
//
// The label is a Three.js Sprite — auto-billboarded by its material, so it
// always faces the camera regardless of the arrow's orientation. The texture
// is a small offscreen canvas with the hardpoint's id painted on a
// semi-transparent dark background; the sprite is scaled in world units so
// the text reads cleanly at typical zoom but does not dominate the arrow.
//
// The canvas size is over-sampled (DPR ~2x) so the text edges stay crisp on
// high-DPI displays — Tauri runs at the OS DPR, which is typically 1.5-2x.
// ---------------------------------------------------------------------------

/** World-space height of the label sprite, in meters. */
const LABEL_WORLD_HEIGHT_M = 0.22;
/** Y offset above the arrow tip, in meters. */
const LABEL_Y_OFFSET_M = 0.18;
/** Bitmap canvas size — driven by DPR for crisp rendering. */
const LABEL_CANVAS_HEIGHT_PX = 64;
const LABEL_FONT_PX = 36;

interface HardpointLabel {
  readonly sprite: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
  readonly texture: THREE.CanvasTexture;
}

function createHardpointLabel(id: string): HardpointLabel {
  // Paint the text once on a canvas and wrap it in a CanvasTexture. The
  // canvas width is sized to the rendered text so the sprite's aspect
  // ratio matches the bitmap (no horizontal squishing on long ids).
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    // Loud-over-silent: if the browser refuses a 2D context we'd otherwise
    // ship a blank label. Surface the failure so it's not invisible.
    // eslint-disable-next-line no-console
    console.warn(
      `[Hardpoint label] could not acquire 2D canvas context for "${id}" — ` +
        `label will be empty. This typically only happens on broken WebGL drivers.`,
    );
  }
  // Measure first so the canvas is sized to the text, padded a touch on
  // each side. The measurement font MUST match the draw font, so set it
  // before measuring.
  const font = `600 ${LABEL_FONT_PX}px -apple-system, "Segoe UI", sans-serif`;
  let textW = 64;
  if (ctx !== null) {
    ctx.font = font;
    textW = Math.ceil(ctx.measureText(id).width);
  }
  const padX = 16;
  const canvasW = Math.max(64, textW + padX * 2);
  const canvasH = LABEL_CANVAS_HEIGHT_PX;
  canvas.width = canvasW;
  canvas.height = canvasH;

  if (ctx !== null) {
    // Re-set font: setting canvas.width above resets the context's drawing
    // state, so the earlier `ctx.font = font` was wiped.
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Semi-transparent dark pill background for contrast against any scene.
    ctx.fillStyle = "rgba(10, 13, 18, 0.78)";
    // Rounded-rect: pre-Chromium 99 lacks roundRect, but Tauri's webview is
    // current — and a plain rect still reads well if rounding is absent.
    const radius = 10;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(0, 0, canvasW, canvasH, radius);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(id, canvasW / 2, canvasH / 2 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  // The canvas paints with premultiplied alpha conventions; flag it so the
  // sprite material's blending is correct (no halo around the pill).
  texture.premultiplyAlpha = true;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false, // sprites should never write depth (alpha edges)
  });
  const sprite = new THREE.Sprite(material);
  // Scale the sprite so its on-screen height is roughly LABEL_WORLD_HEIGHT_M.
  // Aspect comes from the bitmap (textW + padding).
  const aspect = canvasW / canvasH;
  sprite.scale.set(LABEL_WORLD_HEIGHT_M * aspect, LABEL_WORLD_HEIGHT_M, 1);
  // Position above the arrow tip (which is at SHAFT_LENGTH + HEAD_HEIGHT
  // along +Z). The sprite ignores its local +Z orientation — it billboards
  // — so we offset along +Y so it floats above the arrow visually no
  // matter how the arrow is rotated. (Yes, the arrow can be rotated so
  // its tip points down; in that case the label stays above the arrow's
  // GROUP origin, which is still readable.)
  sprite.position.set(0, LABEL_Y_OFFSET_M, SHAFT_LENGTH + HEAD_HEIGHT / 2);
  sprite.renderOrder = 999; // draw on top of the arrow shaft/head

  return { sprite, material, texture };
}

/**
 * Build a fresh arrow group pointing along local +Z with a floating id
 * label hovering near the tip. The shaft runs from z=0 to z=SHAFT_LENGTH;
 * the head sits at z = SHAFT_LENGTH + HEAD_HEIGHT/2 so its base meets the
 * shaft tip and its point looks "out". This matches the standard Three.js
 * arrow helper but keeps full control of the geometry/materials for
 * skin-free disposal.
 *
 * The `id` is rendered into the label sprite at build time; if the
 * caller's hardpoint id is renamed, the arrow should be disposed + rebuilt
 * (the reconciler does this naturally when keying by id).
 */
export function createHardpointArrow(id: string): HardpointArrow {
  const group = new THREE.Group();
  group.name = `HardpointArrow:${id}`;

  // Shaft — CylinderGeometry's axis is local +Y by default, so we rotate
  // the mesh 90° about +X to lay it along +Z (the convention we want).
  const shaftGeom = new THREE.CylinderGeometry(
    SHAFT_RADIUS,
    SHAFT_RADIUS,
    SHAFT_LENGTH,
    12,
  );
  const shaftMat = new THREE.MeshBasicMaterial({
    color: COLOR_DEFAULT,
    depthTest: true,
    depthWrite: true,
    transparent: false,
  });
  const shaft = new THREE.Mesh(shaftGeom, shaftMat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = SHAFT_LENGTH / 2;
  group.add(shaft);

  // Head — same axis-correction rotation, positioned past the shaft tip.
  const headGeom = new THREE.ConeGeometry(HEAD_RADIUS, HEAD_HEIGHT, 12);
  const headMat = new THREE.MeshBasicMaterial({
    color: COLOR_DEFAULT,
    depthTest: true,
    depthWrite: true,
    transparent: false,
  });
  const head = new THREE.Mesh(headGeom, headMat);
  head.rotation.x = Math.PI / 2;
  head.position.z = SHAFT_LENGTH + HEAD_HEIGHT / 2;
  group.add(head);

  // Floating label (id text). Always faces the camera — Sprite.
  const label = createHardpointLabel(id);
  group.add(label.sprite);

  const dispose = (): void => {
    shaftGeom.dispose();
    shaftMat.dispose();
    headGeom.dispose();
    headMat.dispose();
    label.material.dispose();
    label.texture.dispose();
  };

  return { group, dispose };
}

/**
 * Tint the arrow's shaft+head materials. See file-header table for the
 * mapping from `tint` to colour. Mutates in place — the arrow's identity
 * (the Group instance the caller holds) is unchanged. The label sprite
 * is intentionally left alone: its text already encodes identity, and
 * recolouring the pill would muddy the contrast.
 */
export function colorArrow(arrow: HardpointArrow, tint: HardpointArrowTint): void {
  let colorHex: number;
  switch (tint) {
    case "default":
      colorHex = COLOR_DEFAULT;
      break;
    case "gizmo":
      colorHex = COLOR_GIZMO;
      break;
    case "highlight":
      colorHex = COLOR_HIGHLIGHT;
      break;
    default: {
      const _exh: never = tint;
      void _exh;
      colorHex = COLOR_DEFAULT;
    }
  }
  arrow.group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshBasicMaterial) {
          mat.color.setHex(colorHex);
        }
      }
    }
  });
}
