import type { Env } from "../_lib/env";
import { clearSessionCookieHeader } from "../_lib/session";
import { json } from "../_lib/json";

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  const secure = new URL(request.url).protocol === "https:";
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader(secure) } });
};
