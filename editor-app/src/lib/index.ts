/**
 * Barrel re-export for editor-app lib code.
 *
 * Components and hooks should import from "../lib" rather than
 * reaching into individual files. Anything not re-exported here is
 * considered internal to the lib layer.
 */

export * from "./constants";
export * from "./factions";
export * from "./voxel-grid";
export * from "./voxel-stats";
export * from "./voxel-renderer";
export * from "./derive-stats";
export * from "./zod-schemas";
export { voxelizeMesh, voxelMapToGrid } from "./voxelizer";
