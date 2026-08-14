# CareerPilot AI

Personal AI career copilot for Jatin Mangla — resume improvement, industry-standard
validation, job-tailoring (with approval flow), job matching with pros/cons analysis,
auto-apply pipeline, Gmail job-inbox triage, HR outreach, mock interviews
(oral / video / text), coding practice, and a self-evolving AI strategy.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Backend = Next.js API routes (deploys as serverless functions on Vercel — no separate backend needed)
- Google Gemini (free tier) with per-task model tiers, schema-enforced JSON and SSE streaming
- Single-user auth (HMAC-signed cookie), state synced across devices via Upstash Redis

## Run locally

```bash
npm install
# edit .env.local → set ANTHROPIC_API_KEY (and change AUTH_PASSWORD)
npm run dev
```

Open http://localhost:3000 → log in with `jatinmangla123@gmail.com` + the password from
`.env.local` (default: `careerpilot`).

## Deploy to Vercel

```bash
npm i -g vercel
vercel login          # log in as jatinmanglas-projects
vercel                # first deploy (accept defaults)
vercel --prod         # production deploy
```

Then in the Vercel dashboard → Project → Settings → Environment Variables, add:

| Name                                             | Value                                          |
| ------------------------------------------------ | ---------------------------------------------- |
| `GEMINI_API_KEY`                                  | free key from aistudio.google.com/apikey       |
| `AUTH_EMAIL`                                      | jatinmangla123@gmail.com                       |
| `AUTH_PASSWORD`                                   | a strong password                              |
| `AUTH_SECRET`                                     | any long random string                         |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN`               | cross-device sync (or Vercel's `KV_REST_API_*`)|
| `GMAIL_USER` / `GMAIL_APP_PASSWORD`               | Job Inbox + HR Outreach                        |
| `RESEND_API_KEY`                                  | (optional) emailed login codes                 |
| `OPENWEBNINJA_API_KEY`, `ADZUNA_APP_ID` / `_KEY`  | (optional) wider job aggregator coverage       |

Redeploy after adding env vars (`vercel --prod`).

## Notes

- **Auto-apply**: prepares everything (cover letter, tailored bullets, screening
  answers) and gives one-click portal links. Fully-automated bot submission on
  LinkedIn/Naukri violates their ToS and risks account bans, so the final click is yours.
- **Job listings**: with Adzuna keys you get live listings analyzed by AI; without them
  the AI researches representative openings (clearly labeled — verify before applying).
- **Evolve AI**: rewrites the AI's own operating strategy from your usage + feedback and
  injects it into all future prompts.
