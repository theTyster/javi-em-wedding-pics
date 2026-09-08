"use client";

import type { PhotoDTO } from "@/lib/api";
import { photoUrl } from "@/lib/api";
import { formatDuration, mediaAlt } from "@/lib/media";

export default function PhotoGrid({
  photos,
  onSelect,
}: {
  photos: PhotoDTO[];
  onSelect: (id: string) => void;
}) {
  if (photos.length === 0) {
    return (
      <p className="px-8 py-20 text-center text-lg leading-relaxed text-chalk-dim">
        Nothing here yet. Add the first photo with the button above.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 md:grid-cols-4">
      {photos.map((photo) => (
        <button
          key={photo.id}
          type="button"
          onClick={() => onSelect(photo.id)}
          // Square cells keep the newest-first reading order intact and give
          // every photo the same weight on the wall; the viewer shows the
          // uncropped frame, which is where composition actually matters.
          className="relative aspect-square overflow-hidden bg-ink-sunk"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl(photo.id, "thumb")}
            alt={mediaAlt(photo)}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
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
        </button>
      ))}
    </div>
  );
}
