#!/usr/bin/env node
/**
 * CareerPilot Auto-Apply Agent
 * ----------------------------
 * Submits your prepared applications on OFFICIAL company career sites
 * (Greenhouse, Lever, Ashby, Workable and similar ATS forms).
 *
 * Runs locally, in a visible browser, on your machine — you can watch every
 * keystroke and take over at any point.
 *
 *   npm run apply                 # dry run: fills + screenshots, submits nothing
 *   npm run apply -- --submit     # actually submits (only where safe)
 *   npm run apply -- --only=Infosys
 *   npm run apply -- --headless
 *
 * Never touches LinkedIn / Naukri / Indeed — their terms forbid automated
 * submission and accounts get banned for it.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { classify, valueFor, matchPreparedAnswer, SKIP_INTENTS } from "./fields.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = path.join(HERE, "apply-queue.json");
const RESULTS_FILE = path.join(HERE, "results.json");
const SHOTS_DIR = path.join(HERE, "screenshots");

const AUTO_SUBMIT_ATS = new Set(["greenhouse", "lever", "ashby", "workable"]);
const BLOCKED_HOSTS = [
  "linkedin.",
  "naukri.",
  "indeed.",
  "glassdoor.",
  "monster.",
  "shine.",
  "foundit.",
  "instahyre.",
  "cutshort.",
  "hirist.",
  "wellfound.",
];

const args = process.argv.slice(2);
const DO_SUBMIT = args.includes("--submit");
const HEADLESS = args.includes("--headless");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").split("=")[1];

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function log(...a) {
  console.log(...a);
}

/* ------------------------------------------------------------------ */
/* Page inspection: tag every visible field and read its real label    */
/* ------------------------------------------------------------------ */

async function inspectFields(page) {
  return page.evaluate(() => {
    const out = [];
    const els = Array.from(document.querySelectorAll("input, textarea, select"));
    let idx = 0;
    for (const el of els) {
      const type = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) continue;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible =
        (rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none") ||
        type === "file";
      if (!visible) continue;
      if (el.disabled || el.readOnly) continue;

      let label = "";
      if (el.id) {
        const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (l) label = l.innerText || "";
      }
      if (!label) {
        const wrap = el.closest("label");
        if (wrap) label = wrap.innerText || "";
      }
      if (!label && el.getAttribute("aria-labelledby")) {
        const ref = document.getElementById(el.getAttribute("aria-labelledby"));
        if (ref) label = ref.innerText || "";
      }
      if (!label) label = el.getAttribute("aria-label") || "";
      if (!label) label = el.getAttribute("placeholder") || "";
      if (!label) {
        // radios/checkboxes: use the group's legend so we know what's being asked
        const fs = el.closest("fieldset");
        const legend = fs && fs.querySelector("legend");
        if (legend) label = legend.innerText || "";
      }
      if (!label) {
        const group = el.closest("div, fieldset, li, section, p");
        if (group) {
          const txt = (group.innerText || "")
            .trim()
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)[0];
          if (txt) label = txt;
        }
      }
      if (!label) label = el.getAttribute("name") || "";

      // for radios/checkboxes also record the option's own text
      let optionLabel = "";
      if (type === "radio" || type === "checkbox") {
        const wrap = el.closest("label");
        optionLabel = (wrap ? wrap.innerText : "") || el.getAttribute("value") || "";
        const fs = el.closest("fieldset");
        const legend = fs && fs.querySelector("legend");
        if (legend) label = legend.innerText || label;
      }

      el.setAttribute("data-cp-idx", String(idx));
      out.push({
        idx,
        tag: el.tagName.toLowerCase(),
        type,
        name: el.getAttribute("name") || "",
        label: String(label).replace(/\s+/g, " ").trim().slice(0, 160),
        optionLabel: String(optionLabel).replace(/\s+/g, " ").trim().slice(0, 80),
        required: el.required || el.getAttribute("aria-required") === "true",
        options:
          el.tagName.toLowerCase() === "select"
            ? Array.from(el.options).map((o) => ({
                value: o.value,
                text: (o.text || "").trim(),
              }))
            : [],
      });
      idx++;
    }
    return out;
  });
}

async function hasCaptcha(page) {
  return page.evaluate(() => {
    const sel = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      '.g-recaptcha',
      '#cf-turnstile',
      '[data-sitekey]',
    ];
    return sel.some((s) => document.querySelector(s));
  });
}

