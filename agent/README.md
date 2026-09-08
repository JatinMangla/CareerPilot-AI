# CareerPilot Apply Assistant

Opens your prepared applications **directly on companies' official career sites** —
Greenhouse, Lever, Ashby, Workable and most bespoke ATS forms — and fills in everything
it can, so all that's left is to read the form and press Submit.

Runs on your machine, in a visible browser, so you can watch every step and take over
whenever you want.

**It never submits anything.** That is on purpose. A sent application can't be recalled,
so a mis-parsed dropdown or a guessed answer becomes permanent and you find out from the
rejection. Everything up to the final click is automated; the click is yours.

## Setup (once)

```bash
cd agent
npm install          # also downloads Chromium (~120 MB)
```

## Each run

1. On the **Auto-Pilot** page in CareerPilot, tailor + approve jobs, then click
   **Export** (PDFs + answers).
2. Move the downloaded `apply-queue.json` into this `agent/` folder.
3. Either open every application and fill it in for you to check:

   ```bash
   npm run apply
   ```

   …or just open them all in tabs and do the typing yourself:

   ```bash
   npm run apply -- --open
   ```

4. Go through the open tabs, check each form against the cover letter and answers from
   the app, and press Submit.

> If you'd rather not install anything, the **Open in tabs** button on the Auto-Pilot
> page does step 3 straight from your browser.

## Verify your setup safely

`test-fixture.html` is a fake application form bundled here. Point a queue at it
(`"url": "file:///…/agent/test-fixture.html"`) to see exactly what the agent fills in,
without touching any real employer.

## Flags

| Flag | Effect |
| --- | --- |
| *(none)* | Open each application and fill every field it recognizes |
| `--open` | Just open every application in its own tab, fill nothing |
| `--only=Stripe` | Just one company/title (substring match) |
| `--headless` | No visible browser — fill + screenshot only |

## What it will and won't do

**Never submits.** Not on any site, under any flag. It scrolls the submit button into
view and hands you the tab.

**Never touches** LinkedIn, Naukri, Indeed, Glassdoor, Instahyre, Cutshort, Wellfound or
similar portals — automating those violates their terms and gets accounts banned. They're
skipped with a note; use the one-click kits on the Auto-Apply page instead.

**Never fills** voluntary demographic questions (gender, race, veteran, disability) —
those are yours to answer or leave blank.

**Flags for you** CAPTCHAs, Workday's multi-step wizards, unfamiliar required questions,
and anything the AI marked low-confidence.

## Output

- `results.json` — per-application status, fields filled, and what needed you
- `screenshots/NN_Company.png` — the filled form

Statuses: `filled`, `needs_you`, `opened`, `skipped_portal`, `error`.

## Good practice

- Read `results.json` after every run — `needs_you` items still need your 30 seconds.
- Nothing here stores credentials: no employer logins are used, and the queue file only
  contains your resume PDF, cover letters and answers. Delete it when you're done.
