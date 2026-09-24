/**
 * Session signing shared by the login routes (Node) and middleware (Edge).
 * Uses Web Crypto so it runs in both runtimes. Nothing here touches Redis —
 * middleware must stay fast and stateless. Revocation lives in lib/session.ts,
 * which the API routes call on top of this.
 */

export const SESSION_COOKIE = "cp_session";

/** Sessions older than this are rejected regardless of the cookie's own maxAge. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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

/**
 * The one account allowed in. There used to be a hardcoded fallback address, so
 * a deployment that lost AUTH_EMAIL quietly kept working for whoever knew the
 * repo — same reasoning as getSecret: production refuses rather than guesses.
 */
export function ownerEmail(): string {
  const email = (process.env.AUTH_EMAIL || "").trim().toLowerCase();
  if (email) return email;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_EMAIL is not set — no account can sign in.");
  }
  return "dev@localhost";
}

/**
 * Constant-time string comparison. `===` returns at the first differing byte,
 * which leaks how much of a guess was right through response timing. Pure JS
 * because Node's timingSafeEqual does not exist in the Edge runtime.
 */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
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

/** Compares two secrets without leaking their length or common prefix. */
export async function secretsEqual(given: string, expected: string): Promise<boolean> {
  return safeEqual(await hmac(`cmp:${given}`), await hmac(`cmp:${expected}`));
}

function toB64Url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function fromB64Url(s: string): string {
  return typeof Buffer !== "undefined"
    ? Buffer.from(s, "base64url").toString()
    : atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

/**
 * `epoch` ties the token to the account-wide "sign out everywhere" counter in
 * lib/session.ts: bumping it invalidates every session issued before.
 */
export async function createSessionToken(email: string, epoch = 0): Promise<string> {
  const payload = `${email}:${Date.now()}:${epoch}`;
  return `${toB64Url(payload)}.${await hmac(payload)}`;
}

export interface SessionInfo {
  email: string;
  issuedAt: number;
  epoch: number;
  /** The token's signature — a stable id for revoking this one session. */
  sig: string;
}

/** Signature, age and owner checks. Stateless, so it is safe in middleware. */
export async function readSession(token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  try {
    const payload = fromB64Url(payloadB64);
    if (!safeEqual(await hmac(payload), sig)) return null;

    // `email:issuedAt:epoch`. Tokens minted before revocation existed carry no
    // epoch; they read as epoch 0, which is what the counter starts at.
    const parts = payload.split(":");
    if (parts.length !== 2 && parts.length !== 3) return null;
    const [email, issuedStr, epochStr = "0"] = parts;
    const issuedAt = Number(issuedStr);
    const epoch = Number(epochStr);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(epoch)) return null;

    // The cookie's maxAge is only a hint the browser is free to ignore.
    if (Date.now() - issuedAt > SESSION_MAX_AGE_MS) return null;

    // Only the configured owner may hold a session, even with a valid signature.
    if (email.trim().toLowerCase() !== ownerEmail()) return null;
    return { email, issuedAt, epoch, sig };
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await readSession(token)) !== null;
}

/* ---------- email login codes ---------- */

/**
 * The login-code cookie holds only a random nonce. The code's hash and its
 * attempt counter live server-side (lib/otp.ts).
 *
 * They used to live in the signed cookie itself. That kept the design stateless,
 * but the attacker holds that cookie: replaying the first one reset the attempt
 * counter to zero on every guess, so the 5-attempt limit was never enforced.
 */
export const OTP_COOKIE = "cp_otp";
export const OTP_MAX_ATTEMPTS = 5;

/** Cryptographically random 6-digit code (Math.random is not suitable here). */
export function generateOtpCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

export function generateNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bound to the nonce, so a stored hash says nothing about any other code. */
export function hashOtp(code: string, nonce: string): Promise<string> {
  return hmac(`otp:${nonce}:${code.trim()}`);
}
