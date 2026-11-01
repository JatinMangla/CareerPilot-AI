# CareerPilot AI

Personal AI career copilot: resume improvement and validation, per-job tailoring with an
approval step, job matching with pros and cons, an apply pipeline that prepares everything and
leaves the final click to you, Gmail job-inbox triage, HR outreach, mock interviews, coding
practice, and a self-evolving AI strategy.

For how the app works and what is in progress, see [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md).

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4
- Backend: Next.js API routes on Vercel; there is no separate server
- Google Gemini (free tier), with per-task model chains, schema-enforced JSON and SSE streaming
- Single-user auth (emailed code or password, signed cookie), with state synced across devices
  through Upstash Redis

## Run locally

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000 and sign in with `AUTH_EMAIL` and `AUTH_PASSWORD` from `.env.local`.
There are no default credentials.

## Deploy to Vercel

The `main` branch is connected to Vercel and deploys on push. Set these in the Vercel dashboard
under Project → Settings → Environment Variables:

| Name                                             | Value                                          |
| ------------------------------------------------ | ---------------------------------------------- |
| `GEMINI_API_KEY`                                 | free key from aistudio.google.com/apikey       |
| `AUTH_EMAIL`                                     | the one account allowed in                     |
| `AUTH_PASSWORD`                                  | a strong password                              |
| `AUTH_SECRET`                                    | any long random string                         |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN`              | cross-device sync (or Vercel's `KV_REST_API_*`)|
| `GMAIL_USER` / `GMAIL_APP_PASSWORD`              | Job Inbox + HR Outreach                        |
| `RESEND_API_KEY`                                 | (optional) emailed login codes                 |
| `OPENWEBNINJA_API_KEY`, `ADZUNA_APP_ID` / `_KEY` | (optional) wider job aggregator coverage       |
| `GITHUB_TOKEN`                                   | (optional) a higher GitHub Review rate limit   |

## Notes

- **Nothing submits an application.** The app and the local agent prepare everything and open
  each application for you to submit. A sent application cannot be recalled.
- **Job listings** come from 120 company boards (Greenhouse, Lever, Ashby) with no key needed,
  plus JSearch and Adzuna when configured. AI-researched leads appear only when you ask for them
  and cannot enter the apply pipeline.
- **Evolve AI** rewrites the AI's operating strategy from your results and feedback, and adds it
  to every later prompt.
