import type { Env } from "../../_lib/env";
import { getSession } from "../../_lib/session";
import { json, errorJson } from "../../_lib/json";
import {
  MAX_VIDEO_BYTES,
  VIDEO_PART_SIZE,
  isAllowedVideoType,
  uploadsClosedReason,
  videoKey,
} from "../../_lib/media";

// Videos cannot go through /api/photos: that endpoint buffers the whole body
// with formData(), and Cloudflare caps a request body at 100 MB on Free and Pro
// plans — under a minute of phone 1080p. Instead the browser slices the file and
// this endpoint opens an R2 multipart upload that the parts stream into.
//
// The upload is relayed through the Worker rather than presigned straight to R2
// so it stays behind the session cookie and the geoblock, with no R2 access keys
// to hold as secrets and no bucket CORS policy to keep in sync.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, data }) => {
  const session = getSession(data);

  const closed = uploadsClosedReason(env.UPLOAD_DEADLINE);
  if (closed) return errorJson(closed, 403);

  let body: {
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number | null;
    mimeType?: string;
    uploaderName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request", 400);
  }

  if (!isAllowedVideoType(body.mimeType)) {
    return errorJson("That video format isn't supported.", 400);
  }

  const bytes = Math.round(Number(body.bytes));
  if (!Number.isFinite(bytes) || bytes <= 0) return errorJson("Missing video size", 400);
  if (bytes > MAX_VIDEO_BYTES) return errorJson("That video is too large to share.", 413);

  const width = Math.round(Number(body.width));
  const height = Math.round(Number(body.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return errorJson("Missing video dimensions", 400);
  }

  const durationRaw = Number(body.durationMs);
  const durationMs = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null;

  const uploaderName =
    typeof body.uploaderName === "string" && body.uploaderName.trim()
      ? body.uploaderName.trim().slice(0, 80)
      : null;

  const id = crypto.randomUUID();
  const upload = await env.PHOTOS.createMultipartUpload(videoKey(id), {
    // Recorded here so serving a video needs no database read on every range
    // request. It is still re-checked against the allowlist on the way out.
    httpMetadata: { contentType: body.mimeType as string },
  });

  try {
    // `bytes` stays 0 until the upload completes and R2 tells us the real size;
    // `status = 'pending'` keeps the row out of the feed until then.
    await env.DB.prepare(
      `INSERT INTO photos (id, bytes, width, height, uploader_id, uploader_name, created_at,
                           kind, status, mime_type, duration_ms)
       VALUES (?, 0, ?, ?, ?, ?, ?, 'video', 'pending', ?, ?)`
    )
      .bind(id, width, height, session.uid, uploaderName, Date.now(), body.mimeType, durationMs)
      .run();
  } catch {
    await upload.abort().catch(() => {});
    return errorJson("Upload failed, please try again", 502);
  }

  return json({ id, uploadId: upload.uploadId, partSize: VIDEO_PART_SIZE });
};
