import type { ChassisClass } from '../../types/unit';
import * as THREE from 'three';

export interface TemplateDef {
  /** Unique slug, e.g. 'tank' */
  readonly id: string;
  /** Display name shown in the gallery */
  readonly name: string;
  /** One-sentence description shown on hover */
  readonly description: string;
  /** Pre-fills the chassis class dropdown when this template is picked */
  readonly defaultChassisClass: ChassisClass;
  /**
   * Builds and returns a fresh THREE.Group each call.
   * The group is centered at origin, max dimension ≤ 8 units.
   * Caller is responsible for disposing geometry/materials when done.
   */
  buildGeometry(): THREE.Group;
}
