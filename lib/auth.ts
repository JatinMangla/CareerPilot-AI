/**
 * Session signing shared by the login route (Node) and middleware (Edge).
 * Uses Web Crypto so it runs in both runtimes.
 */

export const SESSION_COOKIE = "cp_session";

function getSecret(): string {
  return process.env.AUTH_SECRET || "careerpilot-dev-secret-change-me";
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

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return false;
  try {
    const payload =
      typeof Buffer !== "undefined"
        ? Buffer.from(payloadB64, "base64url").toString()
        : atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const expected = await hmac(payload);
    return expected === sig;
  } catch {
    return false;
  }
}
