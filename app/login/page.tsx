"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("jatinmangla123@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Login failed");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-neon-500 text-ink-950 font-display font-bold text-2xl shadow-glow">
            C
          </span>
          <div>
            <div className="font-display font-bold text-2xl tracking-tight">
              CareerPilot <span className="text-neon-400">AI</span>
            </div>
            <div className="text-xs text-ink-300">Your personal AI career copilot</div>
          </div>
        </div>

        <form onSubmit={submit} className="card-pad space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-3 py-2">
              {error}
            </div>
          )}
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-[11px] text-ink-400 text-center">
            Private app — access restricted to the owner&apos;s email.
          </p>
        </form>
      </div>
    </div>
  );
}
