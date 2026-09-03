"use client";

import type { PhotoDTO } from "@/lib/api";
import { photoUrl } from "@/lib/api";

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
          className="aspect-square overflow-hidden bg-ink-sunk"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl(photo.id, "thumb")}
            alt={photo.uploaderName ? `Photo from ${photo.uploaderName}` : "Wedding photo"}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}
