import { test } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const { fingerprint, matchesLocation, dedupeJobs, countryCode } = lib("jobFilters");

test("India filter does not take Indianapolis or Indiana for India", () => {
  assert.equal(matchesLocation("Indianapolis, IN", "India"), false);
  assert.equal(matchesLocation("Indiana, United States", "India"), false);
  assert.equal(matchesLocation("Bengaluru, Karnataka, India", "India"), true);
});

test("tier-2 Indian cities count as India", () => {
  for (const city of ["Kochi, Kerala", "Chandigarh", "Nagpur", "Vadodara", "Mysuru", "Bhubaneswar"]) {
    assert.equal(matchesLocation(city, "India"), true, city);
  }
});

test("remote roles restricted to another region are dropped for India", () => {
  assert.equal(matchesLocation("Remote - North America", "India"), false);
  assert.equal(matchesLocation("Remote (Americas)", "India"), false);
  assert.equal(matchesLocation("Remote - EU", "India"), false);
  assert.equal(matchesLocation("Anywhere, NY", "India"), false);
  assert.equal(matchesLocation("Remote - Worldwide", "India"), true);
  assert.equal(matchesLocation("Remote", "India"), true);
});

test("a city search matches its other spelling", () => {
  assert.equal(matchesLocation("Bengaluru, India", "Bangalore"), true);
  assert.equal(matchesLocation("Bangalore", "Bengaluru"), true);
  assert.equal(matchesLocation("Gurgaon, Haryana", "Gurugram"), true);
});

test("a remote US-only role does not satisfy an Indian city search", () => {
  assert.equal(matchesLocation("Remote - USA", "Bengaluru"), false);
  assert.equal(matchesLocation("Remote - India", "Bengaluru"), true);
  assert.equal(countryCode("Bengaluru"), "in");
});

test("fingerprint keeps the level, so dismissing Senior does not hide Engineer I", () => {
  const senior = fingerprint({ title: "Senior Software Engineer", company: "Acme" });
  const junior = fingerprint({ title: "Software Engineer I", company: "Acme" });
  const plain = fingerprint({ title: "Software Engineer", company: "Acme" });
  assert.notEqual(senior, junior);
  assert.notEqual(senior, plain);
});

test("fingerprint treats spellings of one level as the same job", () => {
  assert.equal(
    fingerprint({ title: "Sr. Frontend Engineer", company: "Acme" }),
    fingerprint({ title: "Senior Frontend Engineer", company: "Acme" })
  );
  assert.equal(
    fingerprint({ title: "Software Engineer 2", company: "Acme" }),
    fingerprint({ title: "Software Engineer II", company: "Acme" })
  );
  assert.equal(
    fingerprint({ title: "Frontend Engineer 123456", company: "Acme" }),
    fingerprint({ title: "Frontend Engineer", company: "Acme" })
  );
});

test("fingerprint ignores legal suffixes on the employer", () => {
  assert.equal(
    fingerprint({ title: "Frontend Engineer", company: "Razorpay" }),
    fingerprint({ title: "Frontend Engineer", company: "Razorpay Software Private Limited" })
  );
});

test("dedupe keeps the first copy", () => {
  const out = dedupeJobs([
    { title: "Senior Frontend Engineer", company: "Acme", url: "board" },
    { title: "Sr Frontend Engineer", company: "Acme Inc", url: "portal" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "board");
});
