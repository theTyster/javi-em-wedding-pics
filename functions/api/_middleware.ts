import type { Env } from "../_lib/env";
import { parseCookie, verifySession, SESSION_COOKIE } from "../_lib/session";
import { errorJson } from "../_lib/json";

// Signing in and signing out must work without a valid session: /api/login is
// how you get one, and /api/logout has to be able to clear a cookie whose
// session has already expired (otherwise the stale cookie is stuck).
const PUBLIC_PATHS = new Set(["/api/login", "/api/logout"]);

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  if (PUBLIC_PATHS.has(url.pathname.replace(/\/+$/, ""))) return context.next();

  const token = parseCookie(context.request.headers.get("Cookie"), SESSION_COOKIE);
  const session = token ? await verifySession(token, context.env.SESSION_SECRET) : null;
  if (!session) return errorJson("Not signed in", 401);

  context.data.session = session;
  return context.next();
};
