import type { Env } from "../../../_lib/env";
import { errorJson } from "../../../_lib/json";

export const onRequestGet: PagesFunction<Env, "id"> = async ({ params, request, env }) => {
  const variant = new URL(request.url).searchParams.get("v") === "full" ? "full" : "thumb";
  const object = await env.PHOTOS.get(`${params.id}/${variant}.jpg`);
  if (!object) return errorJson("Photo not found", 404);

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/jpeg",
      "content-length": String(object.size),
      // `private`, not `public`: these photos are behind the guest password, so
      // only the requesting browser may store them. A shared/CDN cache would
      // otherwise hand a year-old copy to someone who never signed in.
      "cache-control": "private, max-age=31536000, immutable",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
    },
  });
};
