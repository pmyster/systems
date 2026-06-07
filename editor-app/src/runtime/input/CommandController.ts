/**
 * CommandController — Phase 1 Week 2
 *
 * Translates right-click + hotkeys on the canvas into `SimCommand`
 * records pushed onto the SimRunner's CommandBus. This is the seam
 * between "the player pressed a thing" and "the sim sees an input
 * tagged with the tick at which to apply it."
 *
 * RMB semantics (rebound 2026-06-07):
 *   The camera now rebinds RMB-DRAG to "rotate around the pivot". We
 *   still want classic RTS "right-click on empty ground = move". To
 *   make the two coexist on the same button we disambiguate at
 *   release time:
 *     - RMB-DOWN + small move + short hold → click → move command
 *     - RMB-DOWN + large move OR long hold → drag → camera rotated; no command
 *   Thresholds live next to the controller as RMB_CLICK_PX_THRESHOLD
 *   and RMB_CLICK_MS_THRESHOLD. The down event records position+time;
 *   the up event checks against the thresholds and either fires or
 *   suppresses the move.
 *
 * Workflow when the user right-clicks the ground with units selected:
 *   1. Raycast against the terrain to find a world-space point.
 *   2. Ask the PathFollowController to plan a path from each
 *      selected unit's current position to that point. The controller
 *      writes the FIRST waypoint into MovementTarget directly
 *      (render-side) AND enqueues a `move` SimCommand stamped with
 *      the current tick (deterministic replay foundation).
 *   3. Future ticks' arrival callbacks pop the next waypoint and
 *      write it; the command bus does NOT need a record per waypoint.
 *
 * Why both render-side write AND command bus entry?
 *   - The render-side write lets the unit start moving THIS frame
 *     (no waiting for the sim tick to roll around — feels responsive).
 *   - The command bus entry is the replay-canonical record. On replay,
 *     applyCommands re-stamps MovementTarget from the same payload
 *     and gets the same outcome.
 *   Lockstep determinism caveat (acknowledged in the brief): the
 *   recast path itself isn't currently part of the log, so a replay
 *   that re-computes a path against a slightly different navmesh
 *   could diverge. Week 4 hardens this.
 *
 * Hotkeys:
 *   - S → stop (clears MovementTarget on selected entities)
 *   - H → set Stance=HoldGround (stub; full stance system Week 3)
 *   - E → cycle stance (stub; logs only)
 *
 * Cursor feedback is intentionally minimal Week 2: we set an arrow
 * cursor over terrain when units are selected. Red attack reticle
 * comes when enemies do.
 */

import * as THREE from "three";

import type { CommandBus, SimCommand } from "../../sim/commandBus";
import type { SimClock } from "../../sim/clock";
import type { SelectionController } from "./SelectionController";
import type { PathFollowController } from "../pathfinding/PathFollowController";

const RIGHT_BUTTON = 2;

/**
 * RMB click-vs-drag thresholds (added 2026-06-07 alongside the camera
 * rebind).
 *
 * The owner's rebind makes RMB-DRAG rotate the camera. But the classic
 * RTS convention is also "RMB on empty ground = move command". We
 * disambiguate by tracking the down-event and only firing the move
 * command on UP when the cursor barely moved and the press was brief.
 * Match the GUI/editor convention for click-vs-drag.
 *
 *   - 5 px of cursor movement OR
 *   - 250 ms of press duration
 * either crosses the threshold → treat as drag (rotation, no command).
 *
 * Otherwise → click → issue move command at the up-position raycast.
 * Both gates are cheap; failing either alone is enough to count as a
 * drag. The "long press with no movement" case (e.g. user holds RMB
 * thinking) reads as drag-intent which is the safer of the two for the
 * sim (no spurious move).
 */
const RMB_CLICK_PX_THRESHOLD = 5;
const RMB_CLICK_MS_THRESHOLD = 250;

export interface CommandControllerOpts {
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;
  readonly terrainMesh: THREE.Mesh;
  readonly commands: CommandBus;
  readonly clock: SimClock;
  readonly selection: SelectionController;
  readonly pathFollower: PathFollowController;
  /** Set the unit-render group cursor over terrain when units are selected. */
  readonly cursorTarget?: HTMLElement;
}

