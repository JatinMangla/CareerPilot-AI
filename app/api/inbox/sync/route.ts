import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Reads your Gmail over IMAP (read-only) using the same App Password used for
 * sending. Nothing is stored server-side — messages are returned to the browser,
 * classified there, and kept in your own localStorage.
 *
 * Incremental by design: pass `since` (ISO date of your last sync) and only
 * newer mail comes back.
 */

const SETUP_HELP =
  "Gmail isn't connected yet. Create an App Password at myaccount.google.com/apppasswords " +
  "(2-Step Verification must be on), then add GMAIL_APP_PASSWORD in your Vercel project settings.";

export async function POST(req: Request) {
  const user = (process.env.GMAIL_USER || process.env.AUTH_EMAIL || "").trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) {
    return Response.json({ error: SETUP_HELP }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body?.limit) || 40, 80);

  // Default look-back on first run: 14 days.
  let since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  if (body?.since) {
    const d = new Date(body.since);
    if (!isNaN(d.getTime())) since = d;
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    emitLogs: false,
  });

  try {
    await client.connect();
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (/invalid credentials|authenticationfailed|auth/i.test(msg)) {
      return Response.json(
        {
          error:
            "Gmail rejected the credentials. GMAIL_APP_PASSWORD must be a 16-character App Password, and IMAP must be enabled in Gmail Settings → Forwarding and POP/IMAP.",
        },
        { status: 401 }
      );
    }
    return Response.json({ error: `Could not connect to Gmail: ${msg}` }, { status: 502 });
  }

  const messages: any[] = [];
  let lock;
  try {
    lock = await client.getMailboxLock("INBOX");
    const uids = (await client.search({ since }, { uid: true })) || [];
    const recent = uids.slice(-limit); // newest N

    if (recent.length) {
      for await (const msg of client.fetch(
        recent,
        { uid: true, source: true, envelope: true },
        { uid: true }
      )) {
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          const text = (parsed.text || "")
            .replace(/\r\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          messages.push({
            uid: String(msg.uid),
            from: parsed.from?.text || msg.envelope?.from?.[0]?.address || "",
            fromName: parsed.from?.value?.[0]?.name || "",
            fromAddress:
              parsed.from?.value?.[0]?.address ||
              msg.envelope?.from?.[0]?.address ||
              "",
            subject: parsed.subject || msg.envelope?.subject || "(no subject)",
            date: (parsed.date || msg.envelope?.date || new Date()).toISOString(),
            snippet: text.slice(0, 300),
            body: text.slice(0, 4000),
          });
        } catch {
          /* skip unparseable message */
        }
      }
    }
  } catch (err: any) {
    return Response.json({ error: `Inbox read failed: ${err?.message}` }, { status: 502 });
  } finally {
    try {
      lock?.release();
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  messages.sort((a, b) => +new Date(b.date) - +new Date(a.date));

  return Response.json({
    ok: true,
    account: user,
    since: since.toISOString(),
    syncedAt: new Date().toISOString(),
    count: messages.length,
    messages,
  });
}
