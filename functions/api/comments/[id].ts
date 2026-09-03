import type { Env } from "../../_lib/env";
import { getSession } from "../../_lib/session";
import { json, errorJson } from "../../_lib/json";

export const onRequestDelete: PagesFunction<Env, "id"> = async ({ params, env, data }) => {
  const session = getSession(data);

  const row = await env.DB.prepare(`SELECT uploader_id FROM comments WHERE id = ? AND deleted_at IS NULL`)
    .bind(params.id)
    .first<{ uploader_id: string }>();
  if (!row) return errorJson("Comment not found", 404);
  if (session.role !== "admin" && row.uploader_id !== session.uid) {
    return errorJson("You can only remove your own comments", 403);
  }

  await env.DB.prepare(`UPDATE comments SET deleted_at = ? WHERE id = ?`).bind(Date.now(), params.id).run();
  return json({ ok: true });
};
