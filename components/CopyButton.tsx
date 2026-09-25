"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

/**
 * A copy button that reports what actually happened — "Copied ✓" only when the
 * clipboard accepted the text, and a visible failure otherwise.
 */
export default function CopyButton({
  text,
  label = "Copy",
  doneLabel = "Copied ✓",
  className = "btn-secondary",
  disabled,
}: {
  text: string;
  label?: string;
  doneLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function onClick() {
    const ok = await copyText(text);
    setState(ok ? "done" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 1500 : 3000);
  }

  return (
    <button className={className} onClick={onClick} disabled={disabled} aria-live="polite">
      {state === "done" ? doneLabel : state === "failed" ? "Copy failed — select and copy by hand" : label}
    </button>
  );
}
