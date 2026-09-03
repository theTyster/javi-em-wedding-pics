import type { Env } from "../_lib/env";
import {
  checkPassword,
  createSession,
  parseCookie,
  sessionCookieHeader,
  verifySession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "../_lib/session";
import { json, errorJson } from "../_lib/json";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request", 400);
  }

  const password = typeof body.password === "string" ? body.password : "";
  const role = checkPassword(password, env.GUEST_PASSWORD, env.ADMIN_PASSWORD);
  if (!role) return errorJson("That password isn't correct.", 401);

  // Reuse the existing device uid across logins so "delete my own uploads"
  // keeps working even after the session expires and the guest logs back in.
  const existingToken = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  const existing = existingToken
    ? await verifySession(existingToken, env.SESSION_SECRET, { ignoreExpiry: true })
    : null;
  const uid = existing?.uid ?? crypto.randomUUID();

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await createSession({ uid, role, exp }, env.SESSION_SECRET);
  const secure = new URL(request.url).protocol === "https:";
  return json({ role }, { headers: { "Set-Cookie": sessionCookieHeader(token, secure) } });
};
