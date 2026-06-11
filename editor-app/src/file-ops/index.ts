/**
 * Public surface of the file-ops module. Tauri-native Open / Save /
 * Save As / autosave / physics_version bump.
 */

export {
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  getAutosavePath,
  startAutosave,
  type AutosaveHandle,
} from "./autosave";
export {
  OpenParseError,
  OpenValidationError,
  openUnit,
  type OpenedUnit,
} from "./open";
export {
  SaveValidationError,
  saveUnit,
  saveUnitAs,
  toCanonicalJson,
} from "./save";
export { bumpPhysicsVersion } from "./version-bump";
export {
  ProjectileCycleError,
  ProjectileLoadValidationError,
  ProjectileParseError,
  ProjectileSaveValidationError,
  hasCycle,
  listProjectiles,
  loadProjectile,
  saveProjectile,
  toCanonicalProjectileJson,
  type ProjectileFileEntry,
} from "./projectile-ops";
