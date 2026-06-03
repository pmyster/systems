/**
 * Barrel re-export for editor-app types.
 *
 * Consumers should import from "./types" (or "../../types" relative to
 * a component) rather than reaching into individual files — that way
 * file reorgs don't ripple through the codebase.
 */

export * from "./unit";
export * from "./part";
export * from "./voxel";
export * from "./derived";
export * from "./projectile";
// vulnerability.ts re-exports ArmorMaterial under a different taxonomy
// (steel/composite/reactive/ceramic — the physical resolver inputs)
// from the legacy chassis ArmorMaterial in ./unit (salvaged_steel /
// alloy_composite / ...). Export the vulnerability symbols explicitly
// and rename to avoid the collision.
export type {
  ArmorZone,
  ArmorMaterial as VulnerabilityArmorMaterial,
  CrewExposure,
  ZoneArmor,
  ElectronicSystem,
  CrewVulnerability,
  VulnerabilityProfile,
  InteractionOutcome,
} from "./vulnerability";
