/**
 * Barrel export for the VoxelSculptor component.
 *
 * App-level consumers import via:
 *   import { VoxelSculptor } from "./components/VoxelSculptor";
 *
 * Internal modules (scene, controls, picking, input, palette, tools)
 * are not re-exported — they are implementation details.
 */

export { VoxelSculptor } from "./VoxelSculptor";
export type { VoxelSculptorProps } from "./VoxelSculptor";
