"use client";

/**
 * Copies text, and says whether it worked.
 *
 * `navigator.clipboard.writeText` was called without await or catch in six
 * places, and every one showed "Copied ✓" regardless. It rejects when the page
 * lacks focus, on an insecure origin, or when the browser denies permission —
 * and the user then pasted nothing into an application form. The textarea
 * fallback covers browsers where the async API is unavailable.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
