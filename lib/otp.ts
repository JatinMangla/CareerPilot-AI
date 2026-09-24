import { generateNonce, generateOtpCode, hashOtp, OTP_MAX_ATTEMPTS, safeEqual } from "./auth";
import { deleteKey, getString, incrWithExpiry, setString } from "./kv";

/**
 * Email login codes, held server-side in Redis.
 *
 * The browser keeps only a random nonce. The code's hash and the attempt count
 * sit in Redis, where the client cannot reset them — the earlier design stored
 * both in the signed cookie, and replaying the first cookie made every guess
 * look like attempt #1. A successful verify deletes the record, so a code works
 * exactly once.
 */

export const OTP_TTL_SEC = 600;

const recordKey = (nonce: string) => `cp:otp:${nonce}`;
const attemptsKey = (nonce: string) => `cp:otp:${nonce}:attempts`;

export async function issueOtp(): Promise<{ code: string; nonce: string }> {
  const code = generateOtpCode();
  const nonce = generateNonce();
  await setString(recordKey(nonce), await hashOtp(code, nonce), OTP_TTL_SEC);
  return { code, nonce };
}

export type OtpResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "locked"; attemptsLeft: number };

export async function verifyOtp(nonce: string | undefined, code: string): Promise<OtpResult> {
  if (!nonce || !/^[0-9a-f]{32}$/.test(nonce)) {
    return { ok: false, reason: "expired", attemptsLeft: 0 };
  }
  const stored = await getString(recordKey(nonce));
  if (!stored) return { ok: false, reason: "expired", attemptsLeft: 0 };

  // Counted before comparing, atomically, so parallel guesses cannot all slip in
  // under the limit.
  const attempts = await incrWithExpiry(attemptsKey(nonce), OTP_TTL_SEC);
  if (attempts > OTP_MAX_ATTEMPTS) {
    await deleteKey(recordKey(nonce));
    return { ok: false, reason: "locked", attemptsLeft: 0 };
  }

  if (safeEqual(await hashOtp(code, nonce), stored)) {
    await Promise.all([deleteKey(recordKey(nonce)), deleteKey(attemptsKey(nonce))]);
    return { ok: true };
  }
  return { ok: false, reason: "invalid", attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
}
