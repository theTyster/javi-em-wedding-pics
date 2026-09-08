import type { Env } from "../../_lib/env";
import { getSession } from "../../_lib/session";
import { json, errorJson } from "../../_lib/json";
import { deleteMedia, fullKey, thumbKey, toMediaDTO, uploadsClosedReason, type MediaRow } from "../../_lib/media";

const MAX_LIMIT = 60;
const DEFAULT_LIMIT = 30;
const MAX_FULL_BYTES = 8 * 1024 * 1024;
const MAX_THUMB_BYTES = 1 * 1024 * 1024;
// Reject oversized bodies from the header, before `formData()` buffers the
// whole thing into the worker's 128 MB of memory. Generous slack over
// full + thumb for multipart framing and the other fields.
const MAX_BODY_BYTES = MAX_FULL_BYTES + MAX_THUMB_BYTES + 1024 * 1024;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, data }) => {
  const session = getSession(data);
  const url = new URL(request.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT));
  const cursorParam = url.searchParams.get("cursor");

  // `status` keeps videos out of the feed until their bytes have actually
  // landed in R2 — a row is created when a multipart upload starts, which can be
  // minutes before it finishes.
  let where = "deleted_at IS NULL AND status = 'ready'";
  const params: (string | number)[] = [];
  if (cursorParam) {
    const [createdAtStr, id] = cursorParam.split(":");
    const createdAt = Number(createdAtStr);
    if (!Number.isFinite(createdAt) || !id) return errorJson("Invalid cursor", 400);
    where += " AND (created_at < ? OR (created_at = ? AND id < ?))";
    params.push(createdAt, createdAt, id);
  }
  params.push(limit);

  const { results } = await env.DB.prepare(
    `SELECT id, width, height, uploader_id, uploader_name, created_at, kind, duration_ms
       FROM photos
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  )
    .bind(...params)
    .all<MediaRow>();

  const photos = results.map((row) => toMediaDTO(row, session));

  const last = results[results.length - 1];
  const nextCursor = results.length === limit && last ? `${last.created_at}:${last.id}` : null;

  return json({ photos, nextCursor });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, data }) => {
  const session = getSession(data);

  const closed = uploadsClosedReason(env.UPLOAD_DEADLINE);
  if (closed) return errorJson(closed, 403);

  const declaredBytes = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
    return errorJson("Photo is too large", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorJson("Invalid upload", 400);
  }

  const full = form.get("full");
  const thumb = form.get("thumb");
  const widthRaw = form.get("width");
  const heightRaw = form.get("height");
  const uploaderNameRaw = form.get("uploaderName");

  if (!(full instanceof File) || !(thumb instanceof File)) {
    return errorJson("Missing photo data", 400);
  }
  if (!full.type.startsWith("image/") || !thumb.type.startsWith("image/")) {
    return errorJson("Only images are allowed", 400);
  }
  if (full.size > MAX_FULL_BYTES || thumb.size > MAX_THUMB_BYTES) {
    return errorJson("Photo is too large", 400);
  }

  const width = Math.round(Number(widthRaw));
  const height = Math.round(Number(heightRaw));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return errorJson("Missing photo dimensions", 400);
  }

  const uploaderName =
    typeof uploaderNameRaw === "string" && uploaderNameRaw.trim() ? uploaderNameRaw.trim().slice(0, 80) : null;

  const id = crypto.randomUUID();
  const [fullBuf, thumbBuf] = await Promise.all([full.arrayBuffer(), thumb.arrayBuffer()]);

  try {
    await Promise.all([
      env.PHOTOS.put(fullKey(id), fullBuf, { httpMetadata: { contentType: "image/jpeg" } }),
      env.PHOTOS.put(thumbKey(id), thumbBuf, { httpMetadata: { contentType: "image/jpeg" } }),
    ]);
  } catch {
    await deleteMedia(env.PHOTOS, id).catch(() => {});
    return errorJson("Upload failed, please try again", 502);
  }

  const createdAt = Date.now();
  const bytes = fullBuf.byteLength + thumbBuf.byteLength;
  try {
    await env.DB.prepare(
      `INSERT INTO photos (id, bytes, width, height, uploader_id, uploader_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, bytes, width, height, session.uid, uploaderName, createdAt)
      .run();
  } catch {
    await deleteMedia(env.PHOTOS, id).catch(() => {});
    return errorJson("Upload failed, please try again", 502);
  }

  return json({
    photo: { id, kind: "photo", width, height, durationMs: null, uploaderName, createdAt, canDelete: true },
  });
};
