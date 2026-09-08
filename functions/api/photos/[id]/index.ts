import type { Env } from "../../../_lib/env";
import { getSession } from "../../../_lib/session";
import { json, errorJson } from "../../../_lib/json";
import { deleteMedia, routeParam } from "../../../_lib/media";

export const onRequestDelete: PagesFunction<Env, "id"> = async ({ params, env, data }) => {
  const session = getSession(data);
  const id = routeParam(params.id);

  const row = await env.DB.prepare(`SELECT uploader_id FROM photos WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ uploader_id: string }>();
  if (!row) return errorJson("Photo not found", 404);
  if (session.role !== "admin" && row.uploader_id !== session.uid) {
    return errorJson("You can only remove your own photos", 403);
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE photos SET deleted_at = ? WHERE id = ?`).bind(now, id),
    env.DB.prepare(`UPDATE comments SET deleted_at = ? WHERE photo_id = ? AND deleted_at IS NULL`).bind(now, id),
  ]);
  // Delete the whole `${id}/` prefix rather than a hardcoded pair of keys, so
  // this keeps working as items grow variants — a video has no full.jpg, and an
  // original would be a third key.
  await deleteMedia(env.PHOTOS, id).catch(() => {});

  return json({ ok: true });
};
