# CareerPilot AI

Personal AI career copilot for Jatin Mangla — resume improvement, industry-standard
validation, job-tailoring (with approval flow), job matching with pros/cons analysis,
auto-apply pipeline, mock interviews (oral / video / text), coding practice, and a
self-evolving AI strategy. Powered by Claude (Anthropic).

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Backend = Next.js API routes (deploys as serverless functions on Vercel — no separate backend needed)
- Claude Opus 4.8 via `@anthropic-ai/sdk` (adaptive thinking, streaming, structured outputs)
- Single-user auth (HMAC-signed cookie), data stored in your browser (localStorage)

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

| Name                | Value                              |
| ------------------- | ---------------------------------- |
| `ANTHROPIC_API_KEY` | your Claude API key                |
| `AUTH_EMAIL`        | jatinmangla123@gmail.com           |
| `AUTH_PASSWORD`     | a strong password                  |
| `AUTH_SECRET`       | any long random string             |
| `ADZUNA_APP_ID`     | (optional) for live job listings   |
| `ADZUNA_APP_KEY`    | (optional)                         |

Redeploy after adding env vars (`vercel --prod`).

## Notes

- **Auto-apply**: prepares everything (cover letter, tailored bullets, screening
  answers) and gives one-click portal links. Fully-automated bot submission on
  LinkedIn/Naukri violates their ToS and risks account bans, so the final click is yours.
- **Job listings**: with Adzuna keys you get live listings analyzed by AI; without them
  the AI researches representative openings (clearly labeled — verify before applying).
- **Evolve AI**: rewrites the AI's own operating strategy from your usage + feedback and
  injects it into all future prompts.
