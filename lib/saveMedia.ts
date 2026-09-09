import { downloadUrl, type PhotoDTO } from "./api";

// Saving several items at once, without a second download path.
//
// Every route below fetches exactly the URL the viewer's Save button uses —
// `downloadUrl`, the `v=download` variant with its signed token — so a batch
// save gets the same bytes, the same server-chosen filename and the same
// credential as saving one photo by hand. What differs is only where the file
// ends up:
//
//   * Share sheet (iOS, Android). `navigator.share({ files })` hands the files
//     to the OS, where "Save N Images" writes them into the camera roll. This
//     is the only route from a web page into the iOS Photos app, and it is the
//     reason this feature exists — a folder of downloads is not where a guest
//     wants their wedding photos.
//   * Links (desktop Chrome, Firefox — no file sharing). The same per-item
//     download the app has always had, fired once per selected item.
//
// The share sheet needs real File objects, which means holding the whole
// selection in memory at once. That is what the budget below bounds.

// Not a limit on how much a guest may save — there isn't one. It is how much
// goes into a single share sheet, and it exists because the share sheet needs
// every file resident in memory at once: buffer a whole album and the phone
// kills the tab. A selection larger than this saves in successive rounds, and
// the overflow comes back as `skipped` so the caller can offer the rest.
export const MAX_BATCH_BYTES = 250 * 1024 * 1024;

// Fetch two at a time, the same shape as the upload queue's worker loop: enough
// to keep a phone's connection busy, few enough that a slow item can't stall
// the whole batch behind it.
const CONCURRENCY = 2;

// Long enough that a browser treats each click as its own download rather than
// as a burst to be blocked.
const LINK_INTERVAL_MS = 800;

let shareSupport: boolean | null = null;

// Feature detection has to use a real File: `navigator.share` exists on plenty
// of browsers that cannot share files at all, and `canShare` is the only thing
// that distinguishes them. Some throw instead of returning false, hence the
// try. Note this is false on plain HTTP — the Web Share API needs a secure
// context — which is exactly what `wrangler pages dev` serves over a LAN.
export function canShareFiles(): boolean {
  if (shareSupport !== null) return shareSupport;
  try {
    const probe = new File([new Uint8Array(1)], "probe.jpg", { type: "image/jpeg" });
    shareSupport = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [probe] });
  } catch {
    shareSupport = false;
  }
  return shareSupport;
}

export interface SavePlan {
  /** What fits in memory and will go to this round's share sheet. */
  batch: PhotoDTO[];
  /** The rest, for the next round. */
  skipped: PhotoDTO[];
}

// Greedy, in selection order, so each round takes the front of what the guest
// picked rather than an arbitrary subset. A single item larger than the whole
// budget — a long video — can never join a batch and always lands in `skipped`.
export function planShare(photos: PhotoDTO[]): SavePlan {
  const batch: PhotoDTO[] = [];
  const skipped: PhotoDTO[] = [];
  let total = 0;

  for (const photo of photos) {
    const bytes = photo.bytes || 0;
    if (total + bytes <= MAX_BATCH_BYTES) {
      batch.push(photo);
      total += bytes;
    } else {
      skipped.push(photo);
    }
  }

  return { batch, skipped };
}

// The server already decided what this file is called; parsing its header back
// out keeps one naming convention (downloadFilename in functions/_lib/media.ts)
// instead of a second, drifting copy of it here.
function filenameFrom(header: string | null, fallbackId: string): string {
  const quoted = /filename="([^"]+)"/.exec(header ?? "");
  if (quoted) return quoted[1];
  const bare = /filename=([^;]+)/.exec(header ?? "");
  if (bare) return bare[1].trim();
  return `javier-emily-${fallbackId.slice(0, 6)}`;
}

export interface FetchOutcome {
  files: File[];
  /** Items whose fetch failed. Reported, not thrown: 7 of 8 beats 0 of 8. */
  failed: PhotoDTO[];
}

export async function fetchFiles(
  photos: PhotoDTO[],
  options: { onProgress?: (done: number) => void; signal?: AbortSignal } = {}
): Promise<FetchOutcome> {
  // Indexed rather than pushed, so the files keep the order they were picked in
  // however the two workers happen to interleave.
  const files: (File | null)[] = new Array(photos.length).fill(null);
  const failed: PhotoDTO[] = [];
  let done = 0;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < photos.length) {
      const i = nextIndex++;
      const photo = photos[i];
      try {
        const res = await fetch(downloadUrl(photo.id, photo.downloadToken), { signal: options.signal });
        if (!res.ok) throw new Error(String(res.status));
        const name = filenameFrom(res.headers.get("content-disposition"), photo.id);
        const blob = await res.blob();
        // A File needs a truthy, specific type or the OS share sheet won't
        // recognise it as an image and offer "Save to Photos". The response's
        // own type is the authority; the stored one is the fallback for the
        // formats the file endpoint serves as opaque bytes.
        const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : photo.mimeType ?? "";
        files[i] = new File([blob], name, { type });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        failed.push(photo);
      }
      options.onProgress?.(++done);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, photos.length) }, worker));

  return { files: files.filter((f): f is File => f !== null), failed };
}

export type ShareOutcome = "shared" | "cancelled" | "unsupported";

// Files only — no title or text. Adding either pushes iOS to offer the sheet as
// "send a message with an attachment", which buries the Save to Photos action
// this whole path exists for.
//
// Must be called from a fresh tap: iOS Safari rejects share() that arrives too
// long after the gesture that started it, which is why fetching and sharing are
// two separate presses in the UI rather than one.
export async function shareFiles(files: File[]): Promise<ShareOutcome> {
  if (files.length === 0) return "unsupported";
  try {
    if (!navigator.canShare?.({ files })) return "unsupported";
    await navigator.share({ files });
    return "shared";
  } catch (err) {
    // Dismissing the sheet is a decision, not a failure.
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError")) {
      return "cancelled";
    }
    throw err;
  }
}

// The fallback, and also how a skipped oversize item is offered. Nothing is
// buffered: each link streams straight to disk exactly as the viewer's Save
// button does, which is the only way a 2 GiB video is saveable at all.
export async function saveViaLinks(photos: PhotoDTO[], signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < photos.length; i++) {
    if (signal?.aborted) return;
    const photo = photos[i];
    const link = document.createElement("a");
    link.href = downloadUrl(photo.id, photo.downloadToken);
    link.download = "";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (i < photos.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, LINK_INTERVAL_MS));
    }
  }
}
