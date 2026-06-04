/**
 * /runtime/scene/proceduralMeshes.ts — Phase 2 Stage 1
 *
 * Procedural placeholder geometry for the four Stage 1 building chassis
 * classes. Each builder returns a fresh THREE.Group composed of primitive
 * geometries (Box/Cylinder/Sphere) approximating the building's silhouette.
 *
 * Why /runtime, not /sim, not /lib/templates:
 *   - /sim is purity-locked (no THREE).
 *   - /lib/templates is the "Battlefield Preview"-era template gallery
 *     used by the Unit Editor for new-unit authoring. Putting building
 *     meshes there would surface them as "new unit" templates in the
 *     editor's create-unit dropdown, which is the wrong UX. Buildings are
 *     placed in Match Setup, not authored as units by hand. We keep the
 *     procedural builders here in /runtime/scene where the renderer lives;
 *     MatchLoader registers them with the PrefabBank under a fresh
 *     `kind: "procedural_building"` MeshAssetRef variant.
 *
 * Mesh budget — each placeholder is intentionally minimal:
 *   turret  : base (Box 4×2×4) + stem (Cyl r=1, h=1) + barrel (Box 0.5×0.5×3)
 *   wall    : single Box 4×3×0.5
 *   aa      : base (Cyl r=1.5, h=4) + turret (Cyl r=2, h=0.5) + barrel tilted
 *   bunker  : hemisphere (Sphere r=3, lower half clipped) + entrance (Box)
 *
 * Each builder is PURE (no Date.now / Math.random) so the geometry hash is
 * deterministic — important for prefab caching by reference.
 *
 * Builder output contract:
 *   - Returns a THREE.Group containing meshes named so InstancedUnitRenderer's
 *     traversal picks the chassis hull first (primary mesh = team tint).
 *   - All sub-meshes use MeshStandardMaterial so team-tinting + lighting
 *     work consistently with GLB-backed units.
 *   - Max bbox dimension ~6m for v1, matching the Stage 1 schematic
 *     length_m of 6 (the InstancedUnitRenderer doesn't rescale procedural
 *     prefabs since they aren't normalized — the schematic owns sizing).
 *
 * Caching:
 *   - PrefabBank dedups by mesh asset key; each chassis class gets its
 *     own template id so all turrets share one prefab, all walls share one,
 *     etc. (See proceduralBuildingTemplateId() for the key map.)
 */

import * as THREE from "three";

import type { BuildingChassisClass } from "../../types/unit";

// ---------------------------------------------------------------------------
// Material palette
//
// Faction tinting happens at render time via instanceColor on the primary
// (chassis hull) mesh — these base colors are what the tint multiplies
// against. Pick neutral mid-greys so team-blue (0x4a90e2) and team-red
// (0xe24a4a) read distinctly without clobbering the silhouette.
// ---------------------------------------------------------------------------

const BASE_GREY = 0x6b7280;
const DARK_GREY = 0x4b5563;
const ACCENT_GOLD = 0xc9a55c;

function makeBaseMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: BASE_GREY });
}
function makeDarkMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: DARK_GREY });
}
function makeAccentMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: ACCENT_GOLD });
}

// ---------------------------------------------------------------------------
// Builders — one per chassis class. Each returns a fresh Group.
// ---------------------------------------------------------------------------

/**
 * Turret: a thick square base with a stout cylindrical stem and a
 * forward-pointing barrel. ~6m wide, ~3.5m tall.
 *
 * Mesh ordering matters: the CHASSIS (base) goes FIRST so
 * InstancedUnitRenderer treats it as the primary tint target.
 */
export function buildTurretMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_turret_root";

  // Base — primary chassis mesh.
  const baseGeo = new THREE.BoxGeometry(4, 2, 4);
  const base = new THREE.Mesh(baseGeo, makeBaseMat());
  base.name = "turret_base";
  base.position.set(0, 1, 0);
  group.add(base);

  // Stem (rotates from base to barrel mount).
  const stemGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
  const stem = new THREE.Mesh(stemGeo, makeDarkMat());
  stem.name = "turret_stem";
  stem.position.set(0, 2.5, 0);
  group.add(stem);

  // Barrel — points along +Z (the runtime's "forward" convention).
  const barrelGeo = new THREE.BoxGeometry(0.5, 0.5, 3);
  const barrel = new THREE.Mesh(barrelGeo, makeDarkMat());
  barrel.name = "turret_barrel";
  barrel.position.set(0, 3.0, 1.5);
  group.add(barrel);

  // Accent ring on stem — visual flair.
  const accentGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.2, 12);
  const accent = new THREE.Mesh(accentGeo, makeAccentMat());
  accent.name = "turret_accent";
  accent.position.set(0, 2.1, 0);
  group.add(accent);

  return group;
}

/**
 * Wall: a single box, 4m wide × 3m tall × 0.5m thick. Faces along +Z by
 * default so a wall placed at yaw=0 blocks attacks coming from +Z / -Z.
 */
