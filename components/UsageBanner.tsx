"use client";

import { useEffect, useState } from "react";
import { quota, type QuotaInfo } from "@/lib/quota";

export default function UsageBanner() {
  const [warnings, setWarnings] = useState<QuotaInfo[]>([]);

  useEffect(() => {
    const check = () =>
      setWarnings(quota.all().filter((q) => q.used >= q.limit * q.warnAt));
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  if (warnings.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {warnings.map((q) => {
        const over = q.used >= q.limit;
        return (
          <div
            key={q.key}
            className={`text-xs rounded-xl px-4 py-2.5 border ${
              over
                ? "text-coral-400 bg-coral-500/10 border-coral-500/30"
                : "text-amberx-400 bg-amberx-500/10 border-amberx-500/30"
            }`}
          >
            {over ? "⛔" : "⚠️"} <b>{q.label}:</b> {q.used}/{q.limit} used this{" "}
            {q.period}.{" "}
            {over
              ? `Paused until next ${q.period} to keep you on the free tier — no bill will be generated.`
              : `Approaching the free limit — slow down to stay free.`}
          </div>
        );
      })}
    </div>
  );
}
