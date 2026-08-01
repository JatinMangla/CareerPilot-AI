import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends the email from YOUR Gmail via Gmail SMTP, using a Google App Password.
 *
 * Why Gmail and not a transactional service: the message must genuinely come
 * from jatinmangla123@gmail.com so HR replies land in your inbox, the thread
 * looks personal (not marketing), and Gmail saves a copy in your Sent folder.
 *
 * An App Password is NOT your Google password — it's a scoped 16-character
 * credential you can revoke at any time, and it requires 2-Step Verification.
 */

const SETUP_HELP =
  "Gmail sending isn't configured yet. Turn on 2-Step Verification at " +
  "myaccount.google.com/security, create an App Password at " +
  "myaccount.google.com/apppasswords, then run: " +
  'npx vercel env add GMAIL_APP_PASSWORD production  (and add it to .env.local for local dev).';

function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export async function POST(req: Request) {
  const user = (process.env.GMAIL_USER || process.env.AUTH_EMAIL || "").trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, ""); // Google shows it in groups of 4

  if (!user || !pass) {
    return Response.json({ error: SETUP_HELP }, { status: 503 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { to, cc, subject, text, fromName, attachment } = body || {};

  if (!isEmail(to)) {
    return Response.json({ error: "Enter a valid recipient email address." }, { status: 400 });
  }
  if (cc && !isEmail(cc)) {
    return Response.json({ error: "The CC address looks invalid." }, { status: 400 });
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return Response.json({ error: "Subject is empty." }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length < 20) {
    return Response.json({ error: "Email body is empty or too short." }, { status: 400 });
  }

  const attachments: any[] = [];
  if (attachment?.base64 && attachment?.filename) {
    const bytes = Buffer.from(attachment.base64, "base64");
    if (bytes.length > 8 * 1024 * 1024) {
      return Response.json({ error: "Attachment is larger than 8 MB." }, { status: 400 });
    }
    attachments.push({
      filename: String(attachment.filename),
      content: bytes,
      contentType: "application/pdf",
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });

    const info = await transporter.sendMail({
      from: fromName ? `"${String(fromName).replace(/"/g, "")}" <${user}>` : user,
      to: to.trim(),
      ...(cc ? { cc: cc.trim() } : {}),
      replyTo: user,
      subject: subject.trim(),
      text: text.trim(),
      attachments,
    });

    return Response.json({
      ok: true,
      messageId: info.messageId,
      accepted: info.accepted,
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (/invalid login|username and password not accepted|badcredentials/i.test(msg)) {
      return Response.json(
        {
          error:
            "Gmail rejected the credentials. Make sure GMAIL_APP_PASSWORD is a 16-character App Password (not your normal Google password) and that 2-Step Verification is on.",
        },
        { status: 401 }
      );
    }
    if (/limit|quota|rate/i.test(msg)) {
      return Response.json(
        { error: "Gmail's daily sending limit was hit (~500/day). Try again tomorrow." },
        { status: 429 }
      );
    }
    return Response.json({ error: `Send failed: ${msg}` }, { status: 502 });
  }
}
