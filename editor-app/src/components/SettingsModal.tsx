/**
 * SettingsModal — global editor preferences.
 *
 * Currently exposes:
 *  - User Prefab Folder override (absolute path; empty = dev default)
 *  - Scan-on-startup toggle
 *  - Manual "Scan now" trigger that re-runs the prefab manifest loader
 *
 * Design notes:
 *  - Click on the dim overlay outside the dialog closes the modal —
 *    standard expectation, but we stopPropagation on the dialog body so
 *    clicks inside don't bubble up and close it.
 *  - The folder input is a real text field too (not just Browse-only) so
 *    power users can paste a path. The Tauri folder dialog is the easy
 *    button for everyone else.
 *  - Scan errors surface inline (no toast/banner system here yet) —
 *    loud-over-silent so the user sees WHY their folder isn't loading.
 */

import { useState } from "react";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";

import { useSettings } from "../state/settings";
import { loadPrefabManifest } from "../map/scene/prefabLoader";

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const userPrefabFolder = useSettings((s) => s.userPrefabFolder);
  const scanOnStartup = useSettings((s) => s.scanOnStartup);
  const setUserPrefabFolder = useSettings((s) => s.setUserPrefabFolder);
  const setScanOnStartup = useSettings((s) => s.setScanOnStartup);

  const [scanResult, setScanResult] = useState<string>("");
  const [scanning, setScanning] = useState(false);

  async function handleBrowse(): Promise<void> {
    try {
      const result = await openFolderDialog({
        directory: true,
        title: "Choose user prefab folder",
        defaultPath: userPrefabFolder || undefined,
      });
      if (typeof result === "string") {
        setUserPrefabFolder(result);
      }
    } catch (e) {
      console.warn("[SettingsModal] folder dialog failed:", e);
    }
  }

  function handleClear(): void {
    setUserPrefabFolder("");
  }

  async function handleScanNow(): Promise<void> {
    setScanning(true);
    setScanResult("Scanning…");
    try {
      const before = Date.now();
      const r = await loadPrefabManifest();
      const elapsed = Date.now() - before;
      setScanResult(
        `Scan completed in ${elapsed}ms — ${r.loaded} loaded, ${r.builtins} built-in, ${r.failed.length} failed.`,
      );
    } catch (e) {
      setScanResult(`Scan failed: ${String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Editor settings"
      >
        <div className="settings-header">
          <h3>Settings</h3>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Assets</div>

          <label className="settings-row">
            <span className="settings-label">User Prefab Folder</span>
            <div className="settings-folder-row">
              <input
                type="text"
                className="settings-folder-input"
                value={userPrefabFolder}
                placeholder="(default: public/prefabs/user/)"
                onChange={(e) => setUserPrefabFolder(e.target.value)}
              />
              <button type="button" onClick={handleBrowse}>
                Browse…
              </button>
              {userPrefabFolder && (
                <button
                  type="button"
                  onClick={handleClear}
                  title="Reset to default"
                >
                  Clear
                </button>
              )}
            </div>
            <span className="settings-hint">
              Drop .glb files into this folder and they auto-appear in the
              Prefab Library. Leave empty to use the dev default.
            </span>
          </label>

          <label className="settings-row settings-row-inline">
            <input
              type="checkbox"
              checked={scanOnStartup}
              onChange={(e) => setScanOnStartup(e.target.checked)}
            />
            <span>Scan on startup</span>
          </label>

          <div className="settings-row settings-scan-row">
            <button type="button" onClick={handleScanNow} disabled={scanning}>
              {scanning ? "Scanning…" : "Scan now"}
            </button>
            {scanResult && (
              <span className="settings-scan-result">{scanResult}</span>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
