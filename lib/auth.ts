/**
 * Session signing shared by the login route (Node) and middleware (Edge).
 * Uses Web Crypto so it runs in both runtimes.
 */

export const SESSION_COOKIE = "cp_session";

/** Sessions older than this are rejected regardless of the cookie's own maxAge. */
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;
  // Falling back to a constant in production would mean anyone who has read this
  // repo can mint a valid session. Fail loudly instead.
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is not set — refusing to sign sessions with a default.");
  }
  return "careerpilot-dev-secret-change-me";
}

async function hmac(value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(email: string): Promise<string> {
  const payload = `${email}:${Date.now()}`;
  const sig = await hmac(payload);
  return `${Buffer ? Buffer.from(payload).toString("base64url") : btoa(payload)}.${sig}`;
}

/**
 * Stateless OTP (forgot-password) support: the emailed code's HMAC + expiry are
 * stored in a signed httpOnly cookie, so no database is needed.
 */
export const OTP_COOKIE = "cp_otp";

/** Cryptographically random 6-digit code (Math.random is not suitable here). */
export function generateOtpCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

export async function createOtpToken(code: string, attempts = 0): Promise<string> {
  const exp = Date.now() + 10 * 60 * 1000; // 10 minutes
  const payload = `${await hmac(`otp:${code}`)}:${exp}:${attempts}`;
  const sig = await hmac(payload);
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export const OTP_MAX_ATTEMPTS = 5;

/**
 * Re-signs an OTP payload after bumping its attempt count, keeping the original
 * code hash and expiry intact.
 */
export async function bumpOtpAttempts(
  token: string,
  attempts: number
): Promise<string | null> {
  try {
    const [payloadB64] = token.split(".");
    const [codeHash, expStr] = Buffer.from(payloadB64, "base64url").toString().split(":");
    if (!codeHash || !expStr) return null;
    const payload = `${codeHash}:${expStr}:${attempts}`;
    return `${Buffer.from(payload).toString("base64url")}.${await hmac(payload)}`;
  } catch {
    return null;
  }
}

export type OtpResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "locked"; attempts: number };

/**
 * A 6-digit code is only 10^6 wide, so without an attempt limit it is
 * brute-forceable inside its 10-minute window. The count rides in the signed
 * token itself, which keeps this stateless.
 */
export async function verifyOtpToken(
  token: string | undefined,
  code: string
): Promise<OtpResult> {
  if (!token || !code) return { ok: false, reason: "invalid", attempts: 0 };
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return { ok: false, reason: "invalid", attempts: 0 };
  try {
    const payload = Buffer.from(payloadB64, "base64url").toString();
    if ((await hmac(payload)) !== sig) return { ok: false, reason: "invalid", attempts: 0 };

    const [codeHash, expStr, attemptStr] = payload.split(":");
    const attempts = Number(attemptStr || 0);
    if (Date.now() > Number(expStr)) return { ok: false, reason: "expired", attempts };
    if (attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked", attempts };

    if ((await hmac(`otp:${code.trim()}`)) === codeHash) return { ok: true };
    return { ok: false, reason: "invalid", attempts: attempts + 1 };
  } catch {
    return { ok: false, reason: "invalid", attempts: 0 };
  }
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return false;
  try {
    const payload =
      typeof Buffer !== "undefined"
        ? Buffer.from(payloadB64, "base64url").toString()
        : atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));

    if ((await hmac(payload)) !== sig) return false;

    // The payload has always carried an issue time; now we actually enforce it.
    // Without this a leaked cookie stayed valid forever, since the cookie's
    // maxAge is only a hint the browser is free to ignore.
    const sep = payload.lastIndexOf(":");
    if (sep < 0) return false;
    const email = payload.slice(0, sep);
    const issuedAt = Number(payload.slice(sep + 1));
    if (!Number.isFinite(issuedAt)) return false;
    if (Date.now() - issuedAt > SESSION_MAX_AGE_MS) return false;

    // Only the configured owner may hold a session, even with a valid signature.
    const owner = (process.env.AUTH_EMAIL || "jatinmangla123@gmail.com").trim().toLowerCase();
    return email.trim().toLowerCase() === owner;
  } catch {
    return false;
  }
}
