export interface SessionPayload {
  uid: string;
  role: "guest" | "admin";
  exp: number; // unix seconds
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function checkPassword(
  input: string,
  guestPassword: string,
  adminPassword: string
): "guest" | "admin" | null {
  if (input && timingSafeEqual(input, adminPassword)) return "admin";
  if (input && timingSafeEqual(input, guestPassword)) return "guest";
  return null;
}

export async function createSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySession(
  token: string,
  secret: string,
  options: { ignoreExpiry?: boolean } = {}
): Promise<SessionPayload | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const key = await hmacKey(secret);
  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  if (!timingSafeEqual(signature, base64UrlEncode(new Uint8Array(expected)))) return null;

  try {
    const payload = JSON.parse(decoder.decode(base64UrlDecode(body))) as SessionPayload;
    if (payload.role !== "guest" && payload.role !== "admin") return null;
    if (typeof payload.uid !== "string" || !payload.uid) return null;
    if (!options.ignoreExpiry && (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// Secure cookies are dropped by browsers on plain HTTP — which is how
// `wrangler pages dev` serves the app, including over a LAN IP to a phone
// for real-device testing. Key the flag off the actual request scheme so
// login still works locally while production (always HTTPS) stays secure.
export function sessionCookieHeader(token: string, secure: boolean): string {
  const secureFlag = secure ? " Secure;" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  const secureFlag = secure ? " Secure;" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=0`;
}

export function getSession(data: Readonly<Record<string, unknown>>): SessionPayload {
  return data.session as SessionPayload;
}
