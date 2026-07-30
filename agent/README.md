# CareerPilot Auto-Apply Agent

Submits your prepared applications **directly on companies' official career sites** —
Greenhouse, Lever, Ashby, Workable and most bespoke ATS forms.

Runs on your machine, in a visible browser, so you can watch every step and take over
whenever you want.

## Setup (once)

```bash
cd agent
npm install          # also downloads Chromium (~120 MB)
```

## Each run

1. On the **Auto-Pilot** page in CareerPilot, tailor + approve jobs, then click
   **Export for agent**.
2. Move the downloaded `apply-queue.json` into this `agent/` folder.
3. Dry run first — fills every form, screenshots it, submits **nothing**:

   ```bash
   npm run apply
   ```

4. Check `screenshots/`. If the forms look right, go live:

   ```bash
   npm run apply -- --submit
   ```

## Verify your setup safely

`test-fixture.html` is a fake application form bundled here. Point a queue at it
(`"url": "file:///…/agent/test-fixture.html"`) and run with `--submit` to confirm the
agent fills and submits correctly, without touching any real employer.

## Flags

| Flag | Effect |
| --- | --- |
| *(none)* | Dry run — fill + screenshot only |
| `--submit` | Actually submit, where safe |
| `--only=Infosys` | Just one company/title (substring match) |
| `--headless` | No visible browser (not recommended for first runs) |

## What it will and won't do

**Auto-submits** on Greenhouse, Lever, Ashby, Workable when *all* of these hold:
the resume uploaded, no CAPTCHA appeared, and every required field was answered
confidently. Otherwise it fills what it can and leaves the tab open for you.

**Never submits** on LinkedIn, Naukri, Indeed, Glassdoor, Instahyre, Cutshort, Wellfound
or similar portals — their terms forbid automated submission and accounts get banned.
Those are skipped with a note; use the one-click kits on the Auto-Apply page instead.

**Never fills** voluntary demographic questions (gender, race, veteran, disability) —
those are yours to answer or leave blank.

**Pauses for you** on CAPTCHAs, Workday's multi-step wizards, unfamiliar required
questions, and anything the AI marked low-confidence.

## Output

- `results.json` — per-application status, fields filled, and what needed you
- `screenshots/NN_Company.png` — the filled form (plus `_after.png` once submitted)

Statuses: `submitted`, `needs_review`, `dry_run_filled`, `filled_no_submit_button`,
`submit_clicked_unconfirmed`, `skipped_portal`, `error`.

## Good practice

- Keep the first live batch small (2–3 jobs) until you trust the output.
- Read `results.json` after every run — `needs_review` items still need your 30 seconds.
- Nothing here stores credentials: no employer logins are used, and the queue file only
  contains your resume PDF, cover letters and answers. Delete it when you're done.