/** Some ATS pages show the job description first — open the real form. */
async function openApplicationForm(page) {
  const already = await page
    .locator('input[type="file"], input[name*="resume" i], input[id*="first_name" i]')
    .count()
    .catch(() => 0);
  if (already > 0) return;

  const candidates = [
    'a:has-text("Apply for this job")',
    'button:has-text("Apply for this job")',
    'a:has-text("Apply now")',
    'button:has-text("Apply now")',
    'a:has-text("Apply")',
    'button:has-text("Apply")',
    '#apply_button',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      await el.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1800);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Filling                                                             */
/* ------------------------------------------------------------------ */

async function fillForm(page, app, profile, resumePath, report) {
  const fields = await inspectFields(page);
  log(c.dim(`   found ${fields.length} fillable fields`));

  for (const f of fields) {
    const loc = page.locator(`[data-cp-idx="${f.idx}"]`).first();
    if ((await loc.count()) === 0) continue;

    /* ---- resume / file uploads ---- */
    if (f.type === "file") {
      const haystack = `${f.label} ${f.name}`;
      // Positive match only. The old rule was "anything not labelled cover", so
      // a "Portfolio (PDF)" or "Transcript" input received the resume — and if
      // it appeared first, the real resume field was left empty while the run
      // still counted an upload and passed the submit gate.
      const isResume = /\b(resume|cv|curriculum\s*vitae)\b/i.test(haystack);
      const isCover = /\bcover\s*letter\b/i.test(haystack);

      if (isResume && resumePath) {
        try {
          await loc.setInputFiles(resumePath, { timeout: 15000 });
          report.filled.push({ field: f.label || "resume", value: "<resume PDF>" });
          log(c.green(`   ✓ uploaded resume → "${f.label || f.name}"`));
        } catch {
          report.needsYou.push({ field: f.label || "resume", why: "resume upload failed" });
          log(c.amber(`   ⚠ resume upload failed → "${f.label || f.name}"`));
        }
      } else if (!isCover) {
        // Some other attachment we can't identify — never guess with a file.
        report.needsYou.push({
          field: f.label || f.name || "file upload",
          why: "unrecognised file field",
        });
        log(c.amber(`   ⚠ unknown file field, left empty: "${(f.label || f.name).slice(0, 60)}"`));
      }
      continue;
    }

    const intent = classify(f.label || f.name);

    /* ---- yes/no radios & checkboxes ---- */
    if (f.type === "radio" || f.type === "checkbox") {
      if (SKIP_INTENTS.has(intent)) continue; // voluntary demographic questions
      const prepared = matchPreparedAnswer(f.label || f.name, app.screeningAnswers);
      if (!prepared) {
        if (f.required) {
          report.needsYou.push({ field: f.label || f.name, why: "unanswered choice" });
        }
        continue;
      }
      const wantsYes = /^\s*(yes|true|i am|authorized|indian citizen)/i.test(prepared.answer);
      const optionText = (f.optionLabel || "").toLowerCase();
      const isYesOption = /\byes\b/.test(optionText);
      const isNoOption = /\bno\b/.test(optionText);
      if ((wantsYes && isYesOption) || (!wantsYes && isNoOption)) {
        if (prepared.confidence !== "high") {
          report.needsYou.push({ field: f.label, why: "low-confidence choice" });
          continue;
        }
        await loc.check({ timeout: 5000 }).catch(() => {});
        report.filled.push({ field: f.label, value: wantsYes ? "Yes" : "No" });
        log(c.green(`   ✓ ${wantsYes ? "Yes" : "No"} → "${(f.label || "").slice(0, 60)}"`));
      }
      continue;
    }

    /* ---- selects ---- */
    if (f.tag === "select") {
      if (SKIP_INTENTS.has(intent)) continue;
      const decided = valueFor(intent, f.label || f.name, app, profile);
      const prepared = matchPreparedAnswer(f.label || f.name, app.screeningAnswers);
      const want = (decided?.value || prepared?.answer || "").toLowerCase();
      if (!want) continue;
      const opts = f.options || [];
      const match = opts.find(
        (o) =>
          o.text && o.text.toLowerCase() !== "" && want.includes(o.text.toLowerCase())
      ) ||
        f.options.find(
          (o) => o.text && o.text.toLowerCase().length > 1 && want.startsWith(o.text.toLowerCase().slice(0, 3))
        );
      if (match) {
        await loc.selectOption({ value: match.value }).catch(() => {});
        report.filled.push({ field: f.label, value: match.text });
        log(c.green(`   ✓ "${match.text}" → "${f.label.slice(0, 60)}"`));
      } else if (f.required) {
        report.needsYou.push({ field: f.label, why: "no matching option" });
      }
      continue;
    }

    /* ---- text inputs & textareas ---- */
    const decided = valueFor(intent, f.label || f.name, app, profile);
    if (!decided || !decided.value) {
      // Flag ANY field we couldn't answer, not just ones carrying the `required`
      // attribute. Greenhouse/Lever/Ashby usually mark required fields with a
      // visual asterisk and validate in JavaScript, so keying off `required`
      // meant unanswered mandatory questions never reached needsYou — and the
      // submit gate happily fired on name + email + resume alone.
      report.needsYou.push({
        field: f.label || f.name || `field #${f.idx}`,
        why: f.required ? "required, no confident answer" : "unrecognised field",
      });
      log(c.amber(`   ⚠ needs you: "${(f.label || f.name || "").slice(0, 70)}"`));
      continue;
    }
    if (decided.confidence !== "high") {
      report.needsYou.push({ field: f.label || f.name, why: "low confidence" });
      log(c.amber(`   ⚠ low confidence, left blank: "${(f.label || f.name).slice(0, 60)}"`));
      continue;
    }

    try {
      await loc.fill(String(decided.value), { timeout: 8000 });
      report.filled.push({
        field: f.label || f.name,
        value: String(decided.value).slice(0, 60),
      });
      log(c.green(`   ✓ "${(f.label || f.name).slice(0, 50)}"`));
    } catch {
      report.skipped.push({ field: f.label || f.name, why: "not fillable" });
    }
  }
}

async function findSubmitButton(page) {
  const sels = [
    'button:has-text("Submit application")',
    'button:has-text("Submit Application")',
    'input[type="submit"][value*="Submit" i]',
    'button:has-text("Submit")',
    'button:has-text("Send application")',
    'button[type="submit"]',
  ];
  for (const s of sels) {
    const el = page.locator(s).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) return el;
  }
  return null;
}

