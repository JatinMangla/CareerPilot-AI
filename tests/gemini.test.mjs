import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { lib } from "./helpers.mjs";

const { geminiJson, geminiStream, STREAM_META } = lib("gemini");

const realFetch = globalThis.fetch;
const schema = { type: "object", properties: { ok: { type: "boolean" } } };

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test";
  delete process.env.GEMINI_MODEL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_URL;
  // The chain logs each fallback; that is expected noise here.
  console.error = () => {};
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers each call in turn, recording which model it asked for. */
function script(...answers) {
  const models = [];
  globalThis.fetch = async (url) => {
    models.push(/models\/([^:]+):/.exec(String(url))?.[1]);
    const next = answers[Math.min(models.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
  return models;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const answer = (text, finishReason = "STOP") =>
  json({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

function sse(frames, end = "\n\n") {
  return new Response(frames.map((f) => `data: ${JSON.stringify(f)}`).join("\n\n") + end, { status: 200 });
}
const token = (text, finishReason) => ({
  candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
});

async function readAll(stream) {
  return new Response(stream).text();
}

test("a retired model does not end the chain", async () => {
  const models = script(json({ error: { message: "no longer available" } }, 404), answer('{"ok":true}'));
  const out = await geminiJson("s", "u", 100, schema, "standard");
  assert.equal(out.json, '{"ok":true}');
  assert.equal(out.fallback, true);
  assert.equal(models.length, 2);
  assert.notEqual(models[0], models[1]);
});

test("a real request error stops at once", async () => {
  const models = script(json({ error: { message: "bad schema" } }, 400));
  await assert.rejects(geminiJson("s", "u", 100, schema, "standard"), /Gemini error 400/);
  assert.equal(models.length, 1);
});

test("truncated JSON tries the next model instead of failing as malformed", async () => {
  const models = script(answer('{"ok":tr', "MAX_TOKENS"), answer('{"ok":true}'));
  const out = await geminiJson("s", "u", 100, schema, "standard");
  assert.equal(out.json, '{"ok":true}');
  assert.equal(models.length, 2);
});

test("every model truncating says so plainly", async () => {
  script(() => answer('{"ok":tr', "MAX_TOKENS"));
  await assert.rejects(geminiJson("s", "u", 100, schema, "standard"), /ran out of room/);
});

test("every model timing out reads as a timeout, not a status code", async () => {
  script(new DOMException("timed out", "TimeoutError"));
  await assert.rejects(geminiJson("s", "u", 100, schema, "standard"), /took too long/);
});

test("a finished stream ends with a STOP trailer", async () => {
  script(sse([token("Hello "), token("world", "STOP")]));
  const out = await readAll(geminiStream("s", "u", 100, "deep"));
  assert.match(out, /^Hello world\n/);
  assert.match(out, /"finish":"STOP"/);
});

test("an upstream that ends without a finishReason is not marked complete", async () => {
  script(sse([token("Half a resu")]));
  const out = await readAll(geminiStream("s", "u", 100, "deep"));
  assert.ok(out.includes(STREAM_META));
  assert.match(out, /"finish":"DROPPED"/);
});

test("the final frame counts even with no trailing blank line", async () => {
  script(sse([token("Done", "STOP")], ""));
  const out = await readAll(geminiStream("s", "u", 100, "deep"));
  assert.match(out, /"finish":"STOP"/);
});

test("a stream that fails before its first token tries the next model", async () => {
  const models = script(new TypeError("fetch failed"), sse([token("Hi", "STOP")]));
  const out = await readAll(geminiStream("s", "u", 100, "deep"));
  assert.match(out, /^Hi\n/);
  assert.equal(models.length, 2);
});

test("a stream on a retired model falls through too", async () => {
  const models = script(json({}, 404), sse([token("Hi", "STOP")]));
  const out = await readAll(geminiStream("s", "u", 100, "deep"));
  assert.match(out, /^Hi\n/);
  assert.equal(models.length, 2);
});
