"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { InboxMessage, MailCategory } from "@/lib/types";

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
  const [error, setError] = useState("");
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [account, setAccount] = useState("");

  useEffect(() => {
    setMessages(store.getInbox());
    setLastSync(store.getLastSync());
  }, []);

  async function sync(full = false) {
    setError("");
    setBusy(true);
    setProgress("Connecting to Gmail…");
    try {
      const since = full ? undefined : store.getLastSync() || undefined;
      const res = await fetch("/api/inbox/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since, limit: 40 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Sync failed (${res.status})`);
        return;
      }
      setAccount(data.account || "");

      const fresh: InboxMessage[] = data.messages || [];
      if (!fresh.length) {
        store.setLastSync(data.syncedAt);
        setLastSync(data.syncedAt);
        setProgress("");
        setError("No new mail since your last sync.");
        return;
      }

      // Classify in batches so one huge AI call can't fail everything.
      setProgress(`Reading ${fresh.length} emails…`);
      const profile = store.getProfile();
      const classified: Record<string, any> = {};
      const BATCH = 12;
      for (let i = 0; i < fresh.length; i += BATCH) {
        const slice = fresh.slice(i, i + BATCH);
        setProgress(
          `Sorting job mail… ${Math.min(i + BATCH, fresh.length)}/${fresh.length}`
        );
        try {
          const out = await jsonTask<{ results: any[] }>("classify_inbox", {
            profile,
            emails: slice.map((m) => ({
              uid: m.uid,
              from: m.from,
              subject: m.subject,
              date: m.date,
              snippet: m.snippet,
            })),
          });
          for (const r of out.results || []) classified[r.uid] = r;
        } catch (err: any) {
          setError(`Some mail couldn't be sorted: ${err.message}`);
        }
      }

      const merged: InboxMessage[] = fresh.map((m) => ({
        ...m,
        ...(classified[m.uid] || { category: "not_job", relevance: 0 }),
      }));

      // keep previously synced mail, newest first, dedup by uid
      const prev = store.getInbox();
      const byUid = new Map<string, InboxMessage>();
      for (const m of [...prev, ...merged]) byUid.set(m.uid, { ...byUid.get(m.uid), ...m });
      const all = Array.from(byUid.values()).sort(
        (a, b) => +new Date(b.date) - +new Date(a.date)
      );

      store.setInbox(all);
      store.setLastSync(data.syncedAt);
      setMessages(all);
      setLastSync(data.syncedAt);
    } catch (err: any) {
      setError(err.message);
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
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => sync(false)} disabled={busy}>
            {busy ? "Syncing…" : lastSync ? "⟳ Sync new mail" : "⟳ Sync my inbox"}
          </button>
          {lastSync && (
            <button className="btn-secondary" onClick={() => sync(true)} disabled={busy}>
              Last 14 days
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs text-ink-400">
        {lastSync && <span>Last synced {new Date(lastSync).toLocaleString()}</span>}
        {account && <span>· {account}</span>}
        {hidden > 0 && <span>· {hidden} non-job emails hidden</span>}
      </div>

      {progress && (
        <div className="text-sm text-neon-400 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3 animate-pulse">
          {progress}
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
            {visible.map((m) => {
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
                    <span className="text-xs text-ink-500 shrink-0">{m.relevance ?? 0}</span>
                  </div>

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
        </>
      )}
    </div>
  );
}
