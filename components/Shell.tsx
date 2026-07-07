"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import UsageBanner from "./UsageBanner";

const NAV = [
  { href: "/", label: "Dashboard", icon: "◆" },
  { href: "/resume", label: "My Resume", icon: "▤" },
  { href: "/validate", label: "Validate", icon: "✓" },
  { href: "/tailor", label: "Tailor to Job", icon: "✂" },
  { href: "/jobs", label: "Job Matches", icon: "◎" },
  { href: "/auto-apply", label: "Auto-Apply", icon: "➤" },
  { href: "/interview", label: "Mock Interview", icon: "🎙" },
  { href: "/practice", label: "Practice", icon: "{}" },
  { href: "/evolve", label: "Evolve AI", icon: "∞" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (pathname === "/login") {
    return <>{children}</>;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
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
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-neon-500/12 text-neon-400 border border-neon-500/25"
                : "text-ink-300 hover:text-ink-100 hover:bg-ink-800 border border-transparent"
            }`}
          >
            <span className="w-5 text-center text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-ink-800 bg-ink-900/60 backdrop-blur-sm p-4 sticky top-0 h-screen">
        <Link href="/" className="flex items-center gap-2.5 px-2 py-3 mb-4">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-neon-500 text-ink-950 font-display font-bold text-lg shadow-glow">
            C
          </span>
          <span className="font-display font-bold text-lg tracking-tight">
            CareerPilot <span className="text-neon-400">AI</span>
          </span>
        </Link>
        {nav}
        <div className="mt-auto pt-4 border-t border-ink-800">
          <button onClick={logout} className="btn-secondary w-full text-xs">
            Sign out
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
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <div className="md:hidden fixed inset-x-0 top-[53px] z-40 bg-ink-900/95 backdrop-blur border-b border-ink-800 p-4">
          {nav}
          <button onClick={logout} className="btn-secondary w-full text-xs mt-3">
            Sign out
          </button>
        </div>
      )}

      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-6xl">
        <UsageBanner />
        {children}
      </main>
    </div>
  );
}
