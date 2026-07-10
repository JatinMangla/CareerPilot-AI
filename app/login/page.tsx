"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "otp-send" | "otp-verify" | "password";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("otp-send");
  const [email, setEmail] = useState("jatinmangla123@gmail.com");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send the code.");
        return;
      }
      setSentTo(data.sentTo || "your email");
      setMode("otp-verify");
      setCooldown(60);
      setInfo(`Code sent to ${data.sentTo} — check inbox & spam.`);
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid code");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function passwordLogin(e: React.FormEvent) {
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

        <div className="card-pad space-y-4">
          {mode === "otp-send" && (
            <>
              <div>
                <label className="label">Your email</label>
                <input className="input" type="email" value={email} readOnly />
              </div>
              <button className="btn-primary w-full" onClick={sendCode} disabled={loading}>
                {loading ? "Sending…" : "✉ Email me a login code"}
              </button>
              <p className="text-[11px] text-ink-400 text-center">
                No password needed — a 6-digit code lands in your inbox and you&apos;re in
                for 30 days.
              </p>
            </>
          )}

          {mode === "otp-verify" && (
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <label className="label">Enter the 6-digit code sent to {sentTo}</label>
                <input
                  className="input text-center text-2xl tracking-[0.5em] font-mono"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  required
                />
              </div>
              <button className="btn-primary w-full" disabled={loading || code.length !== 6}>
                {loading ? "Verifying…" : "Sign in"}
              </button>
              <button
                type="button"
                className="text-xs text-ink-300 hover:text-neon-400 w-full text-center"
                onClick={sendCode}
                disabled={cooldown > 0 || loading}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
            </form>
          )}

          {mode === "password" && (
            <form onSubmit={passwordLogin} className="space-y-4">
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
                  autoComplete="current-password"
                  required
                />
              </div>
              <button className="btn-primary w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in with password"}
              </button>
            </form>
          )}

          {info && (
            <div className="text-xs text-neon-400 bg-neon-500/10 border border-neon-500/25 rounded-xl px-3 py-2">
              {info}
            </div>
          )}
          {error && (
            <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <div className="pt-1 border-t border-ink-800 text-center">
            {mode === "password" ? (
              <button
                className="text-xs text-ink-300 hover:text-neon-400"
                onClick={() => {
                  setMode("otp-send");
                  setError("");
                }}
              >
                ← Use email code instead (no password)
              </button>
            ) : (
              <button
                className="text-xs text-ink-400 hover:text-ink-200"
                onClick={() => {
                  setMode("password");
                  setError("");
                  setInfo("");
                }}
              >
                Use password instead (backup)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
