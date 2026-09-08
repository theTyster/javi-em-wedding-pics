import {
  ApiError,
  cancelVideoUpload,
  completeVideoUpload,
  createVideoUpload,
  type PhotoDTO,
  type UploadedPart,
} from "./api";
import { processVideo } from "./imageProcessing";

const PART_CONCURRENCY = 2;
const PART_ATTEMPTS = 3;

// Some Android pickers hand back a File with an empty `type`. The extension is
// the only other thing we know, and guessing wrong is harmless — the server
// checks the type against its own allowlist either way.
const EXTENSION_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
};

export function videoMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "";
}

/**
 * Uploads one video as an R2 multipart upload relayed through the Worker.
 *
 * A single request can't carry it: Cloudflare caps a request body at 100 MB,
 * which is well under a minute of phone 1080p. Slicing has a second payoff on
 * the kind of network a wedding venue has — a part that fails is 32 MiB to
 * redo, not the whole file.
 */
export async function uploadVideo(
  file: File,
  uploaderName: string,
  onProgress: (fraction: number) => void
): Promise<PhotoDTO> {
  const mimeType = videoMimeType(file);
  if (!mimeType) throw new ApiError("We can't tell what kind of video this is.", 400);

  // The poster is drawn before anything is sent, so a clip we can't read at all
  // fails in a second rather than after uploading a gigabyte.
  const poster = await processVideo(file);

  const { id, uploadId, partSize } = await createVideoUpload({
    bytes: file.size,
    width: poster.width,
    height: poster.height,
    durationMs: poster.durationMs,
    mimeType,
    uploaderName,
  });

  try {
    const parts = await uploadParts(file, id, uploadId, partSize, onProgress);
    const { photo } = await completeVideoUpload(id, uploadId, parts, poster.thumb);
    onProgress(1);
    return photo;
  } catch (err) {
    // Best effort: R2 expires abandoned multipart uploads after seven days on
    // its own, so a failed cleanup costs storage rather than correctness.
    await cancelVideoUpload(id, uploadId).catch(() => {});
    throw err;
  }
}

async function uploadParts(
  file: File,
  id: string,
  uploadId: string,
  partSize: number,
  onProgress: (fraction: number) => void
): Promise<UploadedPart[]> {
  const partCount = Math.max(1, Math.ceil(file.size / partSize));
  const parts = new Array<UploadedPart>(partCount);
  // Bytes confirmed sent per part, so a part that fails and retries rewinds its
  // own contribution instead of letting the bar run past 100%.
  const sent = new Array<number>(partCount).fill(0);

  const report = () => {
    const total = sent.reduce((a, b) => a + b, 0);
    onProgress(file.size ? Math.min(1, total / file.size) : 1);
  };

  let next = 0;
  async function worker() {
    while (next < partCount) {
      const index = next++;
      const blob = file.slice(index * partSize, Math.min((index + 1) * partSize, file.size));
      parts[index] = await putPartWithRetry(id, uploadId, index + 1, blob, (bytes) => {
        sent[index] = bytes;
        report();
      });
      sent[index] = blob.size;
      report();
    }
  }

  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker));
  return parts;
}

async function putPartWithRetry(
  id: string,
  uploadId: string,
  partNumber: number,
  blob: Blob,
  onBytes: (bytes: number) => void
): Promise<UploadedPart> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PART_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      return await putPart(id, uploadId, partNumber, blob, onBytes);
    } catch (err) {
      // A 4xx means this part will never be accepted (the upload was cancelled,
      // the session expired); only retry the failures that might be transient.
      if (err instanceof ApiError && err.status < 500) throw err;
      lastError = err;
      onBytes(0);
    }
  }
  throw lastError instanceof Error ? lastError : new ApiError("That video didn't finish uploading.", 502);
}

// XMLHttpRequest rather than fetch: it is still the only way to watch bytes
// leave the browser, and a progress bar that sits at zero for four minutes of a
// 2 GiB upload reads as a hang.
function putPart(
  id: string,
  uploadId: string,
  partNumber: number,
  blob: Blob,
  onBytes: (bytes: number) => void
): Promise<UploadedPart> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/videos/${id}/parts/${partNumber}?uploadId=${encodeURIComponent(uploadId)}`);
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onerror = () => reject(new ApiError("The connection dropped mid-upload.", 502));
    xhr.ontimeout = () => reject(new ApiError("The connection dropped mid-upload.", 502));
    xhr.onload = () => {
      const body = xhr.response as { partNumber?: number; etag?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.etag) {
        resolve({ partNumber: body.partNumber ?? partNumber, etag: body.etag });
      } else {
        reject(new ApiError(body?.error ?? "That part didn't upload.", xhr.status || 502));
      }
    };

    xhr.send(blob);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
