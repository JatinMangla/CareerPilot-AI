import type { InboxMessage } from "./types";

/**
 * Mail that is certainly not about a job, recognisable without AI: sign-in codes,
 * bank and card alerts, receipts, deliveries. Filing these locally keeps them off
 * the free AI tier entirely — its terms allow Google to use what it is sent — and
 * spends no quota on them.
 *
 * Deliberately narrow. A false positive hides a recruiter's email for good, which
 * costs far more than one classification call, so anything that mentions a job,
 * an interview, an application or a role is never filtered here.
 */
const TRANSACTIONAL_RE =
  /\b(otp|one[- ]time (pass(word|code)|code)|verification code|security code|sign[- ]in (code|attempt|alert)|login (code|alert)|password reset|reset your password|2-step|two-factor|debited|credited|transaction|a\/c|account statement|e-?statement|credit card|debit card|upi|emi\b|payment (received|successful|due|failed)|invoice|receipt|order (confirmed|placed|shipped)|has been (shipped|delivered)|out for delivery|your order|refund|recharge|bill (is )?(generated|due))\b/i;

const JOBISH_RE =
  /\b(job|jobs|interview|application|applied|apply|role|position|opening|hiring|recruit|career|candidate|resume|cv|offer letter|hr\b)\b/i;

export function isTransactional(m: Pick<InboxMessage, "subject" | "from" | "snippet">): boolean {
  const text = `${m.subject || ""} ${m.snippet || ""}`;
  if (JOBISH_RE.test(`${text} ${m.from || ""}`)) return false;
  return TRANSACTIONAL_RE.test(text);
}

/** Job mail is kept whole up to this; beyond it only replies need more context. */
const MAX_BODY = 2000;
/** Total messages kept on the device; the oldest non-job stubs go first. */
const MAX_MESSAGES = 800;

/**
 * Bounds what the inbox costs in localStorage (about 5MB on iOS, shared with
 * everything else) and in every sync. Non-job mail is hidden in the UI and only
 * kept so a rescan recognises it — it needs no body. Job mail keeps a generous
 * excerpt. The list stays newest-first.
 */
export function trimForStorage(all: InboxMessage[]): InboxMessage[] {
  const slim = all.map((m) =>
    m.category === "not_job"
      ? { ...m, snippet: "", body: "" }
      : m.body && m.body.length > MAX_BODY
      ? { ...m, body: m.body.slice(0, MAX_BODY) }
      : m
  );
  if (slim.length <= MAX_MESSAGES) return slim;

  const excess = slim.length - MAX_MESSAGES;
  const dropUids = new Set(
    slim
      .filter((m) => m.category === "not_job")
      .slice(-excess) // newest-first list, so the tail is the oldest
      .map((m) => m.uid)
  );
  const kept = slim.filter((m) => !dropUids.has(m.uid));
  return kept.slice(0, MAX_MESSAGES);
}
