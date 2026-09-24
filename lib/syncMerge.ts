import { stableStringify } from "./stableJson";

/**
 * Merge rules for cross-device sync, shared by the browser (lib/store.ts) and
 * the server (app/api/state). Pure functions — no storage, no network — so the
 * rules can be tested on their own.
 *
 * Why this exists: sync used to be last-write-wins on whole values, judged by
 * each device's own clock. A list is one value, so marking an inbox mail handled
 * on the phone while the laptop fetched new mail kept only one side's change, and
 * a device whose clock ran fast won every argument. Now:
 *
 *  - every stored key carries a server-assigned revision number, so "has anyone
 *    else written this since I last saw it?" is answered by the server, not by
 *    comparing two clocks;
 *  - lists are synced as per-item patches (changed items + removed ids) against
 *    the version this device last synced, and the server applies the patch to
 *    whatever it holds — two devices editing different items both survive;
 *  - removals leave a tombstone, so a device that was offline cannot bring a
 *    removed item back by re-uploading its old copy.
 */

/** Synced lists and the field that identifies an item within each. */
export const COLLECTION_ID: Record<string, string> = {
  cp_jobs: "id",
  cp_dismissed: "fp",
  cp_apps: "jobId",
  cp_queue: "jobId",
  cp_emails: "id",
  cp_referrals: "id",
  cp_inbox: "uid",
};

export const isCollection = (key: string) => key in COLLECTION_ID;

/** How long a removal is remembered. An offline device older than this can resurrect. */
export const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** How far into the future a device's clock is trusted. */
export const MAX_CLOCK_SKEW_MS = 60 * 1000;

export type Tombstones = Record<string, number>;

export interface Envelope {
  value: unknown;
  at: number;
  /** Lists only: id → when it was removed. */
  tomb?: Tombstones;
}

export interface ListPatch {
  changed: unknown[];
  removed: string[];
  /**
   * The device had no record of a previous sync, so this is its whole list
   * rather than a diff. The merged result then differs from what it holds.
   */
  full?: boolean;
}

/** One key as a device sends it. `patch` for lists, `value` for everything else. */
export interface IncomingEntry {
  at: number;
  /** The server revision this device last synced. Absent from pre-revision clients. */
  baseRev?: number;
  value?: unknown;
  patch?: ListPatch;
}

export function itemId(key: string, item: unknown): string | null {
  const field = COLLECTION_ID[key];
  if (!field || !item || typeof item !== "object") return null;
  const id = (item as Record<string, unknown>)[field];
  return id === undefined || id === null || id === "" ? null : String(id);
}

/** Short, stable fingerprint of one item's content (FNV-1a over its canonical JSON). */
export function itemHash(item: unknown): string {
  const s = stableStringify(item);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** id → hash for every item in a list — what a device remembers as "last synced". */
export function hashList(key: string, list: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const id = itemId(key, item);
    if (id !== null) out[id] = itemHash(item);
  }
  return out;
}

/**
 * What changed in a list since it was last synced. With no record of a last
 * sync, everything counts as changed and nothing as removed — the safe reading,
 * since the server applies it as a union.
 */
export function diffList(
  key: string,
  current: unknown,
  base: Record<string, string> | undefined
): ListPatch {
  const items = Array.isArray(current) ? current : [];
  if (!base) return { changed: items, removed: [], full: true };
  const present = new Set<string>();
  const changed: unknown[] = [];
  for (const item of items) {
    const id = itemId(key, item);
    if (id === null) continue;
    present.add(id);
    if (base[id] !== itemHash(item)) changed.push(item);
  }
  const removed = Object.keys(base).filter((id) => !present.has(id));
  return { changed, removed };
}

function pruneTomb(tomb: Tombstones, now: number): Tombstones {
  const out: Tombstones = {};
  for (const [id, at] of Object.entries(tomb)) {
    if (now - at < TOMBSTONE_TTL_MS) out[id] = at;
  }
  return out;
}

/**
 * Applies a device's patch to the stored list. Changed items replace their
 * stored copy (or are appended); removed ids are dropped and tombstoned; nothing
 * tombstoned survives. Order: stored order, with new items at the end — the
 * pages sort lists themselves, so this only has to be stable.
 */
export function applyListPatch(
  key: string,
  stored: Envelope | null,
  patch: ListPatch,
  now: number
): { value: unknown[]; tomb: Tombstones } {
  const tomb = pruneTomb({ ...(stored?.tomb || {}) }, now);
  for (const id of patch.removed) tomb[id] = now;

  const base = Array.isArray(stored?.value) ? (stored!.value as unknown[]) : [];
  const changedById = new Map<string, unknown>();
  for (const item of patch.changed) {
    const id = itemId(key, item);
    if (id !== null) changedById.set(id, item);
  }

  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const item of base) {
    const id = itemId(key, item);
    if (id === null) continue;
    if (tomb[id] || seen.has(id)) continue;
    seen.add(id);
    out.push(changedById.get(id) ?? item);
  }
  for (const [id, item] of Array.from(changedById)) {
    if (!seen.has(id) && !tomb[id]) {
      seen.add(id);
      out.push(item);
    }
  }
  return { value: out, tomb };
}

export interface Resolution {
  /** What to store, or null when the stored copy stands. */
  write: Envelope | null;
  /**
   * The value the device should now hold, when it differs from what it sent —
   * another device's changes were merged in, or the stored copy won.
   */
  adopt?: { value: unknown; at: number };
}

/** Decides what one incoming key does to the stored copy. */
export function resolveWrite(
  key: string,
  incoming: IncomingEntry,
  stored: Envelope | null,
  storedRev: number,
  now: number
): Resolution {
  // A device whose clock runs ahead would otherwise win every future comparison.
  const at = Math.min(Number(incoming.at) || 0, now + MAX_CLOCK_SKEW_MS);
  const legacy = incoming.baseRev === undefined;
  const upToDate = !legacy && incoming.baseRev === storedRev;

  if (isCollection(key) && incoming.patch) {
    const { value, tomb } = applyListPatch(key, stored, incoming.patch, now);
    const env: Envelope = { value, at: Math.max(at, stored?.at ?? 0), tomb };
    // Up to date, with a real diff, means the device already holds the result.
    return upToDate && !incoming.patch.full
      ? { write: env }
      : { write: env, adopt: { value, at: env.at } };
  }

  // Whole values: a device that saw the latest revision simply moves it forward.
  // Only when two devices both changed it since is there a real conflict, and
  // only then does the (clamped) clock decide.
  if (!stored || upToDate || at >= stored.at) {
    return { write: { value: incoming.value, at } };
  }
  return { write: null, adopt: { value: stored.value, at: stored.at } };
}
