"use client";

import { useEffect, useRef, useState } from "react";
import { processImage } from "@/lib/imageProcessing";
import { uploadVideo } from "@/lib/videoUpload";
import { uploadPhoto, ApiError, type PhotoDTO } from "@/lib/api";
import { getStoredName, setStoredName } from "@/lib/localName";

const CONCURRENCY = 2;

interface QueueItem {
  name: string;
  status: "pending" | "processing" | "uploading" | "done" | "error";
  // Videos are big enough that "uploading" on its own tells a guest nothing;
  // photos finish too fast for a bar to be worth drawing.
  progress?: number;
  error?: string;
}

export default function UploadButton({ onUploaded }: { onUploaded: (photo: PhotoDTO) => void }) {
  const [name, setName] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // The upload workers outlive the render that started them, so they must read
  // the name through a ref — a captured `name` would stay frozen at whatever
  // was typed when the file picker closed.
  const nameRef = useRef("");

  useEffect(() => {
    // Client-only read, deliberately after hydration — see PhotoViewer for why.
    const stored = getStoredName();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(stored);
    nameRef.current = stored;
  }, []);

  const uploading = queue.some(
    (item) => item.status === "pending" || item.status === "processing" || item.status === "uploading"
  );
  const doneCount = queue.filter((item) => item.status === "done" || item.status === "error").length;
  const failed = queue.filter((item) => item.status === "error");
  const active = queue.find((item) => item.status === "uploading" && item.progress !== undefined);

  function handleNameChange(value: string) {
    setName(value);
    nameRef.current = value;
  }

  function updateItem(index: number, patch: Partial<QueueItem>) {
    setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setQueue(fileArray.map((f) => ({ name: f.name, status: "pending" })));
    // Persist up front: a guest who backgrounds the app mid-upload should not
    // have to retype their name next time.
    if (nameRef.current.trim()) setStoredName(nameRef.current.trim());

    let nextIndex = 0;
    async function worker() {
      while (nextIndex < fileArray.length) {
        const i = nextIndex++;
        const file = fileArray[i];
        const isVideo = file.type.startsWith("video/") || /\.(mp4|m4v|mov|qt|webm)$/i.test(file.name);
        updateItem(i, { status: "processing" });
        try {
          if (isVideo) {
            // uploadVideo draws its own poster first, so there is no separate
            // processing step to report here.
            updateItem(i, { status: "uploading", progress: 0 });
            const photo = await uploadVideo(file, nameRef.current.trim(), (fraction) =>
              updateItem(i, { progress: fraction })
            );
            updateItem(i, { status: "done" });
            onUploaded(photo);
          } else {
            const image = await processImage(file);
            updateItem(i, { status: "uploading" });
            const { photo } = await uploadPhoto(image, nameRef.current.trim());
            updateItem(i, { status: "done" });
            onUploaded(photo);
          }
        } catch (err) {
          const message = err instanceof ApiError ? err.message : "This file isn't a photo we can read.";
          updateItem(i, { status: "error", error: message });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fileArray.length) }, worker));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2 border-b border-rule bg-ink-raised p-3">
      <input
        type="text"
        aria-label="Your name, shown with the photos you add"
        placeholder="Your name (optional)"
        value={name}
        onChange={(e) => handleNameChange(e.target.value)}
        disabled={uploading}
        className="px-3 py-2 text-base disabled:text-chalk-dim"
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full rounded-sm bg-foil px-4 py-4 text-xl font-semibold text-ink disabled:bg-foil-deep disabled:text-ink/60"
      >
        {uploading ? `Adding ${doneCount + 1} of ${queue.length}…` : "Add your photos & videos"}
      </button>

      {active && (
        <div
          role="progressbar"
          aria-label={`Uploading ${active.name}`}
          aria-valuenow={Math.round((active.progress ?? 0) * 100)}
          className="h-1 w-full overflow-hidden rounded-sm bg-ink-sunk"
        >
          <div
            className="h-full bg-foil transition-[width] duration-300"
            style={{ width: `${Math.round((active.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}

      {failed.length > 0 && !uploading && (
        <ul className="text-base text-alarm">
          {failed.map((item, i) => (
            <li key={i}>
              {item.name}: {item.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
