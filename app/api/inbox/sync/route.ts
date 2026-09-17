import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Reads your Gmail over IMAP (read-only) using the same App Password used for
 * sending. Nothing is stored server-side — messages are returned to the browser,
 * classified there, and kept in your own localStorage.
 *
 * Incremental by design, but the cursor is a **UID**, not a date. Dates were
 * tried first and lose mail: IMAP `SEARCH SINCE` has day granularity, so a page
 * has to be re-filtered by timestamp, and advancing the cursor to the newest
 * message in a page skips everything between that page's oldest and newest
 * member. UIDs are monotonic within a mailbox, so `uid > cursor` paginates
 * exactly once over every message with nothing skipped and nothing repeated.
 *
 * `uidValidity` comes back with every response. If Gmail ever rebuilds INBOX it
 * changes, every old UID becomes meaningless, and the client must restart from
 * a date window instead of its stored cursor.
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
  const days = Math.min(Math.max(Number(body?.days) || 14, 1), 90);

  // A UID cursor resumes exactly where the last page stopped. Without one we
  // fall back to a date window, which is also what a "Rescan last N days" does.
  const afterUid = Number(body?.afterUid) > 0 ? Math.floor(Number(body.afterUid)) : 0;

  // IMAP SEARCH SINCE has day granularity, so this is a floor on the window, not
  // an exact boundary. That is fine — the UID cursor, not the date, decides what
  // has already been seen.
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  windowStart.setHours(0, 0, 0, 0);

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
  let remaining = 0;
  let uidValidity = "";
  // Highest UID this page covered, whether or not it parsed. An unparseable
  // message must still advance the cursor or every later sync re-stalls on it.
  let highestUid = afterUid;
  let lock;
  try {
    lock = await client.getMailboxLock("INBOX");
    uidValidity = String((client.mailbox as any)?.uidValidity ?? "");

    /*
     * With a cursor, the UID range IS the filter — no date criterion.
     *
     * Combining the two loses mail. A 90-day rescan stops partway and stores a
     * cursor; the next click defaults back to a 14-day window, and everything
     * between 90 and 14 days old that the rescan had not reached yet falls
     * outside the SEARCH and can never be drained. UID > cursor already means
     * "not yet seen", and it needs no window to say so.
     */
    const criteria: Record<string, unknown> = afterUid
      ? { uid: `${afterUid + 1}:*` }
      : { since: windowStart };
    const all = (await client.search(criteria, { uid: true })) || [];

    // `uid: "n:*"` is inclusive of n when n is above the highest existing UID,
    // so drop anything at or below the cursor rather than trusting the server.
    const pending = all.filter((u) => u > afterUid).sort((a, b) => a - b);

    // Oldest first, so a long absence drains in order and each page's highest
    // UID is a cursor that skips nothing.
    const batch = pending.slice(0, limit);
    remaining = Math.max(0, pending.length - batch.length);
    if (batch.length) highestUid = batch[batch.length - 1];

    if (batch.length) {
      for await (const msg of client.fetch(
        batch,
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
            uidNum: msg.uid,
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
          // Skip it, but leave `highestUid` covering it: the cursor has to move
          // past a message we can never parse, or every future sync re-stalls
          // on the same one and nothing after it is ever read.
        }
      }
    }
  } catch (err: any) {
    // A mid-stream failure still hands back whatever parsed, with a cursor that
    // only covers those messages, so the next click retries the rest instead of
    // throwing away a minute of IMAP work.
    if (!messages.length) {
      return Response.json({ error: `Inbox read failed: ${err?.message}` }, { status: 502 });
    }
    highestUid = messages.reduce((max, m) => Math.max(max, m.uidNum || 0), afterUid);
    remaining = remaining + 1; // at least the one that failed is still pending
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
    uidValidity,
    afterUid,
    nextAfterUid: highestUid,
    windowStart: windowStart.toISOString(),
    remaining,
    fetched: messages.length,
    syncedAt: new Date().toISOString(),
    messages,
  });
}