export class CommandController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly terrainMesh: THREE.Mesh;
  private readonly commands: CommandBus;
  private readonly clock: SimClock;
  private readonly selection: SelectionController;
  private readonly pathFollower: PathFollowController;
  private readonly cursorTarget?: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  // RMB click-vs-drag state — captured at down-time, consulted at up-time.
  private rmbDownX = 0;
  private rmbDownY = 0;
  private rmbDownAtMs = 0;
  private rmbDown = false;

  constructor(opts: CommandControllerOpts) {
    this.camera = opts.camera;
    this.domElement = opts.domElement;
    this.terrainMesh = opts.terrainMesh;
    this.commands = opts.commands;
    this.clock = opts.clock;
    this.selection = opts.selection;
    this.pathFollower = opts.pathFollower;
    this.cursorTarget = opts.cursorTarget;
    this.bind();
  }

  dispose(): void {
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.domElement.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  private bind(): void {
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    // mouseup binds on window: an RMB release outside the canvas still
    // counts as the release of THIS down. Without this, the user
    // dragging off-canvas to rotate would leave us in a "phantom RMB
    // down" state and the next click anywhere would fire a move.
    window.addEventListener("mouseup", this.onMouseUp);
    this.domElement.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private toNdc(clientX: number, clientY: number, out: THREE.Vector2): boolean {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    out.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    out.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return true;
  }

  private raycastTerrain(clientX: number, clientY: number): THREE.Vector3 | null {
    const ndc = new THREE.Vector2();
    if (!this.toNdc(clientX, clientY, ndc)) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.terrainMesh, false);
    if (hits.length === 0) return null;
    return hits[0].point.clone();
  }

  // --- Listeners -------------------------------------------------------

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button !== RIGHT_BUTTON) return;
    // Record press state; decide click-vs-drag at MouseUp time. RtsCamera
    // also listens for RMB-down → it starts rotating in parallel. If the
    // gesture ends up being a click (no drag), RtsCamera's rotation was
    // a 0-px no-op (no mousemove between down and up). If it's a drag,
    // we ignore at up-time so no spurious move command fires.
    this.rmbDown = true;
    this.rmbDownX = e.clientX;
    this.rmbDownY = e.clientY;
    this.rmbDownAtMs = performance.now();
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button !== RIGHT_BUTTON) return;
    if (!this.rmbDown) return;
    this.rmbDown = false;
    const dx = e.clientX - this.rmbDownX;
    const dy = e.clientY - this.rmbDownY;
    const dist = Math.hypot(dx, dy);
    const dur = performance.now() - this.rmbDownAtMs;
    // Drag → camera rotation owns the gesture; no move command.
    if (dist >= RMB_CLICK_PX_THRESHOLD || dur >= RMB_CLICK_MS_THRESHOLD) return;

    const selected = this.selection.getSelectedEids();
    if (selected.length === 0) return;

    const target = this.raycastTerrain(e.clientX, e.clientY);
    if (target === null) return;

    e.preventDefault();

    // Compute paths and stamp the first waypoint per unit, so motion
    // begins this very frame; the path follower owns the rest of the
    // queue and rotates waypoints in on arrival.
    this.pathFollower.requestMove(selected, target);

    // Append the canonical command to the bus stamped with the current
    // tick — the replay foundation. applyCommands at replay time
    // re-stamps MovementTarget from this payload.
    const cmd: SimCommand = {
      tick: this.clock.tickId,
      playerId: 0,
      kind: "move",
      payload: {
        x: target.x,
        z: target.z,
        entityIds: selected.join(","),
      },
    };
    this.commands.enqueue(cmd);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    // Cheap cursor feedback: arrow cursor when hovering terrain with
    // a non-empty selection, default otherwise. (Red attack reticle is
    // a Week 3 add when enemies exist.)
    if (!this.cursorTarget) return;
    const selected = this.selection.getSelectedEids();
    if (selected.length === 0) {
      this.cursorTarget.style.cursor = "";
      return;
    }
    const hit = this.raycastTerrain(e.clientX, e.clientY);
    this.cursorTarget.style.cursor = hit ? "crosshair" : "";
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Hotkeys only fire when a real selection exists (parallels RTS UX).
    const selected = this.selection.getSelectedEids();
    if (selected.length === 0) return;

    switch (e.code) {
      case "KeyS": {
        this.pathFollower.cancel(selected);
        this.commands.enqueue({
          tick: this.clock.tickId,
          playerId: 0,
          kind: "stop",
          payload: { entityIds: selected.join(",") },
        });
        break;
      }
      case "KeyH": {
        // Stance hotkey stub — full handling lands Week 3 when target
        // acquisition reads Stance to gate auto-engage behavior.
        console.info("[CommandController] H: HoldGround (stub, Week 3)");
        break;
      }
      case "KeyE": {
        console.info("[CommandController] E: cycle stance (stub, Week 3)");
        break;
      }
    }
  };
}
