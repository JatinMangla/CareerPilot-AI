/**
 * Transactional mail to the owner (login codes, security alerts) via Resend.
 * Outreach to employers goes through Gmail SMTP instead — see app/api/email/send.
 */
export async function sendOwnerMail(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: 500, detail: "RESEND_API_KEY is not configured." };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "CareerPilot AI <onboarding@resend.dev>", to: [to], subject, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, status: res.status, detail: (await res.text().catch(() => "")).slice(0, 200) };
  } catch (err) {
    // A network failure or the timeout, which used to escape as a bare 500.
    return { ok: false, status: 502, detail: String((err as Error)?.message).slice(0, 200) };
  }
}
