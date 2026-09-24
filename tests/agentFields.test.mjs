import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, matchPreparedAnswer, pickOption, valueFor } from "../agent/fields.mjs";

// Each label here was once answered wrongly on a real application form.
test("trap labels are not given a wrong answer", () => {
  assert.equal(classify("Rate your proficiency in React (1-5)"), null);
  assert.equal(classify("Mobile development experience?"), null);
  assert.equal(classify("Tell us about a project you built"), null);
  assert.equal(classify("Referrer's email"), "referrer");
  assert.equal(classify("Current CTC"), "current_salary");
  assert.equal(valueFor("referrer", "Referrer's email", { screeningAnswers: [] }, { name: "A B" }), null);
  assert.equal(valueFor("current_salary", "Current CTC", { screeningAnswers: [] }, { expectedCtc: "12 LPA" }), null);
});

test("ordinary labels still classify", () => {
  assert.equal(classify("Mobile number"), "phone");
  assert.equal(classify("Expected CTC"), "salary");
  assert.equal(classify("Email *"), "email");
});

test("a work-authorization answer only matches its own country", () => {
  const qa = [{ question: "Are you authorized to work in India?", answer: "Yes", confidence: "high" }];
  assert.equal(matchPreparedAnswer("Are you authorized to work in the US?", qa), null);
  assert.ok(matchPreparedAnswer("Are you legally authorized to work in India?", qa));
});

test("dropdowns pick the option that means the answer", () => {
  assert.equal(pickOption([{ value: "a", text: "Indiana" }, { value: "b", text: "India" }], "india").value, "b");
  assert.equal(pickOption([{ value: "a", text: "Indiana" }], "india"), null);
  assert.equal(pickOption([{ value: "1", text: "1" }, { value: "2", text: "2" }], "12 lpa"), null);
  assert.equal(pickOption([{ value: "r", text: "3-5 years" }, { value: "p", text: "5+ years" }], "4").value, "r");
  assert.equal(pickOption([{ value: "r", text: "3-5 years" }, { value: "p", text: "5+ years" }], "7").value, "p");
});
