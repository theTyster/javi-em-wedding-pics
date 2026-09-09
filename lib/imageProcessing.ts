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

// Budgeted per phase rather than one deadline for the whole capture: opening a
// 57 MB clip off a phone's storage is the slow part, and spending the same
// budget on it as on the seek is what cut real captures short before. A file
// the browser genuinely cannot open still has to give up rather than leave the
// upload hanging with a spinner and no way out.
const METADATA_TIMEOUT_MS = 30000;
const SEEK_TIMEOUT_MS = 8000;
const FRAME_TIMEOUT_MS = 4000;

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

// Only one video is decoded at a time. iOS limits how many video pipelines can
// run at once, and uploads run two files in parallel — which is exactly the
// shape of the failures we saw in production, every one of them arriving in a
// same-second pair. This queue is deliberately around the decode only, so two
// videos still push their bytes to R2 in parallel.
let posterQueue: Promise<unknown> = Promise.resolve();

function serializeDecode<T>(work: () => Promise<T>): Promise<T> {
  const run = posterQueue.then(work, work);
  posterQueue = run.catch(() => undefined);
  return run;
}

// Videos are stored exactly as the phone recorded them — there is no practical
// way to transcode a 2 GiB file in a browser tab — so the only thing to prepare
// is the poster frame the grid and the player show. It goes through the same
// encoder as a photo thumbnail, at the same size and quality, so a video tile
// and a photo tile are indistinguishable until you look for the play badge.
export async function processVideo(file: File): Promise<ProcessedVideo> {
  return serializeDecode(() => capturePoster(file));
}

async function capturePoster(file: File): Promise<ProcessedVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");

  // iOS decides whether it may autoplay by reading the *attributes*, not just
  // the properties, and it makes that decision as the source loads — so both
  // have to be set before `src`.
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("autoplay", "");
  video.preload = "auto";

  // iOS will not decode a <video> that is outside the document, and it counts
  // `display:none` as outside. Rendered, one pixel, off the edge of the screen.
  video.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(video);

  try {
    const opened = await openVideo(video, url);
    // Nothing at all could be read from the file — no dimensions, no duration.
    if (!opened) return placeholderPoster(null, null, null);

    const width = video.videoWidth;
    const height = video.videoHeight;
    const durationMs = Number.isFinite(video.duration) && video.duration > 0
      ? Math.round(video.duration * 1000)
      : null;
    if (!width || !height) return placeholderPoster(null, null, durationMs);

    // Metadata is in hand from here on, so even if the frame grab fails the row
    // still gets the clip's real shape and runtime rather than a wrong default.
    try {
      await seekToPosterFrame(video);
      const thumb = await drawAndEncode(video, width, height, THUMB_MAX_EDGE, THUMB_QUALITY);
      return { thumb: thumb.blob, width, height, durationMs };
    } catch {
      return placeholderPoster(width, height, durationMs);
    }
  } catch {
    return placeholderPoster(null, null, null);
  } finally {
    try {
      video.pause();
    } catch {
      // Already torn down; nothing to stop.
    }
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

// Gets the file open far enough to read its dimensions and duration. The
// `play()` is the load-bearing part on a phone: iOS ignores `preload` and will
// not fetch frame data until something plays, so without it `loadedmetadata`
// simply never fires and the capture times out. Muted and inline is the one
// form of autoplay iOS allows with no user gesture behind it.
async function openVideo(video: HTMLVideoElement, url: string): Promise<boolean> {
  const failed = eventOnce(video, "error").then(() => false);
  const ready = eventOnce(video, "loadedmetadata").then(() => true);

  video.src = url;
  video.load();
  const playing = video.play().catch(() => undefined);

  const opened = await Promise.race([ready, failed, delay(METADATA_TIMEOUT_MS).then(() => false)]);
  await playing;
  try {
    video.pause();
  } catch {
    // A play() that never started has nothing to pause.
  }
  return opened;
}

async function seekToPosterFrame(video: HTMLVideoElement): Promise<void> {
  // A hair into the clip rather than 0: the very first frame of a phone
  // recording is often the black one from before the sensor settles. Very short
  // clips stay at 0 rather than seeking past the end.
  const target = Number.isFinite(video.duration) && video.duration > 0.3 ? 0.1 : 0;

  if (target > 0 && Math.abs(video.currentTime - target) > 0.01) {
    const seeked = eventOnce(video, "seeked");
    video.currentTime = target;
    await Promise.race([seeked, delay(SEEK_TIMEOUT_MS)]);
  }
  await nextDecodedFrame(video);
}

// `seeked` means the playback position moved, not that a frame is on screen —
// drawing straight after it is how you end up with a blank canvas. When the
// browser offers requestVideoFrameCallback it will say precisely when a frame
// has been composited; otherwise a couple of animation frames is the best
// available approximation.
function nextDecodedFrame(video: HTMLVideoElement): Promise<void> {
  const withCallback = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };

  if (typeof withCallback.requestVideoFrameCallback === "function") {
    return Promise.race([
      new Promise<void>((resolve) => withCallback.requestVideoFrameCallback!(() => resolve())),
      delay(FRAME_TIMEOUT_MS),
    ]);
  }

  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function eventOnce(target: EventTarget, event: string): Promise<Event> {
  return new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ink-coloured with a champagne play mark, matching the palette in globals.css,
// so an undecodable clip looks deliberate in the grid rather than broken.
//
// Takes the clip's real shape and runtime when they are known. Reporting a
// fixed 640x360 for everything is what filed a library of portrait phone videos
// as landscape and left every duration badge blank — the poster being a
// stand-in is no reason for the row to be wrong too.
async function placeholderPoster(
  videoWidth: number | null,
  videoHeight: number | null,
  durationMs: number | null
): Promise<ProcessedVideo> {
  // The dimensions reported back describe the clip; the canvas is drawn at
  // thumbnail scale like every other poster, keeping the clip's aspect ratio so
  // the tile is not letterboxed differently from a real frame.
  const width = videoWidth ?? 640;
  const height = videoHeight ?? 360;
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
  const canvasWidth = Math.max(1, Math.round(width * scale));
  const canvasHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported on this device");

  ctx.fillStyle = "#120d18";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Sized off the canvas rather than in fixed pixels, so the mark reads the
  // same on a square tile as on a tall one.
  const mark = Math.max(12, Math.min(canvasWidth, canvasHeight) * 0.18);
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  ctx.fillStyle = "#e0bd7f";
  ctx.beginPath();
  ctx.moveTo(cx - mark * 0.6, cy - mark);
  ctx.lineTo(cx + mark, cy);
  ctx.lineTo(cx - mark * 0.6, cy + mark);
  ctx.closePath();
  ctx.fill();

  const blob = await canvasToBlob(canvas, THUMB_QUALITY);
  return { thumb: blob, width, height, durationMs };
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