export function buildWallMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_wall_root";

  const geo = new THREE.BoxGeometry(4, 3, 0.5);
  const mesh = new THREE.Mesh(geo, makeBaseMat());
  mesh.name = "wall_body";
  mesh.position.set(0, 1.5, 0);
  group.add(mesh);

  // Accent band along the top — visual cue this is "armored".
  const accentGeo = new THREE.BoxGeometry(4, 0.3, 0.6);
  const accent = new THREE.Mesh(accentGeo, makeAccentMat());
  accent.name = "wall_accent";
  accent.position.set(0, 2.85, 0);
  group.add(accent);

  return group;
}

/**
 * AA tower: a tall cylindrical base with a wider cap and an upward-tilted
 * barrel. The cap is the rotating turret; the barrel points up + forward
 * to communicate the "anti-air" intent visually.
 */
export function buildAATowerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_aa_root";

  // Tall base (primary chassis mesh).
  const baseGeo = new THREE.CylinderGeometry(1.5, 1.5, 4, 16);
  const base = new THREE.Mesh(baseGeo, makeBaseMat());
  base.name = "aa_base";
  base.position.set(0, 2, 0);
  group.add(base);

  // Wider turret cap.
  const capGeo = new THREE.CylinderGeometry(2, 2, 0.5, 16);
  const cap = new THREE.Mesh(capGeo, makeDarkMat());
  cap.name = "aa_cap";
  cap.position.set(0, 4.25, 0);
  group.add(cap);

  // Tilted-up barrel — rotates 45° up from horizontal.
  const barrelGeo = new THREE.CylinderGeometry(0.25, 0.25, 3, 8);
  const barrel = new THREE.Mesh(barrelGeo, makeDarkMat());
  barrel.name = "aa_barrel";
  // Geo defaults along Y; rotate +X by 45° gives a forward+upward tilt.
  barrel.rotation.x = Math.PI / 4;
  // Position the barrel base at the cap, sticking forward + up.
  // sin/cos(45) ≈ 0.707 — half the barrel length forward & up from the cap top.
  barrel.position.set(0, 4.5 + 0.707 * 1.5, 0.707 * 1.5);
  group.add(barrel);

  // Accent ring at the cap-base junction.
  const accentGeo = new THREE.CylinderGeometry(1.7, 1.7, 0.15, 16);
  const accent = new THREE.Mesh(accentGeo, makeAccentMat());
  accent.name = "aa_accent";
  accent.position.set(0, 4.0, 0);
  group.add(accent);

  return group;
}

/**
 * Bunker: a hemispherical dome with a small rectangular entrance box.
 * The dome is built as a full sphere then visually anchored so only the
 * top half pokes above ground.
 */
export function buildBunkerMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "building_bunker_root";

  // Dome — primary chassis mesh. Use SphereGeometry with phiLength tuned
  // to render only the upper hemisphere (thetaStart=0, thetaLength=π/2).
  const domeGeo = new THREE.SphereGeometry(3, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, makeBaseMat());
  dome.name = "bunker_dome";
  dome.position.set(0, 0, 0);
  group.add(dome);

  // Entrance — small box on the forward (+Z) face.
  const entranceGeo = new THREE.BoxGeometry(1.4, 1.6, 1);
  const entrance = new THREE.Mesh(entranceGeo, makeDarkMat());
  entrance.name = "bunker_entrance";
  entrance.position.set(0, 0.8, 2.6);
  group.add(entrance);

  // Accent band at the dome base — frames the silhouette.
  const accentGeo = new THREE.CylinderGeometry(3.05, 3.05, 0.2, 16);
  const accent = new THREE.Mesh(accentGeo, makeAccentMat());
  accent.name = "bunker_accent";
  accent.position.set(0, 0.1, 0);
  group.add(accent);

  return group;
}

// ---------------------------------------------------------------------------
// Dispatch by chassis class.
// ---------------------------------------------------------------------------

/**
 * Returns a fresh THREE.Group for the given building chassis class.
 *
 * Adaptive-over-specific: adding a 5th building class needs ONE entry in
 * BUILDING_CHASSIS_CLASSES + the corresponding case here. No registry
 * sprinkling. Throws on an unknown class — loud over silent, by spec.
 */
export function buildProceduralBuildingMesh(
  chassis: BuildingChassisClass,
): THREE.Group {
  switch (chassis) {
    case "building_turret":
      return buildTurretMesh();
    case "building_wall":
      return buildWallMesh();
    case "building_aa":
      return buildAATowerMesh();
    case "building_bunker":
      return buildBunkerMesh();
    default: {
      // Closed-union exhaustiveness check. If a new chassis class lands
      // upstream and this falls through, TS will complain at compile time.
      const _exhaustive: never = chassis;
      throw new Error(
        `buildProceduralBuildingMesh: unknown building chassis "${_exhaustive as string}".`,
      );
    }
  }
}

/**
 * Stable template id for a building chassis class. Used to build the
 * MeshAssetRef that buildings receive at MatchLoader time so the PrefabBank
 * dedups one prefab per chassis class.
 */
export function proceduralBuildingTemplateId(
  chassis: BuildingChassisClass,
): string {
  return `procedural_${chassis}`;
}
