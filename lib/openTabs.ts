"use client";

/**
 * Opens a batch of application pages, one browser tab each.
 *
 * This is the replacement for bot-submitting. The agent no longer sends
 * anything on your behalf: it prepares everything, then hands you every
 * application open and ready, and you press the final button yourself. That
 * keeps the accounts safe, keeps a human on every submission, and is still
 * about twenty seconds per job instead of the five minutes it takes to find
 * the posting again and re-type the same answers.
 *
 * Every `window.open` has to happen synchronously inside the click handler.
 * Staggering them with setTimeout — the obvious way to be polite about it — is
 * exactly what makes a browser treat tabs 2..n as unsolicited pop-ups and
 * silently drop them.
 */

export interface OpenResult {
  opened: number;
  blocked: number;
}

/** Opening fifty tabs at once will wedge a laptop; this is one screen's worth. */
export const TAB_BATCH = 10;

export function openTabs(urls: string[]): OpenResult {
  let opened = 0;
  let blocked = 0;
  for (const url of urls) {
    if (!url) continue;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) opened++;
    else blocked++;
  }
  return { opened, blocked };
}

/** Message to show when the browser refused some of the tabs. */
export function blockedHint(result: OpenResult): string {
  if (!result.blocked) return "";
  return (
    `${result.opened} opened, ${result.blocked} blocked by your browser's pop-up ` +
    `blocker. Click the blocked-pop-up icon in the address bar and choose ` +
    `"Always allow pop-ups from this site", then try again.`
  );
}
