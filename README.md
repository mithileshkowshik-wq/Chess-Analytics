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

## Verification

There is no test runner. The offline checks run the real modules against
synthetic fixtures with no network:

```bash
npx tsc lib/*.ts lib/agent/*.ts scripts/*.ts --outDir /tmp/cc \
  --module commonjs --target es2022 --moduleResolution node \
  --skipLibCheck --esModuleInterop
node /tmp/cc/scripts/check-facts.js   # game parsing + rating-series regression
node /tmp/cc/scripts/check-tools.js   # the nine agent tools
node /tmp/cc/scripts/check-agent.js   # the tool-calling loop, stubbed transport
```

## Deployment

This project is deployed on [Vercel](https://vercel.com).
