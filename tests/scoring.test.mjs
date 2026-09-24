import { test } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const { quickScore, requiredYears } = lib("jobScore");
const { matchesRole, htmlToText, jdExcerpt } = lib("companyBoards");
const { newClaims, confirmMarkers } = lib("claimCheck");
const { isTransactional, trimForStorage } = lib("inboxFilters");
const { safeHref } = lib("safeUrl");

const profile = {
  skills: ["React", "TypeScript", "Redux", "Tailwind CSS", "Git"],
  desiredRoles: "Frontend Engineer",
  yearsExperience: 4.5,
};

test("required years reads the floor of a range", () => {
  assert.equal(requiredYears("3-5 years of experience with React"), 3);
  assert.equal(requiredYears("Minimum 4+ yrs in frontend"), 4);
  assert.equal(requiredYears("no number here"), null);
});

test("a posting that fits scores above one that asks for far more", () => {
  const fit = quickScore(
    { title: "Frontend Engineer", description: "React, TypeScript and Redux. 3+ years experience." },
    profile
  );
  const reach = quickScore(
    { title: "Frontend Engineer", description: "React and TypeScript. 9+ years experience." },
    profile
  );
  assert.ok(fit.score > reach.score, `${fit.score} should beat ${reach.score}`);
  assert.ok(reach.cons.some((c) => /9\+ years/.test(c)));
});

test("a skill is matched as a whole term", () => {
  const s = quickScore({ title: "Engineer", description: "We use Google Cloud." }, { skills: ["Go"], yearsExperience: 3 });
  assert.ok(!s.pros.some((p) => /Go\b/.test(p)));
});

test("title matching: generic words no longer admit unrelated roles", () => {
  assert.equal(matchesRole("Salesforce Developer", ["react", "frontend", "developer"], 4), false);
  assert.equal(matchesRole("Backend Engineer", ["react", "developer"], 4), false);
  assert.equal(matchesRole("Frontend Platform Engineer", [], 4), true);
  assert.equal(matchesRole("Staff Frontend Engineer", [], 4), false);
  assert.equal(matchesRole("Staff Frontend Engineer", [], 9), true);
  assert.equal(matchesRole("Engineering Manager, Frontend", [], 12), false);
});

test("Greenhouse's escaped HTML becomes text", () => {
  assert.equal(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;React&lt;/li&gt;&lt;/ul&gt;").includes("- React"), true);
  const long = "About us. ".repeat(300) + "Requirements: 3+ years of React.";
  assert.match(jdExcerpt(long), /Requirements: 3\+ years/);
});

test("claims not in the original are reported", () => {
  const r = newClaims(
    "Built dashboards in React used by the sales team.",
    "Built React dashboards used by 200+ users, cutting load time 40% with GraphQL."
  );
  assert.ok(r.numbers.includes("200+"));
  assert.ok(r.numbers.some((n) => n.startsWith("40")));
  assert.deepEqual(r.technologies, ["GraphQL"]);
  assert.equal(confirmMarkers("Led a team [confirm: size] of 4 [confirm]"), 2);
});

test("transactional mail is filed locally, job mail never is", () => {
  assert.equal(isTransactional({ subject: "Your OTP is 123456", from: "bank", snippet: "" }), true);
  assert.equal(isTransactional({ subject: "Rs 500 debited from a/c", from: "HDFC", snippet: "" }), true);
  assert.equal(
    isTransactional({ subject: "Interview invitation", from: "hr@acme.com", snippet: "Use code 1234 to join" }),
    false
  );
});

test("storage trim empties non-job mail and caps the list", () => {
  const many = Array.from({ length: 900 }, (_, i) => ({
    uid: String(i),
    category: i % 2 ? "not_job" : "recruiter_outreach",
    body: "x".repeat(5000),
    snippet: "s",
  }));
  const out = trimForStorage(many);
  assert.equal(out.length, 800);
  assert.ok(out.every((m) => m.category !== "not_job" || m.body === ""));
  assert.ok(out.every((m) => m.body.length <= 2000));
});

test("only http(s) links become hrefs", () => {
  assert.equal(safeHref("javascript:alert(1)"), undefined);
  assert.equal(safeHref("https://boards.greenhouse.io/x"), "https://boards.greenhouse.io/x");
  assert.equal(safeHref("not a url"), undefined);
});
