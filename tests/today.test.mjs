import { test } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const { buildToday, appliedKeys } = lib("today");

const DAY = 86_400_000;
const now = 1_800_000_000_000;
const empty = { inbox: [], emails: [], queue: [], apps: [], referrals: [], jobs: [] };
const keys = (d) => buildToday({ ...empty, ...d }, now).map((i) => i.key);

const job = (over = {}) => ({
  id: "1",
  title: "Frontend Engineer",
  company: "Acme",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  source: "company-boards",
  matchScore: 85,
  aiScored: true,
  postedAt: new Date(now - DAY).toISOString(),
  ...over,
});

test("nothing to do reads as nothing", () => {
  assert.deepEqual(buildToday(empty, now), []);
});

test("handled and non-job mail needs nothing", () => {
  assert.deepEqual(
    keys({
      inbox: [
        { actionNeeded: true, handled: true, category: "applied_reply" },
        { actionNeeded: true, category: "not_job" },
      ],
    }),
    []
  );
});

test("a recruiter is named ahead of an automated alert", () => {
  const [item] = buildToday(
    {
      ...empty,
      inbox: [
        { actionNeeded: true, category: "job_alert", subject: "Daily digest" },
        { actionNeeded: true, category: "recruiter_outreach", company: "Stripe", subject: "Hi" },
      ],
    },
    now
  );
  assert.equal(item.count, 2);
  assert.match(item.detail, /Stripe/);
});

test("an application is quiet only past the window and only if nothing came back", () => {
  const app = (at, outcome = "applied") => ({ jobId: "a", jobTitle: "x", company: "y", status: "applied", at, outcome, outcomeAt: at });
  assert.deepEqual(keys({ apps: [app(now - 3 * DAY)] }), []);
  assert.deepEqual(keys({ apps: [app(now - 20 * DAY, "interview")] }), []);
  assert.deepEqual(keys({ apps: [app(now - 20 * DAY)] }), ["quiet"]);
});

test("a follow-up is due only once its date has passed", () => {
  assert.deepEqual(keys({ emails: [{ followUpDue: now + DAY }] }), []);
  assert.deepEqual(keys({ emails: [{ followUpDue: now - DAY }] }), ["followup"]);
});

test("a fresh strong match counts only if it can still be acted on", () => {
  assert.deepEqual(keys({ jobs: [job()] }), ["fresh"]);
  assert.deepEqual(keys({ jobs: [job({ aiScored: false })] }), []);
  assert.deepEqual(keys({ jobs: [job({ matchScore: 60 })] }), []);
  assert.deepEqual(keys({ jobs: [job({ source: "ai-researched" })] }), []);
  assert.deepEqual(keys({ jobs: [job({ postedAt: new Date(now - 30 * DAY).toISOString() })] }), []);
});

test("a job already in the pipeline is not offered again, under any id", () => {
  assert.deepEqual(keys({ jobs: [job()], queue: [{ jobId: "1", status: "planning", title: "x", company: "y" }] }), []);
  const applied = { jobId: "old", jobTitle: "Frontend Engineer", company: "Acme Inc", status: "applied", at: now };
  assert.ok(appliedKeys([applied], []).size === 1);
  assert.deepEqual(keys({ jobs: [job({ id: "new" })], apps: [applied] }), []);
});
