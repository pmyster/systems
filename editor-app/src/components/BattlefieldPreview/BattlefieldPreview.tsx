/**
 * BattlefieldPreview — right-pane top-down 3D viewport.
 *
 * Per docs/editor-app-tauri-brief.md and the Prototype-3 lift map:
 *   - Renders the currently-edited unit on procedural terrain.
 *   - Pure visualiser: no editing, no mutation of the Schematic.
 *   - TA-style fixed-azimuth, tilt-clamped, perspective camera with
 *     strategic zoom (see DESIGN.md Pillar 1 — Terrain matters).
 *   - Re-renders the unit when the `unit` prop changes; the terrain
 *     itself is mounted once per session.
 *
 * The component owns three side-effect lifecycles:
 *   1. Mount    — build scene/renderer/terrain/lights/controls.
 *   2. Resize   — ResizeObserver on the container ref drives renderer
 *                 + camera projection updates.
 *   3. Unit swap — useEffect on the unit prop swaps the active unit
 *                  mesh, disposing the previous one.
 *
 * The render loop is RAF-driven and pauses while the document is
 * hidden (visibilitychange). FPS is sampled over ~500ms and shown in
 * the corner HUD per the brief.
 *
 * No new dependencies. Strict TS, no `any`.
 */

import { useEffect, useRef, useState } from "react";

import { useMeshAssets } from "../../state/mesh-assets";
import type { UnitSchematic } from "../../types";

import { attachControls, type ControlsHandle } from "./controls";
import { buildBattlefieldScene, type BattlefieldScene } from "./scene";
import {
  createUnitOnTerrain,
  type UnitOnTerrainHandle,
} from "./unit-on-terrain";

interface BattlefieldPreviewProps {
  readonly unit: UnitSchematic;
}

// ---------------------------------------------------------------------------
// Inline styles — kept here so the component is self-contained and the
// integration agent doesn't need to touch App.css. Faint, top-right
// overlays per the brief; pointer-events: none so they never steal input.
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  background: "#1a1d28",
};

const canvasWrapStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  cursor: "grab",
  userSelect: "none",
};

const hudStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 10,
  padding: "4px 8px",
  background: "rgba(10, 13, 18, 0.55)",
  border: "1px solid rgba(201, 165, 92, 0.35)",
  borderRadius: 3,
  font: "11px/1.35 SF Mono, Menlo, Consolas, monospace",
  color: "#d8dde6",
  pointerEvents: "none",
  letterSpacing: "0.04em",
};

const hudTitleStyle: React.CSSProperties = {
  color: "#c9a55c",
  fontWeight: 600,
};

const hudRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
};

const hudDimStyle: React.CSSProperties = {
  color: "#8a93a3",
};

const hudValueStyle: React.CSSProperties = {
  color: "#c9a55c",
  fontVariantNumeric: "tabular-nums",
};

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function BattlefieldPreview({ unit }: BattlefieldPreviewProps): React.ReactElement {
  // Container ref hosts the renderer's canvas; ResizeObserver watches it.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Long-lived scene handles — built once per mount, torn down on
  // unmount. Held in refs so re-renders don't reconstruct them.
  const sceneRef = useRef<BattlefieldScene | null>(null);
  const unitSlotRef = useRef<UnitOnTerrainHandle | null>(null);
  const controlsRef = useRef<ControlsHandle | null>(null);

  // FPS is the only render-loop value surfaced to React state. Updating
  // it ~twice/sec is fine; the render loop itself never calls setState.
  const [fps, setFps] = useState<number>(0);

  // Diagnostic — which path the preview rendered and whether a skin was
  // attached. Surfaced in the HUD so rendering issues are visible without
  // a debugger.
  const [srcMode, setSrcMode] = useState<"mesh" | "voxel" | "empty">("empty");
  const [skinOn, setSkinOn] = useState<boolean>(false);

  // Mesh-first source + skin from the shared context. When a mesh is present
  // the preview renders a deep clone of it; otherwise it falls back to voxels.
  const { meshSource, skinImage } = useMeshAssets();

  // -------------------------------------------------------------------------
  // Mount: build scene + start render loop.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const battlefield = buildBattlefieldScene();
    sceneRef.current = battlefield;

    // Mount the renderer's canvas into the container.
    const canvas = battlefield.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    // Mount the active unit on the terrain.
    unitSlotRef.current = createUnitOnTerrain(
      battlefield.scene,
      battlefield.terrain,
      unit,
    );

    // Attach pointer / keyboard / wheel handlers.
    controlsRef.current = attachControls(
      canvas,
      battlefield.camera,
      battlefield.lighting,
    );

    // -- Resize ---------------------------------------------------------------
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        battlefield.resize(width, height);
      }
    });
    ro.observe(container);
    // Initial size so the first frame is correct.
    const initRect = container.getBoundingClientRect();
    battlefield.resize(initRect.width, initRect.height);

    // -- Render loop ----------------------------------------------------------
    let raf = 0;
    let running = true;
    let lastTime = performance.now();
    let fpsFrames = 0;
    let fpsLast = lastTime;

    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      controlsRef.current?.tickKeys(dt);

      battlefield.renderer.render(battlefield.scene, battlefield.camera.camera);

      fpsFrames++;
      if (now - fpsLast > 500) {
        const sample = (fpsFrames * 1000) / (now - fpsLast);
        setFps(Math.round(sample));
        fpsFrames = 0;
        fpsLast = now;
      }
    };
    raf = requestAnimationFrame(tick);

    // -- Pause on tab-hidden --------------------------------------------------
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        lastTime = performance.now();
        fpsLast = lastTime;
        fpsFrames = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // -- Cleanup --------------------------------------------------------------
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      controlsRef.current?.detach();
      controlsRef.current = null;
      unitSlotRef.current?.dispose();
      unitSlotRef.current = null;
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
      battlefield.dispose();
      sceneRef.current = null;
    };
    // Intentionally empty deps — the scene lives for the component's
    // lifetime. The unit prop is reconciled by a separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Unit reconciliation: mesh-first when a mesh source exists (deep-cloned +
  // skinned), voxel fallback otherwise. Terrain and lights remain.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const slot = unitSlotRef.current;
    if (!slot) return;
    if (meshSource) {
      slot.setMeshUnit(meshSource, skinImage);
      setSrcMode("mesh");
      setSkinOn(skinImage !== null);
    } else {
      slot.setUnit(unit); // voxel fallback for mesh-less units
      setSrcMode("voxel");
      setSkinOn(false);
    }
  }, [unit, meshSource, skinImage]);

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------
  return (
    <div style={containerStyle}>
      <div ref={containerRef} style={canvasWrapStyle} />
      <div style={hudStyle} aria-hidden>
        <div style={hudTitleStyle}>BATTLEFIELD PREVIEW</div>
        <div style={hudRowStyle}>
          <span style={hudDimStyle}>FPS</span>
          <span style={hudValueStyle}>{fps || "—"}</span>
        </div>
        <div style={hudRowStyle}>
          <span style={hudDimStyle}>UNIT</span>
          <span style={hudValueStyle}>{unit.name || unit.id || "—"}</span>
        </div>
        <div style={hudRowStyle}>
          <span style={hudDimStyle}>SRC</span>
          <span style={hudValueStyle}>{srcMode}</span>
        </div>
        <div style={hudRowStyle}>
          <span style={hudDimStyle}>SKIN</span>
          <span style={hudValueStyle}>{skinOn ? "on" : "off"}</span>
        </div>
      </div>
    </div>
  );
}
