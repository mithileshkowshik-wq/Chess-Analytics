# Chess.com Analytics

A dashboard for visualizing your Chess.com activity — track how much time you spend playing and how your rating moves over time, using nothing but a username.

Live app: [chess-analytics-smoky.vercel.app](https://chess-analytics-smoky.vercel.app/)

## Features

- Look up any public Chess.com username, no account or login required
- Rating history across bullet, blitz, and rapid
- Time spent playing, broken down by day, week, month, or year
- Rating at any game number — "what was my rapid rating after 800 games?"
- An AI assistant you can ask in plain English: rating on a given date, opening
  win rates, results by colour, and more
- Backed directly by the [Chess.com public API](https://www.chess.com/news/view/published-data-api)

## The assistant

The "Ask about your stats" panel answers questions using **tool calling**: the
model never sees your games and never does arithmetic. It picks from a set of
typed tools, the app computes every figure from your archives, and the model
only phrases the result. That is what keeps "rating after 800 games" exact
rather than plausible.

It reads rated standard-chess games in bullet, blitz and rapid. Daily, unrated
and variant games (Chess960 and friends) are excluded, since those are rated in
separate pools.

## Tech Stack

- [Next.js](https://nextjs.org) (App Router) + React
- [TanStack Query](https://tanstack.com/query) for data fetching/caching
- [Recharts](https://recharts.org) for charts
- Tailwind CSS

## Getting Started

```bash
npm install
cp .env.example .env.local   # then add your OpenRouter key
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter a Chess.com username to see its dashboard.

## Configuration

The dashboard and charts work with no configuration. The assistant needs an
[OpenRouter](https://openrouter.ai/keys) API key:

| Variable | Required | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes, for the assistant | — |
| `OPENROUTER_MODEL` | no | `google/gemma-4-31b-it` |
| `OPENROUTER_BASE_URL` | no | `https://openrouter.ai/api/v1` |
| `OPENROUTER_SITE_URL` / `OPENROUTER_SITE_NAME` | no | unset (OpenRouter attribution) |

Without a key the panel simply reports that the assistant is not configured;
nothing else is affected. Since the model is just an env var, you can swap in
`google/gemma-4-31b-it:free` for zero-cost local testing, or any other
tool-calling model OpenRouter serves.

> **Set a spend limit on your key.** This app has no login, so the chat endpoint
> is public — anyone who finds your deployed URL can spend credits on it.

### Enabling the assistant

**Locally:**

```bash
cp .env.example .env.local          # if you haven't already
# edit .env.local and set OPENROUTER_API_KEY=sk-or-v1-...
npm run check:llm                   # confirms the key and the model work
npm run dev
```

`.env.local` is gitignored. Note the variable is `OPENROUTER_API_KEY` — one
word, no underscore between OPEN and ROUTER; a near-miss name leaves the panel
silently disabled.

**On Vercel:** Project → Settings → Environment Variables → add
`OPENROUTER_API_KEY` for Production, Preview and Development, then redeploy.
Values are bound at deploy time, so an existing deployment will not pick it up
until it is rebuilt.

## Verification

There is no test runner. `npm run check` compiles `lib/` and `scripts/` and runs
the offline checks against synthetic fixtures — no network, no API key:

```bash
npm run check       # game parsing, the rating-series regression,
                    # the nine tools, and the tool-calling loop
```

`npm run check:llm` is the one check that really calls OpenRouter. It uses
synthetic games with known answers, so a wrong number means the model is
inventing rather than reading tool output. It reports which tools the model
chose and what the questions cost:

```bash
npm run check:llm
```

## Deployment

This project is deployed on [Vercel](https://vercel.com).
