/**
 * Public surface of the unit-state module. Components and hooks should
 * import from "../state" rather than reaching into individual files.
 */

export {
  UnitStateProvider,
  useUnitDispatch,
  useUnitState,
} from "./UnitStateProvider";
export {
  blankUnit,
  initialUnitState,
  makeInitialUnitState,
  unitReducer,
  type FileMeta,
  type UnitAction,
  type UnitState,
} from "./unit-store";
export {
  selectFaction,
  selectFile,
  selectIsDirty,
  selectMirrorX,
  selectUnit,
  selectVoxels,
  selectWindowTitle,
} from "./selectors";
export {
  embedVoxelsIntoChassis,
  embedVoxelsIntoUnit,
  extractVoxelsFromUnit,
} from "./voxel-sync";
