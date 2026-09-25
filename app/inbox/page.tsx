"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import { mapPool, AI_CONCURRENCY } from "@/lib/pool";
import { Pager, usePaged } from "@/components/Pager";
import { isTransactional, trimForStorage } from "@/lib/inboxFilters";
import { applicationsAt, recordOutcome } from "@/lib/outcomes";
import { useCancellable } from "@/lib/useCancellable";
import RunProgress from "@/components/RunProgress";
import type { InboxCursor, InboxMessage, MailCategory, OutcomeStage } from "@/lib/types";

const PAGE_SIZE = 20;

const TABS: { key: MailCategory | "all" | "action"; label: string; hint: string }[] = [
  { key: "action", label: "Needs action", hint: "Waiting on you" },
  { key: "applied_reply", label: "Application replies", hint: "Responses to jobs you applied to" },
  { key: "recruiter_outreach", label: "Recruiter mail", hint: "Someone reached out to you" },
  { key: "job_alert", label: "Job alerts", hint: "Automated suggestions" },
  { key: "bulk_requirement", label: "Bulk requirements", hint: "Consultancy blasts" },
  { key: "all", label: "All job mail", hint: "Everything relevant" },
];

const CAT_STYLE: Record<string, string> = {
  applied_reply: "badge-green",
  recruiter_outreach: "badge-blue",
  job_alert: "badge-amber",
  bulk_requirement: "badge-red",
  not_job: "badge-red",
};

const CAT_LABEL: Record<string, string> = {
  applied_reply: "Application reply",
  recruiter_outreach: "Recruiter",
  job_alert: "Job alert",
  bulk_requirement: "Bulk requirement",
  not_job: "Not job",
};

