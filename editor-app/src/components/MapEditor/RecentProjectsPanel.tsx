/**
 * Recent Projects panel — modal overlay listing the last 8 projects the
 * user has created / opened / saved-as. Each card lazy-loads a thumbnail
 * via the cheap `open_map_project_meta_only` Tauri command (skips the
 * multi-MB heightmap + splatmap sidecars) so the panel is fast even when
 * the recent list is full of large maps.
 *
 * Click a card → `openMapProjectByDir(dir)` → panel closes.
 *
 * Design choices:
 *   - Thumbnails fetch in parallel on mount, each updating its own card
 *     when it resolves. Failures fall back to a muted placeholder rather
 *     than removing the card; the user can still click to open and the
 *     load itself will surface any real I/O error.
 *   - Backdrop click closes; Esc closes; explicit ✕ button closes. All
 *     three behaviors live in this component (the parent only needs to
 *     pass an `onClose` callback).
 *   - Loud-over-silent: open failures get logged via console.warn and
 *     the panel stays open so the user sees their click had no effect
 *     and can pick a different entry.
 */

import { useCallback, useEffect, useState } from "react";

import {
  getRecentProjects,
  openMapProjectByDir,
  readProjectThumbnail,
  type RecentProject,
} from "../../map/io/projectIo";

interface RecentProjectsPanelProps {
  onClose: () => void;
}

interface CardState extends RecentProject {
  /** undefined = still loading, null = no thumbnail / error, string = data URL */
  thumbnail: string | null | undefined;
}

function formatLastOpened(ms: number): string {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "—";
    const now = Date.now();
    const deltaSec = Math.floor((now - ms) / 1000);
    if (deltaSec < 60) return "just now";
    if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
    if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
    if (deltaSec < 86400 * 7) return `${Math.floor(deltaSec / 86400)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}

export function RecentProjectsPanel({
  onClose,
}: RecentProjectsPanelProps): React.JSX.Element {
  const [cards, setCards] = useState<CardState[]>(() =>
    getRecentProjects().map((r) => ({ ...r, thumbnail: undefined })),
  );
  const [busyDir, setBusyDir] = useState<string | null>(null);

  // Lazy-load thumbnails in parallel. Each resolution updates only its
  // own slot so the grid renders progressively rather than blocking on
  // the slowest disk read.
  useEffect(() => {
    let cancelled = false;
    cards.forEach((card) => {
      if (card.thumbnail !== undefined) return;
      void readProjectThumbnail(card.dir).then((thumb) => {
        if (cancelled) return;
        setCards((prev) =>
          prev.map((c) => (c.dir === card.dir ? { ...c, thumbnail: thumb } : c)),
        );
      });
    });
    return () => {
      cancelled = true;
    };
    // We intentionally only run this once on mount. New cards added at
    // runtime (none in this flow) would need a deps update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc closes — register at window level so it fires regardless of
  // focus inside the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onOpen = useCallback(
    async (dir: string): Promise<void> => {
      if (busyDir) return;
      setBusyDir(dir);
      try {
        await openMapProjectByDir(dir);
        onClose();
      } catch (e) {
        console.warn("[RecentProjectsPanel] open failed:", dir, e);
      } finally {
        setBusyDir(null);
      }
    },
    [busyDir, onClose],
  );

  return (
    <div
      className="recent-projects-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="recent-projects-modal" role="dialog" aria-label="Recent projects">
        <div className="recent-projects-header">
          <h3>Recent projects</h3>
          <button
            type="button"
            className="recent-projects-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {cards.length === 0 ? (
          <div className="recent-projects-empty">
            No recent projects yet. Use <strong>New</strong> or{" "}
            <strong>Open…</strong> to get started.
          </div>
        ) : (
          <div className="recent-projects-grid">
            {cards.map((card) => (
              <button
                key={card.dir}
                type="button"
                className="recent-project-card"
                disabled={busyDir !== null}
                onClick={() => void onOpen(card.dir)}
                title={card.dir}
              >
                {card.thumbnail ? (
                  <img
                    className="recent-project-thumb"
                    src={card.thumbnail}
                    alt={card.name}
                  />
                ) : (
                  <div
                    className="recent-project-placeholder"
                    aria-hidden="true"
                  >
                    {card.thumbnail === undefined ? "…" : "—"}
                  </div>
                )}
                <div className="recent-project-name">{card.name}</div>
                <div className="recent-project-dir">{card.dir}</div>
                <div className="recent-project-when">
                  {formatLastOpened(card.lastOpenedAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
