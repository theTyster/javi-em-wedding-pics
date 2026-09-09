export interface ProcessedImage {
  /** The bytes to store: the guest's file itself, unless it had to be converted. */
  original: Blob;
  thumb: Blob;
  width: number;
  height: number;
  /** True when the format forced a re-encode, so the caller can say so. */
  converted: boolean;
}

export interface ProcessedVideo {
  thumb: Blob;
  width: number;
  height: number;
  durationMs: number | null;
}

// Formats every current browser can display. A file already in one of these is
// stored exactly as the camera wrote it — no resize, no re-encode, EXIF and all.
const WEB_SAFE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

const THUMB_MAX_EDGE = 400;
const THUMB_QUALITY = 0.75;
// Only reached when a format has to be converted at all — an iPhone HEIC, most
// often. Full resolution, and high enough that the re-encode is not something
// you could pick out of a lineup next to the original.
const CONVERT_QUALITY = 0.95;

// A video that never fires `loadedmetadata` — an codec the browser can't open,
// a file the picker handed us in a format it can't decode — would otherwise
// leave the upload hanging with a spinner and no way out.
const POSTER_TIMEOUT_MS = 15000;

/**
 * Prepares a photo for upload without degrading it.
 *
 * The only thing every photo gets is a 400px thumbnail for the grid — a derived
 * extra, not a replacement. The photo itself is passed through untouched when
 * the browser can already display its format, which covers everything a phone
 * or a camera produces except HEIC. HEIC has to be re-encoded or half the
 * guests could not view it, so it becomes a full-resolution JPEG: same pixels,
 * same dimensions, only the container changes.
 *
 * The re-encode does cost the EXIF block (capture time, camera, GPS), because a
 * canvas only carries pixels. Untouched files keep theirs.
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const thumb = await drawAndEncode(bitmap, bitmap.width, bitmap.height, THUMB_MAX_EDGE, THUMB_QUALITY);

    if (WEB_SAFE_IMAGE_TYPES.has(file.type)) {
      return { original: file, thumb: thumb.blob, width: bitmap.width, height: bitmap.height, converted: false };
    }

    // `null` max edge means "do not scale" — the conversion is a format change
    // only, so the output keeps every pixel the original had.
    const converted = await drawAndEncode(bitmap, bitmap.width, bitmap.height, null, CONVERT_QUALITY);
    return {
      original: converted.blob,
      thumb: thumb.blob,
      width: bitmap.width,
      height: bitmap.height,
      converted: true,
    };
  } finally {
    bitmap.close();
  }
}

// Videos are stored exactly as the phone recorded them — there is no practical
// way to transcode a 2 GiB file in a browser tab — so the only thing to prepare
// is the poster frame the grid and the player show. It goes through the same
// encoder as a photo thumbnail, at the same size and quality, so a video tile
// and a photo tile are indistinguishable until you look for the play badge.
export async function processVideo(file: File): Promise<ProcessedVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    const ready = await seekToFirstFrame(video);
    if (!ready) return placeholderPoster();

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return placeholderPoster();

    const thumb = await drawAndEncode(video, width, height, THUMB_MAX_EDGE, THUMB_QUALITY);
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null;
    return { thumb: thumb.blob, width, height, durationMs };
  } catch {
    return placeholderPoster();
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

// Resolves false rather than throwing when the browser can't open the file:
// a clip we can't preview is still a clip worth keeping, so it uploads with a
// stand-in poster instead of failing.
function seekToFirstFrame(video: HTMLVideoElement): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), POSTER_TIMEOUT_MS);

    video.addEventListener("error", () => finish(false), { once: true });
    video.addEventListener("seeked", () => finish(true), { once: true });
    video.addEventListener(
      "loadeddata",
      () => {
        // A hair into the clip rather than 0: the very first frame of a phone
        // recording is often the black one from before the sensor settles.
        const target = Number.isFinite(video.duration) ? Math.min(0.1, video.duration / 2) : 0.1;
        if (video.currentTime === target) finish(true);
        else video.currentTime = target;
      },
      { once: true }
    );
  });
}

// Ink-coloured with a champagne play mark, matching the palette in globals.css,
// so an undecodable clip looks deliberate in the grid rather than broken.
async function placeholderPoster(): Promise<ProcessedVideo> {
  const width = 640;
  const height = 360;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported on this device");

  ctx.fillStyle = "#120d18";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#e0bd7f";
  ctx.beginPath();
  ctx.moveTo(width / 2 - 28, height / 2 - 34);
  ctx.lineTo(width / 2 + 38, height / 2);
  ctx.lineTo(width / 2 - 28, height / 2 + 34);
  ctx.closePath();
  ctx.fill();

  const blob = await canvasToBlob(canvas, THUMB_QUALITY);
  return { thumb: blob, width, height, durationMs: null };
}

async function drawAndEncode(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number | null,
  quality: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = maxEdge === null ? 1 : Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported on this device");
  ctx.drawImage(source, 0, 0, width, height);

  return { blob: await canvasToBlob(canvas, quality), width, height };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Could not process this photo"))),
      "image/jpeg",
      quality
    );
  });
}
