"use client";

import { useRef } from "react";
import type { PhotoDTO } from "@/lib/api";
import { photoUrl } from "@/lib/api";
import { formatDuration, mediaAlt } from "@/lib/media";

// How long a press has to be held before it means "start selecting" rather than
// "open this". Long enough not to fire on a tap, short enough to feel deliberate.
const LONG_PRESS_MS = 500;
// A press that drifts further than this is a scroll, not a hold.
const LONG_PRESS_SLOP_PX = 10;

export default function PhotoGrid({
  photos,
  onSelect,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onEnterSelection,
}: {
  photos: PhotoDTO[];
  onSelect: (id: string) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEnterSelection: (id: string) => void;
}) {
  // A long press has already acted by the time the finger lifts, so the click
  // that follows it must not also fire — otherwise the held tile is selected
  // and then immediately toggled back off.
  const longPressFired = useRef(false);
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  function cancelPress() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  }

  function handlePointerDown(e: React.PointerEvent, id: string) {
    longPressFired.current = false;
    // In selection mode every tap already toggles, so there is nothing for a
    // hold to add.
    if (selectionMode) return;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      pressTimer.current = null;
      onEnterSelection(id);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const origin = pressOrigin.current;
    if (!origin) return;
    if (
      Math.abs(e.clientX - origin.x) > LONG_PRESS_SLOP_PX ||
      Math.abs(e.clientY - origin.y) > LONG_PRESS_SLOP_PX
    ) {
      cancelPress();
    }
  }

  function handleClick(id: string) {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selectionMode) onToggleSelect(id);
    else onSelect(id);
  }

  if (photos.length === 0) {
    return (
      <p className="px-8 py-20 text-center text-lg leading-relaxed text-chalk-dim">
        Nothing here yet. Add the first photo with the button above.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 md:grid-cols-4">
      {photos.map((photo) => {
        const selected = selectedIds.has(photo.id);
        return (
          <button
            key={photo.id}
            type="button"
            onClick={() => handleClick(photo.id)}
            onPointerDown={(e) => handlePointerDown(e, photo.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onPointerLeave={cancelPress}
            // A hold is this app's "start selecting"; without these the platform
            // answers it first with its own image menu or a text selection.
            onContextMenu={(e) => e.preventDefault()}
            aria-pressed={selectionMode ? selected : undefined}
            // Square cells keep the newest-first reading order intact and give
            // every photo the same weight on the wall; the viewer shows the
            // uncropped frame, which is where composition actually matters.
            className="relative aspect-square touch-manipulation overflow-hidden bg-ink-sunk select-none [-webkit-touch-callout:none]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl(photo.id, "thumb")}
              alt={mediaAlt(photo)}
              loading="lazy"
              decoding="async"
              // Selected tiles pull back from their cell — the same gesture the
              // phone's own photo picker uses, and it reads at arm's length
              // where a coloured border alone does not.
              className={`h-full w-full object-cover transition-transform duration-150 ${
                selected ? "scale-90" : ""
              }`}
            />
            {photo.kind === "video" && (
              // A video tile is a still frame like any other, so it needs a mark
              // that says "this moves" before the guest taps it — and the runtime,
              // so nobody starts a four-minute clip expecting a snapshot.
              <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded-sm bg-ink/70 px-1.5 py-0.5 text-sm text-chalk">
                <span aria-hidden="true">▶</span>
                {photo.durationMs ? (
                  formatDuration(photo.durationMs)
                ) : (
                  <span className="sr-only">Video</span>
                )}
              </span>
            )}
            {selectionMode && (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full border text-base ${
                  selected
                    ? "border-foil bg-foil font-semibold text-ink"
                    : "border-chalk bg-ink/70 text-transparent"
                }`}
              >
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
