"use client";

import { useEffect, useRef, useState } from "react";
import type { PhotoDTO } from "@/lib/api";
import { canShareFiles, fetchFiles, planShare, saveViaLinks, shareFiles } from "@/lib/saveMedia";

// "Preparing" is the fetch; "ready" waits for a second, fresh tap because iOS
// Safari will not open a share sheet on a gesture that has gone stale — see
// shareFiles in lib/saveMedia.ts.
type Phase = "idle" | "preparing" | "ready" | "saving";

export default function SelectionBar({
  selected,
  onCancel,
  onSaved,
}: {
  selected: PhotoDTO[];
  onCancel: () => void;
  /** Drops the saved items from the selection; emptying it closes the bar. */
  onSaved: (ids: string[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const readyRef = useRef<{ files: File[]; ids: string[] }>({ files: [], ids: [] });
  const abortRef = useRef<AbortController | null>(null);

  const count = selected.length;
  const busy = phase === "preparing" || phase === "saving";
  // The parent rebuilds `selected` on every render, so the ids are what
  // actually says whether the selection changed.
  const selectionKey = selected.map((photo) => photo.id).join(",");

  // Files fetched for one selection must never be handed to the share sheet
  // after the guest has changed that selection.
  useEffect(() => {
    readyRef.current = { files: [], ids: [] };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("idle");
  }, [selectionKey]);

  useEffect(() => {
    // Deliberately read at cleanup time, not at mount: the point is to abort
    // whichever fetch is in flight when the bar goes away.
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel, busy]);

  async function handleSave() {
    if (busy || count === 0) return;
    setMessage(null);
    const controller = new AbortController();
    abortRef.current = controller;

    // No file sharing here (desktop, or plain HTTP, where the Web Share API is
    // unavailable): go straight to the per-item downloads, which stream to disk
    // and so have no budget to respect at all.
    if (!canShareFiles()) {
      setPhase("saving");
      await saveViaLinks(selected, controller.signal);
      abortRef.current = null;
      if (!controller.signal.aborted) onSaved(selected.map((photo) => photo.id));
      return;
    }

    const { batch } = planShare(selected);

    // Nothing fits, which means the item at the head of the selection is bigger
    // on its own than a whole batch — a long video. It can never be held in
    // memory, so it takes the streaming download instead and leaves the queue.
    if (batch.length === 0) {
      const solo = selected[0];
      setPhase("saving");
      await saveViaLinks([solo], controller.signal);
      abortRef.current = null;
      if (controller.signal.aborted) return;
      setMessage("That one was too large to save with the others, so it downloaded on its own.");
      onSaved([solo.id]);
      return;
    }

    setPhase("preparing");
    setProgress({ done: 0, total: batch.length });
    try {
      const { files, failed } = await fetchFiles(batch, {
        onProgress: (done) => setProgress({ done, total: batch.length }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (files.length === 0) {
        setPhase("idle");
        setMessage("Nothing loaded. Please try again.");
        return;
      }
      // Only what actually arrived is offered to the share sheet, and only
      // those ids leave the selection — anything that failed stays ticked, so
      // tapping Save again retries exactly those.
      const failedIds = new Set(failed.map((photo) => photo.id));
      readyRef.current = { files, ids: batch.filter((p) => !failedIds.has(p.id)).map((p) => p.id) };
      if (failed.length > 0) setMessage(`${failed.length} didn't load.`);
      setPhase("ready");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPhase("idle");
      setMessage("Nothing loaded. Please try again.");
    } finally {
      abortRef.current = null;
    }
  }

  async function handleShare() {
    if (phase !== "ready") return;
    const { files, ids } = readyRef.current;
    setPhase("saving");
    try {
      const outcome = await shareFiles(files);
      if (outcome === "cancelled") {
        // The files are still in hand, so offer the sheet again rather than
        // making the guest download everything a second time.
        setPhase("ready");
        return;
      }
      if (outcome === "unsupported") await saveViaLinks(selected.filter((p) => ids.includes(p.id)));
      const rest = count - ids.length;
      // A selection too big for one batch is not an error, it is a queue: the
      // saved items drop out and the bar comes back offering the remainder.
      setMessage(rest > 0 ? `${ids.length} saved. ${rest} to go — tap Save again.` : null);
      onSaved(ids);
    } catch {
      setPhase("ready");
      setMessage("That didn't save. Please try again.");
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    onCancel();
  }

  const status =
    phase === "preparing"
      ? `Preparing ${progress.done} of ${progress.total}…`
      : phase === "ready"
        ? "Ready"
        : count === 0
          ? "Nothing selected"
          : `${count} selected`;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-ink-raised pb-[env(safe-area-inset-bottom)]">
      {message && (
        <p role="status" className="border-b border-rule px-4 py-2 text-base leading-relaxed text-chalk-dim">
          {message}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={handleCancel}
          className="text-base text-chalk-dim underline underline-offset-4"
        >
          Cancel
        </button>

        <p aria-live="polite" className="flex-1 truncate text-center text-base text-chalk-dim">
          {status}
        </p>

        {phase === "ready" ? (
          <button
            type="button"
            onClick={handleShare}
            className="whitespace-nowrap rounded-sm bg-foil px-5 py-3 text-base font-semibold text-ink"
          >
            Save to Photos
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || count === 0}
            className="whitespace-nowrap rounded-sm bg-foil px-5 py-3 text-base font-semibold text-ink disabled:bg-foil-deep disabled:text-ink/60"
          >
            {phase === "saving" ? "Saving…" : count > 0 ? `Save ${count}` : "Save"}
          </button>
        )}
      </div>
    </div>
  );
}
