import { errorJson } from "./json";
import { signDownloadToken } from "./session";

// Everything both the photo and video paths need to agree on: where bytes live
// in R2, which types we are willing to store and serve, and the cost bounds.

export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export function isAllowedVideoType(type: string | undefined | null): boolean {
  return typeof type === "string" && (VIDEO_MIME_TYPES as readonly string[]).includes(type);
}

// 2 GiB covers anything a phone shoots, including a few minutes of 4K. It is
// the R2 cost bound for video, the same role UPLOAD_DEADLINE plays for photos.
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

// Each part is relayed through the Worker, so it must stay under Cloudflare's
// request body limit (100 MB on Free and Pro plans). 32 MiB leaves generous
// headroom and puts a 2 GiB video at 64 parts, far below R2's 10,000-part cap.
// R2 also requires every part except the last to be exactly this size.
export const VIDEO_PART_SIZE = 32 * 1024 * 1024;
export const MAX_VIDEO_PARTS = Math.ceil(MAX_VIDEO_BYTES / VIDEO_PART_SIZE);

// One prefix per item, so deleting an item is "delete everything under `${id}/`"
// and no caller has to know which variants exist.
export const mediaPrefix = (id: string) => `${id}/`;
export const thumbKey = (id: string) => `${id}/thumb.jpg`;
export const fullKey = (id: string) => `${id}/full.jpg`;
export const videoKey = (id: string) => `${id}/video`;
// Not written today — uploads are downscaled in the browser before they leave
// the phone. The download path already looks here first, so switching originals
// on later is a change to the upload path alone.
export const origKey = (id: string) => `${id}/orig`;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType] ?? "bin";
}

// Guests download onto a phone that already holds a thousand IMG_4821.JPGs, so
// name the file after the wedding and the day it was shared. The id suffix
// keeps two photos from the same day from colliding in the Downloads folder.
export function downloadFilename(id: string, uploaded: Date, contentType: string): string {
  const day = uploaded.toISOString().slice(0, 10);
  return `javier-emily-${day}-${id.slice(0, 6)}.${extensionFor(contentType)}`;
}

export interface MediaRow {
  id: string;
  width: number;
  height: number;
  uploader_id: string;
  uploader_name: string | null;
  created_at: number;
  kind: string;
  duration_ms: number | null;
}

export interface MediaDTO {
  id: string;
  kind: "photo" | "video";
  width: number;
  height: number;
  durationMs: number | null;
  uploaderName: string | null;
  createdAt: number;
  canDelete: boolean;
  downloadToken: string;
}

export async function toMediaDTO(
  row: MediaRow,
  session: { uid: string; role: string },
  secret: string
): Promise<MediaDTO> {
  return {
    id: row.id,
    kind: row.kind === "video" ? "video" : "photo",
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    uploaderName: row.uploader_name,
    createdAt: row.created_at,
    canDelete: session.role === "admin" || row.uploader_id === session.uid,
    downloadToken: await signDownloadToken(row.id, secret),
  };
}

// Uploads (R2 writes) are rejected after UPLOAD_DEADLINE; viewing, commenting
// and deleting stay open. Returns the guest-facing reason, or null to proceed.
export function uploadsClosedReason(uploadDeadline: string): string | null {
  const deadline = Date.parse(uploadDeadline);
  if (!Number.isFinite(deadline)) {
    // Fail open so a config slip never blocks a guest mid-reception, but make
    // it loud: with no deadline there is no bound on R2 spend.
    console.warn(`UPLOAD_DEADLINE is not a parseable date (${uploadDeadline}); uploads are unbounded`);
    return null;
  }
  return Date.now() > deadline ? "Uploads are closed — thanks for sharing your photos!" : null;
}

// Deleting an item means deleting its whole prefix, so no caller needs a list of
// which variants a given item happens to have.
export async function deleteMedia(bucket: R2Bucket, id: string): Promise<void> {
  const listed = await bucket.list({ prefix: mediaPrefix(id) });
  if (listed.objects.length > 0) {
    await bucket.delete(listed.objects.map((object) => object.key));
  }
}

// The three multipart endpoints (part, complete, cancel) all start the same
// way, and all three have to answer the same question: is this session allowed
// to write into this particular in-flight upload?
//
// `allowAdmin` is off for part and complete: an admin has no reason to finish
// someone else's upload, and every extra writer is another way for two callers
// to race the same uploadId.
export async function authorizePendingVideo(
  db: D1Database,
  id: string,
  session: { uid: string; role: string },
  options: { allowAdmin?: boolean } = {}
): Promise<Response | null> {
  const row = await db
    .prepare(`SELECT uploader_id, kind, status FROM photos WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ uploader_id: string; kind: string; status: string }>();

  if (!row || row.kind !== "video") return errorJson("Upload not found", 404);
  if (row.status !== "pending") return errorJson("This upload has already finished", 409);
  if (row.uploader_id !== session.uid && !(options.allowAdmin && session.role === "admin")) {
    return errorJson("That isn't your upload", 403);
  }
  return null;
}

// Pages types a route param as `string | string[]`, because a [[catchall]] route
// can match several segments. Every route here has exactly one `[id]`, so
// collapse it once at the boundary instead of widening every helper downstream.
export function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? "") : value;
}
