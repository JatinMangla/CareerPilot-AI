import { cookies } from "next/headers";
import { createOtpToken, generateOtpCode, OTP_COOKIE } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * Emails a 6-digit login code to the owner's email via Resend.
 * The code's hash + expiry live in a signed httpOnly cookie (no DB).
 */
export async function POST() {
  const resendKey = process.env.RESEND_API_KEY;
  const email = (process.env.AUTH_EMAIL || "jatinmangla123@gmail.com").trim();

  if (!resendKey) {
    return Response.json(
      { error: "RESEND_API_KEY is not configured — cannot send the login code." },
      { status: 500 }
    );
  }

  // Server-side, so it can't be skipped by omitting a cookie. This endpoint is
  // unauthenticated — without a real limit it can drain the email quota and
  // mailbomb the owner.
  const limited = await rateLimit("otp-send", 5, 60 * 15);
  if (!limited.allowed) {
    return Response.json(
      {
        error:
          "Too many login codes requested. Check your inbox (and spam), then try again in a few minutes.",
      },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  // Short client-side cooldown purely for UX (stops double-clicks).
  if (cookies().get("cp_otp_cooldown")) {
    return Response.json(
      { error: "A code was just sent — check your inbox (and spam). You can request another in a minute." },
      { status: 429 }
    );
  }

  const code = generateOtpCode();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "CareerPilot AI <onboarding@resend.dev>",
      to: [email],
      subject: `${code} is your CareerPilot login code`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:440px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 8px">CareerPilot AI</h2>
          <p style="color:#555">Use this code to sign in. It expires in 10 minutes.</p>
          <div style="font-size:34px;font-weight:bold;letter-spacing:8px;background:#f4f6f5;border-radius:12px;padding:18px;text-align:center">${code}</div>
          <p style="color:#999;font-size:12px;margin-top:16px">If you didn't request this, you can ignore it — only this code (not your password) was sent.</p>
        </div>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      {
        error: `Email sending failed (Resend ${res.status}). ${
          res.status === 403
            ? "Free Resend accounts can only send to the email you registered Resend with — make sure that's " + email + "."
            : detail.slice(0, 200)
        }`,
      },
      { status: 502 }
    );
  }

  const jar = cookies();
  jar.set(OTP_COOKIE, await createOtpToken(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  jar.set("cp_otp_cooldown", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60,
  });

  return Response.json({ ok: true, sentTo: email.replace(/(.{3}).+(@.+)/, "$1***$2") });
}
