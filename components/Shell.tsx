"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import UsageBanner from "./UsageBanner";
import SyncProvider, { SyncBadge } from "./SyncProvider";

const NAV = [
  { href: "/", label: "Dashboard", icon: "◆" },
  { href: "/resume", label: "My Resume", icon: "▤" },
  { href: "/validate", label: "Validate", icon: "✓" },
  { href: "/tailor", label: "Tailor to Job", icon: "✂" },
  { href: "/jobs", label: "Job Matches", icon: "◎" },
  { href: "/referrals", label: "Referrals", icon: "🤝" },
  { href: "/apply", label: "Apply", icon: "➤" },
  { href: "/github", label: "GitHub Review", icon: "◆" },
  { href: "/inbox", label: "Job Inbox", icon: "📥" },
  { href: "/outreach", label: "HR Outreach", icon: "✉" },
  { href: "/interview", label: "Mock Interview", icon: "🎙" },
  { href: "/practice", label: "Practice", icon: "{}" },
  { href: "/evolve", label: "Evolve AI", icon: "∞" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-neon-500/12 text-neon-400 border border-neon-500/25"
                : "text-ink-300 hover:text-ink-100 hover:bg-ink-800 border border-transparent"
            }`}
          >
            <span className="w-5 text-center text-base leading-none" aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <SyncProvider>
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-ink-800 bg-ink-900/60 backdrop-blur-sm sticky top-0 h-screen">
        {/* Logo and footer stay put; only the links scroll. */}
        <Link href="/" className="flex items-center gap-2.5 px-6 py-4 shrink-0">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-neon-500 text-ink-950 font-display font-bold text-lg shadow-glow">
            C
          </span>
          <span className="font-display font-bold text-lg tracking-tight">
            CareerPilot <span className="text-neon-400">AI</span>
          </span>
        </Link>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-4 pb-2">{nav}</div>

        <div className="shrink-0 px-4 pt-3 pb-4 border-t border-ink-800 space-y-1 bg-ink-900/60">
          <SyncBadge />
          <button onClick={() => logout()} className="btn-secondary w-full text-xs">
            Sign out
          </button>
          <button
            onClick={() => logout(true)}
            className="w-full text-[11px] text-ink-400 hover:text-ink-100 py-1"
          >
            Sign out everywhere
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-ink-900/90 backdrop-blur border-b border-ink-800">
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
          className="md:hidden fixed inset-x-0 top-[53px] bottom-0 z-40 flex flex-col bg-ink-900/95 backdrop-blur border-b border-ink-800"
        >
          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-4">{nav}</div>
          <div className="shrink-0 p-4 pt-3 border-t border-ink-800">
            <button onClick={() => logout()} className="btn-secondary w-full text-xs">
              Sign out
            </button>
            <button
              onClick={() => logout(true)}
              className="w-full text-[11px] text-ink-400 hover:text-ink-100 py-1"
            >
              Sign out everywhere
            </button>
          </div>
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