async function looksSubmitted(page) {
  return page
    .evaluate(() => {
      const t = (document.body.innerText || "").toLowerCase();
      return /thank you|application (has been )?(received|submitted)|we('| ha)ve received|successfully (applied|submitted)|thanks for applying/.test(
        t
      );
    })
    .catch(() => false);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  if (!fs.existsSync(QUEUE_FILE)) {
    log(c.red(`\n✖ ${path.basename(QUEUE_FILE)} not found in ${HERE}`));
    log(`  Export it from the Auto-Pilot page, then move it into this folder.\n`);
    process.exit(1);
  }

  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  const profile = queue.profile || {};
  let apps = queue.applications || [];
  if (ONLY) {
    const needle = ONLY.toLowerCase();
    apps = apps.filter(
      (a) =>
        a.company.toLowerCase().includes(needle) || a.title.toLowerCase().includes(needle)
    );
  }

  if (!apps.length) {
    log(c.amber("\nNothing to do — queue is empty (or --only matched nothing).\n"));
    return;
  }

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "careerpilot-"));

  log(c.bold(`\n🚀 CareerPilot Auto-Apply Agent`));
  log(`   Applications: ${c.cyan(apps.length)}`);
  log(
    `   Mode: ${
      DO_SUBMIT ? c.green("LIVE — will submit where safe") : c.amber("DRY RUN — fills only, submits nothing")
    }`
  );
  log(c.dim(`   Screenshots → ${SHOTS_DIR}\n`));

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 60 });
  const context = await browser.newContext({
    viewport: { width: 1380, height: 900 },
    acceptDownloads: false,
  });

  const results = [];

  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    const tag = `${i + 1}/${apps.length}`;
    log(c.bold(`\n[${tag}] ${app.title} @ ${app.company}`));
    log(c.dim(`      ${app.url}`));

    const report = {
      jobId: app.jobId,
      company: app.company,
      title: app.title,
      url: app.url,
      ats: app.ats,
      filled: [],
      skipped: [],
      needsYou: [],
      status: "pending",
      screenshot: "",
    };

    // Hard safety gate — never automate social job portals.
    if (BLOCKED_HOSTS.some((h) => (app.url || "").toLowerCase().includes(h))) {
      report.status = "skipped_portal";
      report.note = "Job portal — automated submission violates their terms. Submit manually.";
      log(c.amber(`      ⏭  Skipped: portal site (submit manually from Auto-Apply)`));
      results.push(report);
      continue;
    }

    const page = await context.newPage();
    try {
      // write the tailored resume PDF to disk for upload
      let resumePath = "";
      if (app.resumePdfBase64) {
        resumePath = path.join(tmpDir, app.resumeFileName || `resume_${i}.pdf`);
        fs.writeFileSync(resumePath, Buffer.from(app.resumePdfBase64, "base64"));
      }

      await page.goto(app.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500);
      await openApplicationForm(page);
      await page.waitForTimeout(800);

      await fillForm(page, app, profile, resumePath, report);

      const captcha = await hasCaptcha(page);
      if (captcha) {
        report.needsYou.push({ field: "CAPTCHA", why: "human verification required" });
        log(c.amber(`      ⚠ CAPTCHA present — you'll need to finish this one`));
      }

      const shot = path.join(
        SHOTS_DIR,
        `${String(i + 1).padStart(2, "0")}_${app.company.replace(/[^A-Za-z0-9]+/g, "_")}.png`
      );
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      report.screenshot = shot;

      const canAutoSubmit =
        DO_SUBMIT &&
        AUTO_SUBMIT_ATS.has(app.ats) &&
        app.autoSubmit !== false &&
        !captcha &&
        report.needsYou.length === 0 &&
        report.filled.length >= 3;

      if (canAutoSubmit) {
        const btn = await findSubmitButton(page);
        if (!btn) {
          report.status = "filled_no_submit_button";
          log(c.amber(`      ⚠ Filled, but no submit button found — finish in the browser`));
        } else {
          await btn.click({ timeout: 10000 });
          await page.waitForTimeout(5000);
          const ok = await looksSubmitted(page);
          report.status = ok ? "submitted" : "submit_clicked_unconfirmed";
          log(
            ok
              ? c.green(`      ✅ SUBMITTED — confirmation detected`)
              : c.amber(`      ⚠ Submit clicked but no confirmation text — verify manually`)
          );
          await page
            .screenshot({ path: shot.replace(/\.png$/, "_after.png"), fullPage: true })
            .catch(() => {});
        }
      } else if (DO_SUBMIT) {
        report.status = "needs_review";
        const why = captcha
          ? "CAPTCHA"
          : report.needsYou.length
          ? `${report.needsYou.length} field(s) need you`
          : !AUTO_SUBMIT_ATS.has(app.ats)
          ? `${app.ats} not auto-submittable`
          : "not enough fields filled";
        report.note = why;
        log(c.amber(`      ⏸  Filled but not submitted — ${why}`));
      } else {
        report.status = "dry_run_filled";
        log(c.cyan(`      ✓ Dry run complete — ${report.filled.length} fields filled`));
      }

      // In headed mode leave the tab open so you can inspect / finish it.
      if (!HEADLESS && report.status !== "submitted") {
        log(c.dim(`      (tab left open for you)`));
      } else {
        await page.close();
      }
    } catch (err) {
      report.status = "error";
      report.note = err.message;
      log(c.red(`      ✖ ${err.message}`));
      await page.close().catch(() => {});
    }

    results.push(report);
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  /* ---- summary ---- */
  const n = (s) => results.filter((r) => r.status === s).length;
  log(c.bold(`\n────────── Summary ──────────`));
  log(`  ${c.green("submitted")}          ${n("submitted")}`);
  log(`  ${c.amber("needs review")}       ${n("needs_review") + n("filled_no_submit_button") + n("submit_clicked_unconfirmed")}`);
  log(`  ${c.cyan("dry-run filled")}     ${n("dry_run_filled")}`);
  log(`  ${c.dim("skipped (portal)")}   ${n("skipped_portal")}`);
  log(`  ${c.red("errors")}             ${n("error")}`);
  log(`\n  Details → ${c.cyan(path.basename(RESULTS_FILE))}`);
  log(`  Screenshots → ${c.cyan(path.relative(process.cwd(), SHOTS_DIR))}`);
  if (!DO_SUBMIT) {
    log(
      c.amber(
        `\n  This was a dry run. Review the screenshots, then run:\n    npm run apply -- --submit\n`
      )
    );
  } else {
    log("");
  }

  if (!HEADLESS) {
    log(c.dim("  Browser stays open. Press Ctrl+C when you're done.\n"));
    await new Promise(() => {}); // keep alive for manual finishing
  }
  await browser.close();
}

main().catch((err) => {
  console.error(c.red(`\nFatal: ${err.stack || err.message}\n`));
  process.exit(1);
});
