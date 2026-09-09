import type { Env } from "../../../_lib/env";
import { getSession } from "../../../_lib/session";
import { json, errorJson } from "../../../_lib/json";
import {
  MAX_VIDEO_BYTES,
  authorizePendingVideo,
  deleteMedia,
  routeParam,
  thumbKey,
  toMediaDTO,
  videoKey,
  type MediaRow,
} from "../../../_lib/media";

const MAX_THUMB_BYTES = 1 * 1024 * 1024;

// Seals the multipart upload and makes the video visible. The poster frame rides
// along in the same request — it is a small JPEG the browser grabbed off the
// first frame, and sending it here means a video is never briefly in the feed
// without a thumbnail to show for it.
export const onRequestPost: PagesFunction<Env, "id"> = async ({ params, request, env, data }) => {
  const session = getSession(data);
  const id = routeParam(params.id);

  const denied = await authorizePendingVideo(env.DB, id, session);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorJson("Invalid request", 400);
  }

  const uploadId = form.get("uploadId");
  const partsRaw = form.get("parts");
  const thumb = form.get("thumb");

  if (typeof uploadId !== "string" || !uploadId) return errorJson("Missing upload id", 400);
  if (!(thumb instanceof File) || !thumb.type.startsWith("image/")) {
    return errorJson("Missing video thumbnail", 400);
  }
  if (thumb.size > MAX_THUMB_BYTES) return errorJson("Video thumbnail is too large", 400);

  let parts: R2UploadedPart[];
  try {
    parts = JSON.parse(String(partsRaw));
  } catch {
    return errorJson("Invalid part list", 400);
  }
  const partsValid =
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every((part) => Number.isInteger(part?.partNumber) && typeof part?.etag === "string");
  if (!partsValid) return errorJson("Invalid part list", 400);

  let object: R2Object;
  try {
    const upload = env.PHOTOS.resumeMultipartUpload(videoKey(id), uploadId);
    object = await upload.complete(parts);
  } catch {
    return errorJson("Upload failed, please try again", 502);
  }

  // The size declared before the upload started was a claim; this is the number
  // R2 actually wrote, and it is the one the cap has to be enforced against.
  if (object.size > MAX_VIDEO_BYTES) {
    await deleteMedia(env.PHOTOS, id).catch(() => {});
    await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(id).run();
    return errorJson("That video is too large to share.", 413);
  }

  const thumbBuf = await thumb.arrayBuffer();
  try {
    await env.PHOTOS.put(thumbKey(id), thumbBuf, { httpMetadata: { contentType: "image/jpeg" } });
  } catch {
    await deleteMedia(env.PHOTOS, id).catch(() => {});
    await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(id).run();
    return errorJson("Upload failed, please try again", 502);
  }

  const bytes = object.size + thumbBuf.byteLength;
  const row = await env.DB.prepare(
    `UPDATE photos SET bytes = ?, status = 'ready' WHERE id = ?
     RETURNING id, bytes, width, height, uploader_id, uploader_name, created_at, kind, mime_type, duration_ms`
  )
    .bind(bytes, id)
    .first<MediaRow>();

  if (!row) {
    await deleteMedia(env.PHOTOS, id).catch(() => {});
    return errorJson("Upload failed, please try again", 502);
  }

  return json({ photo: await toMediaDTO(row, session, env.SESSION_SECRET) });
};
