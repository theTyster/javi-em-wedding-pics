import type { Env } from "../../../_lib/env";
import { getSession } from "../../../_lib/session";
import { json, errorJson } from "../../../_lib/json";
import { authorizePendingVideo, deleteMedia, routeParam, videoKey } from "../../../_lib/media";

// Called when an upload gives up part-way — a part that would not go through
// after its retries, or a guest who cancelled. R2 aborts incomplete multipart
// uploads on its own after seven days, so this is about not making the guest
// wait a week to stop paying for a video nobody will ever see.
export const onRequestDelete: PagesFunction<Env, "id"> = async ({ params, request, env, data }) => {
  const session = getSession(data);
  const id = routeParam(params.id);

  const denied = await authorizePendingVideo(env.DB, id, session, { allowAdmin: true });
  if (denied) return denied;

  const uploadId = new URL(request.url).searchParams.get("uploadId");
  if (!uploadId) return errorJson("Missing upload id", 400);

  const upload = env.PHOTOS.resumeMultipartUpload(videoKey(id), uploadId);
  await upload.abort().catch(() => {});
  await deleteMedia(env.PHOTOS, id).catch(() => {});
  // A hard delete, unlike the soft delete a finished photo gets: this row was
  // never visible to anyone, so there is no history worth keeping.
  await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(id).run();

  return json({ ok: true });
};
