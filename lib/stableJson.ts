/**
 * Order-independent JSON serialisation.
 *
 * Used to key both the in-flight request dedupe (client) and the AI response
 * cache (server). `JSON.stringify` preserves insertion order, so two objects
 * with identical content but different key order would produce different keys
 * and every cache lookup would miss for no visible reason.
 *
 * Shared by both sides on purpose — a client that dedupes on one key while the
 * server caches on another is worse than neither.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",") + "}";
}
