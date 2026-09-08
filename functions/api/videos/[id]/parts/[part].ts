import type { Env } from "../../../../_lib/env";
import { getSession } from "../../../../_lib/session";
import { json, errorJson } from "../../../../_lib/json";
import { MAX_VIDEO_PARTS, authorizePendingVideo, routeParam, videoKey } from "../../../../_lib/media";

// One slice of the file, streamed straight from the request into R2 without
// being buffered — the Worker never holds the part in memory, so a 2 GiB video
// costs the same here as a 20 MB one.
//
// The etag comes back to the browser rather than being stored: the client is
// already tracking which parts succeeded so it can retry just the failed slice,
// and holding the list there keeps this endpoint free of a database write per
// part.
export const onRequestPut: PagesFunction<Env, "id" | "part"> = async ({ params, request, env, data }) => {
  const session = getSession(data);
  const id = routeParam(params.id);

  const denied = await authorizePendingVideo(env.DB, id, session);
  if (denied) return denied;

  const uploadId = new URL(request.url).searchParams.get("uploadId");
  if (!uploadId) return errorJson("Missing upload id", 400);

  const partNumber = Number(routeParam(params.part));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_VIDEO_PARTS) {
    return errorJson("Invalid part number", 400);
  }
  if (!request.body) return errorJson("Missing part data", 400);

  try {
    const upload = env.PHOTOS.resumeMultipartUpload(videoKey(id), uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  } catch {
    // A multipart upload can be aborted or expire underneath us, so every
    // operation on one has to assume it may no longer exist. The client retries
    // the part; if the whole upload is gone it gives up and starts over.
    return errorJson("That part didn't upload, please try again", 502);
  }
};
