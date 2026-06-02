/**
 * SelectionController — Phase 1 Week 2
 *
 * Translates left-click + drag-box into ECS selection state.
 *
 * Selection model (matches every RTS the player has ever touched):
 *   - Left-click on a unit → that unit is selected (others cleared).
 *   - Left-click on empty space → clear selection.
 *   - Left-click drag from empty space → marquee box; on release every
 *     unit whose world position projects into the box is selected.
 *   - Shift+click adds; Ctrl+click removes.
 *
 * Why selection lives in the ECS (Selected component) rather than a
 * Set<number> in this controller:
 *   - It lives or dies with the entity — destroy() doesn't have to
 *     remember to clean a side table.
 *   - Renderers / HUD / commands all see the same source of truth.
 *   - Adding "select all on screen" or "select all of type" becomes a
 *     query, not a coordination problem.
 *
 * The sim NEVER reads Selected — see Stance/MovementTarget for the
 * sim-relevant decisions. Selection is purely UI.
 *
 * Raycasting against InstancedMesh:
 *   THREE.Raycaster handles InstancedMesh out of the box; the
 *   intersection result has `.instanceId` filled in. We translate
 *   (typeId, instanceId) → eid via a per-frame snapshot supplied by
 *   the runtime (its UnitRenderSystem already builds this bucketing).
 *
 * Selection priority (per brief):
 *   own > allied > enemy
 *   mobile > static within own
 *   subgroup_priority sort within mobile
 *   Adaptive fallback default of 50
 *
 * Phase 1 only has team 0 (player's own units) and every unit is
 * mobile — so the priority comparator collapses to a no-op for now.
 * The hook is wired so Week 3 (which adds enemies + statics) can drop
 * in the real comparator without ripping the controller apart.
 */

import * as THREE from "three";
import {
  addComponent,
  hasComponent,
  query,
  removeComponent,
} from "bitecs";

import {
  Position,
  Selected,
  TeamId,
  type SimWorld,
} from "../../sim/world";

/**
 * The runtime supplies a callback that resolves
 *   (instancedMesh, instanceId) → entityId
 * because the renderer is the one that knows the slot→eid mapping.
 * (UnitRenderSystem builds this each frame from the bitECS query.)
 */
export type InstanceLookup = (mesh: THREE.InstancedMesh, instanceId: number) => number | null;

const LEFT_BUTTON = 0;
/** Pixel distance the mouse must travel for a press → drag instead of click. */
const DRAG_THRESHOLD_PX = 4;

export interface SelectionControllerOpts {
  readonly world: SimWorld;
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;
  readonly unitsGroup: THREE.Object3D;
  readonly instanceLookup: InstanceLookup;
  /**
   * Called whenever the set of selected entities changes (after the
   * controller has finished writing the Selected component). The HUD
   * subscribes here.
   */
  readonly onSelectionChanged?: (selectedEids: readonly number[]) => void;
}

/** Public marquee state for the runtime's overlay layer to read & draw. */
export interface MarqueeRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export class SelectionController {
  private readonly world: SimWorld;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly unitsGroup: THREE.Object3D;
  private readonly instanceLookup: InstanceLookup;
  private readonly onSelectionChanged?: (sel: readonly number[]) => void;
  private readonly raycaster = new THREE.Raycaster();
  private mouseDownX = 0;
  private mouseDownY = 0;
  private mouseDownButton = -1;
  private dragging = false;
  private shiftHeld = false;
  private ctrlHeld = false;
  private currentMarquee: MarqueeRect | null = null;

  constructor(opts: SelectionControllerOpts) {
    this.world = opts.world;
    this.camera = opts.camera;
    this.domElement = opts.domElement;
    this.unitsGroup = opts.unitsGroup;
    this.instanceLookup = opts.instanceLookup;
    this.onSelectionChanged = opts.onSelectionChanged;
    this.bind();
  }

