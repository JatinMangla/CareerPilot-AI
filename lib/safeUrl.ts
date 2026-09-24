/**
 * Link targets that came from somewhere we don't control — job APIs, the AI's
 * researched leads, a synced queue — are checked before they become an href or
 * a window.open. React 18 only *warns* about `javascript:` URLs; it still
 * renders them, and one click runs the script with this app's session.
 */
export function safeHref(url: unknown): string | undefined {
  if (typeof url !== "string" || !url.trim()) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
