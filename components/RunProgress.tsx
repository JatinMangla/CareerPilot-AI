"use client";

/** Progress for a long AI batch, with the Stop button it never had. */
export default function RunProgress({
  text,
  onStop,
}: {
  text: string;
  onStop?: () => void;
}) {
  if (!text) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 alert-success"
    >
      <span className="animate-pulse flex-1">{text}</span>
      {onStop && (
        <button className="btn-secondary text-xs px-3 py-1" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
}
