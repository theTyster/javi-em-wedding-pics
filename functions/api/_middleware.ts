import type { Env } from "../_lib/env";
import { parseCookie, verifySession, verifyDownloadToken, SESSION_COOKIE } from "../_lib/session";
import { errorJson } from "../_lib/json";

// Signing in and signing out must work without a valid session: /api/login is
// how you get one, and /api/logout has to be able to clear a cookie whose
// session has already expired (otherwise the stale cookie is stuck).
const PUBLIC_PATHS = new Set(["/api/login", "/api/logout"]);

// A download request carries its own signed token as a fallback credential —
// see signDownloadToken's comment for why the cookie alone isn't reliable
// here. Scoped tightly: only this one path, only the download variant, and
// only with a token that verifies for the exact id in the URL. Every other
// request (thumb/full/video, embedded in <img>/<video> and reliably running
// inside the page's own cookie jar) still needs the session cookie below.
const DOWNLOAD_FILE_PATH = /^\/api\/photos\/([^/]+)\/file$/;

async function hasValidDownloadToken(url: URL, env: Env): Promise<boolean> {
  const match = DOWNLOAD_FILE_PATH.exec(url.pathname);
  if (!match) return false;
  const isDownload = url.searchParams.get("v") === "download" || url.searchParams.get("download") === "1";
  if (!isDownload) return false;
  const token = url.searchParams.get("token");
  if (!token) return false;
  return verifyDownloadToken(token, match[1], env.SESSION_SECRET);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  if (PUBLIC_PATHS.has(url.pathname.replace(/\/+$/, ""))) return context.next();
  if (await hasValidDownloadToken(url, context.env)) return context.next();

  const token = parseCookie(context.request.headers.get("Cookie"), SESSION_COOKIE);
  const session = token ? await verifySession(token, context.env.SESSION_SECRET) : null;
  if (!session) return errorJson("Not signed in", 401);

  context.data.session = session;
  return context.next();
};
