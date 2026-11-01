"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import UsageBanner from "./UsageBanner";
import SyncProvider, { SyncBadge } from "./SyncProvider";
import Icon, { type IconName } from "./Icon";
import { store } from "@/lib/store";

/** In the order a job hunt actually runs, rather than one flat list of thirteen. */
const NAV: { group?: string; items: { href: string; label: string; icon: IconName }[] }[] = [
  { items: [{ href: "/", label: "Today", icon: "home" }] },
  {
    group: "Resume",
    items: [
      { href: "/resume", label: "My Resume", icon: "file" },
      { href: "/validate", label: "Validate", icon: "check" },
      { href: "/tailor", label: "Tailor to Job", icon: "scissors" },
    ],
  },
  {
    group: "Find & apply",
    items: [
      { href: "/jobs", label: "Job Matches", icon: "target" },
      { href: "/referrals", label: "Referrals", icon: "people" },
      { href: "/apply", label: "Apply", icon: "send" },
    ],
  },
  {
    group: "Follow up",
    items: [
      { href: "/inbox", label: "Job Inbox", icon: "inbox" },
      { href: "/outreach", label: "HR Outreach", icon: "mail" },
    ],
  },
  {
    group: "Get better",
    items: [
      { href: "/interview", label: "Mock Interview", icon: "mic" },
      { href: "/practice", label: "Practice", icon: "terminal" },
      { href: "/github", label: "GitHub Review", icon: "code" },
      { href: "/evolve", label: "Evolve AI", icon: "spark" },
    ],
  },
  { group: "You", items: [{ href: "/profile", label: "Profile & data", icon: "user" }] },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);

  // Every page shared one title, so a row of open tabs told you nothing. Rendered
  // here, and React 19 lifts it into <head>. Setting document.title in an effect
  // lost to the metadata title, which streams in after hydration, so the layout
  // declares none.
  const page = ALL_ITEMS.find((i) => isActive(i.href, pathname));
  const title =
    pathname === "/login"
      ? "Sign in · CareerPilot"
      : page && page.href !== "/"
      ? `${page.label} · CareerPilot`
      : "CareerPilot AI";

  useEffect(() => {
    if (pathname === "/login") return;
    setInboxCount(
      store.getInbox().filter((m) => m.actionNeeded && !m.handled && m.category !== "not_job").length
    );
  }, [pathname]);

  async function logout(everywhere = false) {
    if (everywhere && !confirm("Sign out on every device, including this one?")) return;
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ everywhere }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.error) alert(data.error);
    } catch {
      // Offline: the server could not revoke anything, but leaving this page
      // is still the right outcome — the next request will need a login.
    }
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-4" aria-label="Main">
      {NAV.map((section, i) => (
        <div key={section.group ?? i} className="flex flex-col gap-0.5">
          {section.group && (
            <div className="px-3.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {section.group}
            </div>
          )}
          {section.items.map((item) => {
            const active = isActive(item.href, pathname);
            const count = item.href === "/inbox" ? inboxCount : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-neon-500/12 text-neon-400"
                    : "text-ink-300 hover:text-ink-100 hover:bg-ink-800"
                }`}
              >
                <Icon name={item.icon} />
                <span className="flex-1">{item.label}</span>
                {count > 0 && (
                  <span
                    className="min-w-5 rounded-full bg-coral-500/20 px-1.5 text-center text-[11px] font-semibold text-coral-400"
                    aria-label={`${count} need action`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  if (pathname === "/login") {
    return (
      <>
        <title>{title}</title>
        {children}
      </>
    );
  }

  const account = (
    <>
      <button onClick={() => logout()} className="btn-secondary w-full text-xs">
        Sign out
      </button>
      <button
        onClick={() => logout(true)}
        className="w-full text-[11px] text-ink-400 hover:text-ink-100 py-1"
      >
        Sign out everywhere
      </button>
    </>
  );

  return (
    <SyncProvider>
    <title>{title}</title>
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-ink-800 bg-ink-900/60 sticky top-0 h-screen">
        {/* Logo and footer stay put; only the links scroll. */}
        <Link href="/" className="flex items-center gap-2.5 px-5 py-4 shrink-0">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-neon-500 text-ink-950 font-display font-bold">
            C
          </span>
          <span className="font-display font-bold tracking-tight">
            CareerPilot <span className="text-neon-400">AI</span>
          </span>
        </Link>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-3 pb-3">{nav}</div>

        <div className="shrink-0 px-3 pt-3 pb-3 border-t border-ink-800 space-y-1">
          <SyncBadge />
          {account}
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-ink-900/95 border-b border-ink-800">
        <Link href="/" className="font-display font-bold">
          CareerPilot <span className="text-neon-400">AI</span>
        </Link>
        <button
          onClick={() => setOpen(!open)}
          className="btn-secondary px-3 py-1.5 text-xs"
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <div
          id="mobile-nav"
          className="md:hidden fixed inset-x-0 top-[53px] bottom-0 z-40 flex flex-col bg-ink-900"
        >
          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-4">{nav}</div>
          <div className="shrink-0 p-4 pt-3 border-t border-ink-800 space-y-1">{account}</div>
        </div>
      )}

      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-6xl">
        <UsageBanner />
        <div className="md:hidden mb-3">
          <SyncBadge />
        </div>
        {children}
      </main>
    </div>
    </SyncProvider>
  );
}