export default function InboxPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("action");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const run = useCancellable();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [account, setAccount] = useState("");

  useEffect(() => {
    setMessages(store.getInbox());
    setLastSync(store.getLastSync());
  }, []);

  /**
   * Classifies one page of mail and commits it, then advances the cursor.
   *
   * The order matters. The cursor used to move as soon as a page was fetched,
   * which meant an AI failure — or simply closing the tab — left the cursor past
   * mail that had never been stored, and that mail could never be fetched again.
   * Storing first makes an interruption cost a repeat, not a hole.
   */
  async function commitPage(page: InboxMessage[], cursor: InboxCursor, signal?: AbortSignal) {
    const profile = store.getProfile();
    const classified: Record<string, any> = {};
    const BATCH = 12;

    // Only mail that still needs a verdict goes to the AI. A rescan used to pay
    // to re-classify everything it had already sorted; and transactional mail
    // (bank alerts, sign-in codes, receipts) is filed locally so it never
    // leaves for the free tier's servers at all.
    const known = new Map(store.getInbox().map((m) => [m.uid, m]));
    const now0 = new Date().toISOString();
    const toClassify: InboxMessage[] = [];
    for (const m of page) {
      if (known.get(m.uid)?.classifiedAt) continue;
      if (isTransactional(m)) {
        classified[m.uid] = {
          uid: m.uid,
          category: "not_job",
          relevance: 0,
          summary: "Filed on this device as account/transaction mail — not sent to the AI.",
          classifiedAt: now0,
        };
        continue;
      }
      toClassify.push(m);
    }

    const batches: InboxMessage[][] = [];
    for (let i = 0; i < toClassify.length; i += BATCH) batches.push(toClassify.slice(i, i + BATCH));

    const outcomes = await mapPool(
      batches,
      AI_CONCURRENCY,
      (slice, _i, sig) =>
        jsonTask<{ results: any[] }>("classify_inbox", {
          profile,
          emails: slice.map((m) => ({
            uid: m.uid,
            from: m.from,
            subject: m.subject,
            date: m.date,
            snippet: m.snippet,
          })),
        }, { signal: sig }),
      (done) =>
        setProgress(`Sorting job mail… ${Math.min(done * BATCH, toClassify.length)}/${toClassify.length}`),
      signal
    );

    for (const outcome of outcomes) {
      for (const r of outcome.value?.results || []) classified[r.uid] = r;
    }
    // A batch stopped by Cancel counts as unfinished: the cursor must not move
    // past mail that was stored but never sorted.
    const failedBatches = outcomes.filter((o) => o.error || o.skipped);

    const now = new Date().toISOString();
    const merged: InboxMessage[] = page.map((m) => {
      const verdict = classified[m.uid];
      // An unclassified message is left without a category rather than filed as
      // not_job — "we couldn't read this" and "this isn't job mail" look the
      // same in the UI otherwise, and the not_job ones are hidden for good.
      return verdict
        ? { ...m, ...verdict, classifiedAt: now }
        : { ...m, relevance: 0 };
    });

    // Merge the fresh copy UNDER the stored one. Spreading it on top was the old
    // behaviour and it wiped `handled` — a re-synced email the user had already
    // dealt with came back demanding action.
    // A stored copy that was never classified must not win over a fresh verdict,
    // though, or a rescan pays for triage and then throws the answer away.
    const byUid = new Map<string, InboxMessage>();
    for (const m of store.getInbox()) byUid.set(m.uid, m);
    for (const m of merged) {
      const prev = byUid.get(m.uid);
      if (!prev) byUid.set(m.uid, m);
      else if (prev.classifiedAt) byUid.set(m.uid, { ...m, ...prev });
      else byUid.set(m.uid, { ...prev, ...m, handled: prev.handled });
    }
    const all = trimForStorage(
      Array.from(byUid.values()).sort((a, b) => +new Date(b.date) - +new Date(a.date))
    );

    store.setInbox(all);
    setMessages(all);

    // Only now is it safe to say this mail has been seen.
    if (!failedBatches.length) store.setInboxCursor(cursor);
    store.setLastSync(new Date().toISOString());
    setLastSync(store.getLastSync());

    return failedBatches[0]?.error?.message || "";
  }

  /**
   * Pages through everything past the cursor. A week away can mean hundreds of
   * emails, so it keeps calling until the backlog drains, committing each page
   * as it lands so progress survives a failure mid-run.
   */
  async function sync(opts: { rescanDays?: number } = {}) {
    const rescan = opts.rescanDays;
    setError("");
    setNotice("");
    setBusy(true);
    setProgress("Connecting to Gmail…");
    const signal = run.start();

    let fetched = 0;
    let classifyError = "";
    try {
      const stored = store.getInboxCursor();
      let afterUid = rescan ? 0 : stored.uid;
      let validity = stored.uidValidity;
      let leftover = 0;
      const days = rescan ?? 14;
      const MAX_ROUNDS = 8; // up to ~640 emails per click

      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (signal.aborted) break;
        const res = await fetch("/api/inbox/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ afterUid, limit: 80, days }),
          signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (fetched === 0) {
            setError(data.error || `Sync failed (${res.status})`);
            return;
          }
          setError(
            `Stopped after ${fetched} emails: ${data.error || `sync failed (${res.status})`}. ` +
              `Click Sync again to resume.`
          );
          return;
        }
        setAccount(data.account || "");

        // Gmail rebuilt the mailbox, so every UID we stored points at different
        // mail now. Restart from the date window once, rather than resume from a
        // number that no longer means anything. `validity` is updated before the
        // retry so this can match at most once and cannot spin.
        if (validity && data.uidValidity && data.uidValidity !== validity) {
          validity = data.uidValidity;
          store.setInboxCursor({ uid: 0, uidValidity: validity });
          setNotice(`Gmail reset its message ids — rescanning the last ${days} days from scratch.`);
          afterUid = 0;
          continue;
        }
        validity = data.uidValidity || validity;

        const page: InboxMessage[] = data.messages || [];
        leftover = data.remaining || 0;
        afterUid = data.nextAfterUid ?? afterUid;

        if (page.length) {
          fetched += page.length;
          setProgress(`Reading ${page.length} emails…`);
          const err = await commitPage(page, { uid: afterUid, uidValidity: validity }, signal);
          if (err) classifyError = err;
        } else {
          store.setInboxCursor({ uid: afterUid, uidValidity: validity });
        }

        if (!leftover) break;
        setProgress(`Fetched ${fetched} emails · ${leftover} older still queued…`);
      }

      if (!fetched) {
        setNotice(
          rescan
            ? `Rescanned the last ${days} days — nothing job-related turned up.`
            : "You're up to date — no new mail since the last sync."
        );
        return;
      }

      const parts = [`Synced ${fetched} email${fetched === 1 ? "" : "s"}.`];
      if (signal.aborted) parts.push("Stopped — click Sync again to continue from where it left off.");
      if (leftover > 0) parts.push(`${leftover} older ones are still queued — click Sync again to continue.`);
      setNotice(parts.join(" "));
      if (classifyError) setError(`Some mail couldn't be sorted: ${classifyError}`);
    } catch (err: any) {
      if (signal.aborted) {
        setNotice(`Stopped after ${fetched} emails — click Sync again to continue.`);
        return;
      }
      setError(
        fetched
          ? `Stopped after ${fetched} emails: ${err.message}. Click Sync again to resume.`
          : err.message
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function markHandled(uid: string) {
    const next = messages.map((m) => (m.uid === uid ? { ...m, handled: true } : m));
    store.setInbox(next);
    setMessages(next);
  }

  function replyTo(m: InboxMessage) {
    store.setDraft({
      mode: "reply",
      to: m.fromAddress || m.from,
      role: m.role || "React Developer",
      company: m.company || "",
      context: `Their email (subject: "${m.subject}"):\n\n${m.body}`,
    });
    router.push("/outreach");
  }

  const jobMail = useMemo(
    () => messages.filter((m) => m.category && m.category !== "not_job"),
    [messages]
  );

  const visible = useMemo(() => {
    if (tab === "action") return jobMail.filter((m) => m.actionNeeded && !m.handled);
    if (tab === "all") return jobMail;
    return jobMail.filter((m) => m.category === tab);
  }, [jobMail, tab]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      action: jobMail.filter((m) => m.actionNeeded && !m.handled).length,
      all: jobMail.length,
    };
    for (const t of TABS) {
      if (t.key !== "action" && t.key !== "all")
        c[t.key] = jobMail.filter((m) => m.category === t.key).length;
    }
    return c;
  }, [jobMail]);

  const hidden = messages.length - jobMail.length;

  const { page, pageCount, pageItems, setPage } = usePaged(visible, PAGE_SIZE, tab);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="h1">Job Inbox</h1>
          <p className="muted mt-1">
            Your Gmail, filtered down to what matters for your job search — and you can
            reply without leaving this app.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button className="btn-primary" onClick={() => sync()} disabled={busy}>
            {busy ? "Syncing…" : lastSync ? "⟳ Sync new mail" : "⟳ Sync my inbox"}
          </button>
          <select aria-label="Rescan window"
            className="input w-auto py-2 text-xs"
            defaultValue=""
            disabled={busy}
            onChange={(e) => {
              const d = Number(e.target.value);
              e.target.value = "";
              if (d) sync({ rescanDays: d });
            }}
            title="Re-scan a full period, ignoring the sync cursor"
          >
            <option value="">Rescan…</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs text-ink-400">
        {lastSync && <span>Last synced {new Date(lastSync).toLocaleString()}</span>}
        {account && <span>· {account}</span>}
        {hidden > 0 && <span>· {hidden} non-job emails hidden</span>}
      </div>

      <RunProgress text={progress} onStop={busy ? run.cancel : undefined} />
      {notice && !busy && (
        <div className="text-sm text-neon-400 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="flex-1">{notice}</span>
          <button
            className="text-ink-400 hover:text-ink-200 shrink-0"
            onClick={() => setNotice("")}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {messages.length === 0 && !busy && (
        <div className="card-pad space-y-3">
          <h2 className="h2">Connect your inbox</h2>
          <p className="text-sm text-ink-300 leading-relaxed">
            Hit <b className="text-ink-100">Sync my inbox</b> and CareerPilot reads your
            Gmail over IMAP (read-only, using the same App Password as sending), then
            sorts everything job-related into tabs. Non-job mail is discarded, never
            shown. Nothing is stored on any server — messages live in this browser only.
          </p>
        </div>
      )}

      {/* Tabs */}
      {jobMail.length > 0 && (
        <>
          <div className="flex gap-2 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                title={t.hint}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold border transition ${
                  tab === t.key
                    ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                    : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
                }`}
              >
                {t.label}
                <span className="ml-1.5 opacity-70">{counts[t.key] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {visible.length === 0 && (
              <div className="card-pad text-sm text-ink-400">
                Nothing here right now.
              </div>
            )}
            {pageItems.map((m) => {
              const open = openUid === m.uid;
              return (
                <div
                  key={m.uid}
                  className={`card p-4 ${m.handled ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={CAT_STYLE[m.category || "not_job"]}>
                          {CAT_LABEL[m.category || "not_job"]}
                        </span>
                        {m.actionNeeded && !m.handled && (
                          <span className="badge-amber">needs action</span>
                        )}
                        {m.deadline && <span className="badge-red">⏳ {m.deadline}</span>}
                        <span className="text-[11px] text-ink-500">
                          {new Date(m.date).toLocaleString()}
                        </span>
                      </div>
                      <h3 className="font-semibold text-ink-100 mt-1.5 truncate">
                        {m.subject}
                      </h3>
                      <p className="text-xs text-ink-400 truncate">
                        {m.fromName || m.fromAddress}
                        {m.company ? ` · ${m.company}` : ""}
                        {m.role ? ` · ${m.role}` : ""}
                      </p>
                      {m.summary && (
                        <p className="text-sm text-ink-200 mt-2 leading-relaxed">
                          {m.summary}
                        </p>
                      )}
                    </div>
                    <span
                      className="text-xs text-ink-500 shrink-0"
                      title="Relevance to your job search, 0-100"
                    >
                      {m.relevance ?? 0}/100
                    </span>
                  </div>

                  <OutcomeLink message={m} />

                  <div className="flex gap-3 mt-3 flex-wrap text-xs">
                    <button
                      className="text-neon-400 hover:underline"
                      onClick={() => setOpenUid(open ? null : m.uid)}
                    >
                      {open ? "Hide email ▲" : "Read email ▼"}
                    </button>
                    <button
                      className="text-neon-400 hover:underline"
                      onClick={() => replyTo(m)}
                    >
                      ↩ Reply with AI
                    </button>
                    {!m.handled && (
                      <button
                        className="text-ink-400 hover:text-ink-200"
                        onClick={() => markHandled(m.uid)}
                      >
                        ✓ Mark handled
                      </button>
                    )}
                    <a
                      href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(
                        m.subject
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ink-400 hover:text-ink-200"
                    >
                      Open in Gmail ↗
                    </a>
                  </div>

                  {open && (
                    <pre className="prose-out card p-3 mt-3 max-h-80 overflow-auto text-[11px]">
                      {m.body || m.snippet}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>

          <Pager
            page={page}
            pageCount={pageCount}
            total={visible.length}
            unit="emails"
            onPage={(p) => {
              setPage(p);
              setOpenUid(null); // an expanded body on the page we just left
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Links an employer's reply to the application it answers, so the funnel is
 * updated from the mail itself instead of relying on remembering to do it on
 * another page. Matching is by employer, so it only offers — never records on
 * its own.
 */
function OutcomeLink({ message }: { message: InboxMessage }) {
  const [done, setDone] = useState("");
  if (message.category !== "applied_reply" || !message.company) return null;
  const matches = applicationsAt(message.company);
  if (!matches.length) return null;
  const target = matches.sort((a, b) => b.appliedAt - a.appliedAt)[0];

  if (done) {
    return (
      <p className="text-xs text-neon-400 mt-2">
        ✓ {target.title} at {target.company} marked as {done}.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap mt-2 text-xs text-ink-400">
      <span>
        Your application: <b className="text-ink-200">{target.title}</b> ({target.outcome}) — record as
      </span>
      {(["replied", "screen", "interview", "rejected"] as OutcomeStage[]).map((o) => (
        <button
          key={o}
          className="rounded-full border border-ink-700 px-2 py-0.5 hover:text-ink-100 hover:border-ink-500"
          onClick={() => {
            recordOutcome(target, o);
            setDone(o);
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
