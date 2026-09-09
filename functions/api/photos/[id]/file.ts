import type { Env } from "../../../_lib/env";
import { errorJson } from "../../../_lib/json";
import {
  downloadFilename,
  fullKey,
  isAllowedImageType,
  isAllowedVideoType,
  origKey,
  routeParam,
  thumbKey,
  videoKey,
} from "../../../_lib/media";

// Each variant is a ladder, not a key. Photos uploaded now store the guest's
// own file at `orig`; photos from before that store a 2048px JPEG render at
// `full.jpg` and nothing else. Trying `orig` first and falling back means one
// URL serves both eras, and no back-fill was needed to switch over.
const VARIANTS = {
  thumb: (id: string) => [thumbKey(id)],
  full: (id: string) => [origKey(id), fullKey(id)],
  video: (id: string) => [videoKey(id)],
  download: (id: string) => [origKey(id), videoKey(id), fullKey(id)],
} satisfies Record<string, (id: string) => string[]>;

type Variant = keyof typeof VARIANTS;

function parseVariant(url: URL): Variant {
  if (url.searchParams.get("download") === "1") return "download";
  const v = url.searchParams.get("v");
  return v === "full" || v === "video" || v === "download" ? v : "thumb";
}

// The bytes under `${id}/orig` and `${id}/video` were supplied by a guest, and
// this endpoint is same-origin with the album. Serving a stored content type
// back verbatim would let an upload that slipped past validation be served as,
// say, text/html — so the type is re-derived from an allowlist on the way out
// too. Anything we don't recognise is served as an opaque download rather than
// trusted. The `.jpg` keys are ours, written by this app and never anything but
// JPEG, so they don't need the stored value at all.
function safeContentType(key: string, stored: string | undefined): string {
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (isAllowedImageType(stored) || isAllowedVideoType(stored)) return stored as string;
  return "application/octet-stream";
}

// R2 silently clamps a range that starts past the end of the object and reports
// the whole object back, so reading the requested start off the header is the
// only way to answer a genuinely unsatisfiable request with a 416 rather than
// with bytes the client did not ask for. A suffix range (`bytes=-20`) has no
// start and can never be unsatisfiable, so it deliberately does not match.
function requestedStart(header: string | null): number | null {
  const match = /^bytes=(\d+)-/.exec(header?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

// R2 hands back whichever of the three range shapes the client asked for, but
// it reports them as one object with the unused keys present and undefined —
// so the shape has to be read by testing the values, not by `in`. Getting this
// wrong is quiet: every response becomes a 206 with a NaN Content-Range, which
// browsers accept for an image and video players choke on.
//
// Returns null when the client never asked for a range, which is the only case
// that should produce a plain 200.
function resolveRange(
  object: R2ObjectBody,
  requested: boolean
): { offset: number; length: number } | null {
  if (!requested) return null;
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (!range) return null;

  if (typeof range.suffix === "number") {
    const length = Math.min(range.suffix, object.size);
    return { offset: object.size - length, length };
  }

  const offset = typeof range.offset === "number" ? range.offset : 0;
  const length = typeof range.length === "number" ? range.length : object.size - offset;
  if (!Number.isFinite(offset) || !Number.isFinite(length)) return null;
  return { offset, length: Math.min(length, object.size - offset) };
}

export const onRequestGet: PagesFunction<Env, "id"> = async ({ params, request, env }) => {
  const id = routeParam(params.id);
  const url = new URL(request.url);
  const variant = parseVariant(url);
  const rangeHeader = request.headers.get("Range");

  let object: R2ObjectBody | null = null;
  let key = "";
  for (const candidate of VARIANTS[variant](id)) {
    try {
      // Only pass `range` when the client actually asked for one, so an ordinary
      // request comes back as a plain 200 with no range bookkeeping.
      object = await env.PHOTOS.get(candidate, rangeHeader ? { range: request.headers } : undefined);
    } catch {
      // R2 throws on a range that falls outside the object.
      return new Response("Range not satisfiable", { status: 416, headers: { "accept-ranges": "bytes" } });
    }
    if (object) {
      key = candidate;
      break;
    }
  }
  if (!object) return errorJson("Photo not found", 404);

  const contentType = safeContentType(key, object.httpMetadata?.contentType);
  const headers = new Headers({
    "content-type": contentType,
    // `private`, not `public`: these photos are behind the guest password, so
    // only the requesting browser may store them. A shared/CDN cache would
    // otherwise hand a year-old copy to someone who never signed in.
    "cache-control": "private, max-age=31536000, immutable",
    vary: "Cookie",
    "x-content-type-options": "nosniff",
    // Video will not play in iOS Safari at all unless ranges are honoured, and
    // advertising support here is what makes a large download resumable.
    "accept-ranges": "bytes",
    etag: object.httpEtag,
  });

  if (variant === "download") {
    // The whole point of the download button: one header decides the outcome, so
    // every platform saves the same bytes under the same name instead of each
    // doing its own thing with a long-press.
    const filename = downloadFilename(id, object.uploaded, contentType);
    headers.set("content-disposition", `attachment; filename="${filename}"`);
  }

  const start = requestedStart(rangeHeader);
  if (start !== null && start >= object.size) {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { "accept-ranges": "bytes", "content-range": `bytes */${object.size}` },
    });
  }

  const range = resolveRange(object, rangeHeader !== null);
  if (!range) {
    headers.set("content-length", String(object.size));
    return new Response(object.body, { headers });
  }

  // content-length is the length of *this* response, not of the object — the
  // distinction only shows up once something (a video player, a download
  // manager) actually sends a Range header.
  headers.set("content-length", String(range.length));
  headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  return new Response(object.body, { status: 206, headers });
};
