import { test } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const { diffList, hashList, applyListPatch, resolveWrite, MAX_CLOCK_SKEW_MS } = lib("syncMerge");

const now = 1_700_000_000_000;
const mail = (uid, extra = {}) => ({ uid, subject: `mail ${uid}`, ...extra });

test("two devices editing different inbox items both survive", () => {
  const base = [mail("1"), mail("2")];
  const baseHashes = hashList("cp_inbox", base);
  const stored = { value: base, at: now };

  // Phone marks mail 1 handled; laptop marks mail 2 handled.
  const phone = diffList("cp_inbox", [mail("1", { handled: true }), mail("2")], baseHashes);
  const laptop = diffList("cp_inbox", [mail("1"), mail("2", { handled: true })], baseHashes);

  const afterPhone = applyListPatch("cp_inbox", stored, phone, now);
  const afterLaptop = applyListPatch("cp_inbox", { value: afterPhone.value, at: now, tomb: afterPhone.tomb }, laptop, now);

  const byUid = Object.fromEntries(afterLaptop.value.map((m) => [m.uid, m]));
  assert.equal(byUid["1"].handled, true);
  assert.equal(byUid["2"].handled, true);
});

test("an item removed on one device is not resurrected by another", () => {
  const base = [mail("1"), mail("2")];
  const baseHashes = hashList("cp_inbox", base);
  const removal = diffList("cp_inbox", [mail("2")], baseHashes);
  assert.deepEqual(removal.removed, ["1"]);

  const afterRemoval = applyListPatch("cp_inbox", { value: base, at: now }, removal, now);
  // A device that never synced uploads its whole old list, mail 1 included.
  const stale = diffList("cp_inbox", base, undefined);
  assert.equal(stale.full, true);
  const after = applyListPatch(
    "cp_inbox",
    { value: afterRemoval.value, at: now, tomb: afterRemoval.tomb },
    stale,
    now + 1000
  );
  assert.deepEqual(after.value.map((m) => m.uid), ["2"]);
});

test("a device that saw the latest revision fast-forwards a value", () => {
  const res = resolveWrite("cp_profile", { at: now - 5000, baseRev: 3, value: { name: "new" } }, { value: { name: "old" }, at: now }, 3, now);
  assert.deepEqual(res.write.value, { name: "new" });
  assert.equal(res.adopt, undefined);
});

test("a stale device with an older clock does not overwrite a newer value", () => {
  const res = resolveWrite("cp_profile", { at: now - 5000, baseRev: 2, value: { name: "stale" } }, { value: { name: "fresh" }, at: now }, 3, now);
  assert.equal(res.write, null);
  assert.deepEqual(res.adopt.value, { name: "fresh" });
});

test("a device clock running ahead is clamped", () => {
  const future = now + 24 * 60 * 60 * 1000;
  const res = resolveWrite("cp_profile", { at: future, baseRev: 3, value: 1 }, null, 3, now);
  assert.equal(res.write.at, now + MAX_CLOCK_SKEW_MS);
});

test("a list patch against an outdated revision returns the merged list", () => {
  const stored = { value: [mail("1"), mail("9")], at: now };
  const patch = { changed: [mail("2")], removed: [] };
  const res = resolveWrite("cp_inbox", { at: now, baseRev: 1, patch }, stored, 4, now);
  assert.deepEqual(res.adopt.value.map((m) => m.uid), ["1", "9", "2"]);
});