  dispose(): void {
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  /** Returns the active marquee rect in canvas-local px, or null. */
  getMarquee(): MarqueeRect | null {
    return this.currentMarquee;
  }

  /** Returns the currently selected entity ids — used by CommandController. */
  getSelectedEids(): number[] {
    return Array.from(query(this.world, [Selected]));
  }

  private bind(): void {
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  // --- Listeners -------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Shift") this.shiftHeld = true;
    else if (e.key === "Control") this.ctrlHeld = true;
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === "Shift") this.shiftHeld = false;
    else if (e.key === "Control") this.ctrlHeld = false;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button !== LEFT_BUTTON) return;
    this.mouseDownButton = LEFT_BUTTON;
    this.mouseDownX = e.clientX;
    this.mouseDownY = e.clientY;
    this.dragging = false;
    this.currentMarquee = null;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.mouseDownButton !== LEFT_BUTTON) return;
    const dx = e.clientX - this.mouseDownX;
    const dy = e.clientY - this.mouseDownY;
    if (!this.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      this.dragging = true;
    }
    // Marquee rect in canvas-local px so the HUD overlay draws right.
    const rect = this.domElement.getBoundingClientRect();
    this.currentMarquee = {
      x0: this.mouseDownX - rect.left,
      y0: this.mouseDownY - rect.top,
      x1: e.clientX - rect.left,
      y1: e.clientY - rect.top,
    };
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button !== LEFT_BUTTON || this.mouseDownButton !== LEFT_BUTTON) return;
    this.mouseDownButton = -1;
    try {
      if (this.dragging && this.currentMarquee) {
        this.applyMarqueeSelection(this.currentMarquee);
      } else {
        // Single click — raycast hit-test.
        this.applyClickSelection(e.clientX, e.clientY);
      }
    } finally {
      this.dragging = false;
      this.currentMarquee = null;
    }
  };

  // --- Selection logic -------------------------------------------------

  private toNdc(clientX: number, clientY: number, out: THREE.Vector2): boolean {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    out.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    out.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return true;
  }

  private clearAllSelection(): void {
    const sel = query(this.world, [Selected]);
    // Copy first; bitECS query views are live.
    const ids = Array.from(sel);
    for (let i = 0; i < ids.length; i++) {
      if (hasComponent(this.world, ids[i], Selected)) {
        removeComponent(this.world, ids[i], Selected);
      }
    }
  }

  private addToSelection(eid: number): void {
    if (!hasComponent(this.world, eid, Selected)) {
      addComponent(this.world, eid, Selected);
    }
  }

  private removeFromSelection(eid: number): void {
    if (hasComponent(this.world, eid, Selected)) {
      removeComponent(this.world, eid, Selected);
    }
  }

  private emitChanged(): void {
    if (!this.onSelectionChanged) return;
    this.onSelectionChanged(this.getSelectedEids());
  }

  private applyClickSelection(clientX: number, clientY: number): void {
    const ndc = new THREE.Vector2();
    if (!this.toNdc(clientX, clientY, ndc)) return;
    this.raycaster.setFromCamera(ndc, this.camera);

    // Raycaster against InstancedMesh returns intersections with
    // `.instanceId`. We test the units group; only InstancedMesh
    // children are relevant, but Three.js handles the filtering.
    const intersections = this.raycaster.intersectObject(this.unitsGroup, true);
    let hitEid: number | null = null;
    for (let i = 0; i < intersections.length; i++) {
      const hit = intersections[i];
      const obj = hit.object;
      if (!(obj instanceof THREE.InstancedMesh)) continue;
      if (hit.instanceId === undefined || hit.instanceId === null) continue;
      const eid = this.instanceLookup(obj, hit.instanceId);
      if (eid === null) continue;
      hitEid = eid;
      break;
    }

    if (hitEid === null) {
      // Empty space.
      if (!this.shiftHeld && !this.ctrlHeld) {
        this.clearAllSelection();
        this.emitChanged();
      }
      return;
    }

    if (this.ctrlHeld) {
      this.removeFromSelection(hitEid);
    } else if (this.shiftHeld) {
      this.addToSelection(hitEid);
    } else {
      this.clearAllSelection();
      this.addToSelection(hitEid);
    }
    this.emitChanged();
  }

  private applyMarqueeSelection(rect: MarqueeRect): void {
    // Normalize the rect (drag can go any direction).
    const minX = Math.min(rect.x0, rect.x1);
    const maxX = Math.max(rect.x0, rect.x1);
    const minY = Math.min(rect.y0, rect.y1);
    const maxY = Math.max(rect.y0, rect.y1);

    const rectEl = this.domElement.getBoundingClientRect();
    const projected = new THREE.Vector3();
    const ents = query(this.world, [Position, TeamId]);
    const hits: number[] = [];
    for (let i = 0; i < ents.length; i++) {
      const eid = ents[i];
      // Phase 1: only own-team units (team 0). When Week 3 adds
      // enemies + allies, this is where the own>allied>enemy priority
      // gate goes.
      if (TeamId.value[eid] !== 0) continue;
      projected.set(Position.x[eid], Position.y[eid], Position.z[eid]);
      projected.project(this.camera);
      // NDC → canvas-local px.
      const px = (projected.x * 0.5 + 0.5) * rectEl.width;
      const py = (-projected.y * 0.5 + 0.5) * rectEl.height;
      // Behind-the-camera rejection.
      if (projected.z > 1 || projected.z < -1) continue;
      if (px < minX || px > maxX) continue;
      if (py < minY || py > maxY) continue;
      hits.push(eid);
    }

    if (!this.shiftHeld && !this.ctrlHeld) this.clearAllSelection();
    for (let i = 0; i < hits.length; i++) {
      if (this.ctrlHeld) this.removeFromSelection(hits[i]);
      else this.addToSelection(hits[i]);
    }
    this.emitChanged();
  }
}
