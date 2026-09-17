"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Slices a list into pages and keeps the page number honest.
 *
 * Callers pass the filtered list and whatever they change the filter with (a
 * tab key, a focus bucket). Two things go wrong without this: switching filters
 * leaves you on page 4 of a one-page list, and removing rows — dismissing a job,
 * marking mail handled — can shrink the list under the current page and render
 * nothing. `reset` handles the first, clamping handles the second.
 */
export function usePaged<T>(items: T[], pageSize: number, resetKey?: unknown) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );

  return { page: safePage, pageCount, pageItems, setPage, total: items.length };
}

/**
 * Page controls for the long lists (inbox mail, job matches, prepared
 * applications, the autopilot queue).
 *
 * Every list here is already fully in memory — localStorage is the source, so
 * there is nothing to fetch per page. This slices the view only, which is the
 * point: a 400-row list was mounting 400 cards, each with its own expanded
 * body and handlers, and made the page janky to scroll.
 *
 * Renders nothing for a single page, so callers can drop it in unconditionally.
 */

export function Pager({
  page,
  pageCount,
  total,
  onPage,
  unit = "items",
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (next: number) => void;
  unit?: string;
}) {
  if (pageCount <= 1) return null;

  const go = (next: number) => onPage(Math.min(Math.max(next, 1), pageCount));

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-ink-400 pt-1">
      <span>
        Page {page} of {pageCount} · {total} {unit}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          className="btn-secondary text-xs px-3 py-1.5"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
        >
          ← Prev
        </button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1 text-ink-500">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => go(p)}
              aria-current={p === page ? "page" : undefined}
              className={`min-w-[2rem] rounded-lg px-2 py-1.5 font-semibold border transition ${
                p === page
                  ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                  : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          className="btn-secondary text-xs px-3 py-1.5"
          onClick={() => go(page + 1)}
          disabled={page >= pageCount}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

/**
 * First page, last page, and the current page's neighbours — `null` marks a
 * gap. Keeps the control a fixed width instead of wrapping to three lines once
 * a 90-day rescan produces 30-odd pages.
 */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const out: (number | null)[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pageCount - 1, page + 1);
  if (from > 2) out.push(null);
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pageCount - 1) out.push(null);
  out.push(pageCount);
  return out;
}
