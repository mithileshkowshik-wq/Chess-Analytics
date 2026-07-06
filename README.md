# Chess.com Analytics

A dashboard for visualizing your Chess.com activity — track how much time you spend playing and how your rating moves over time, using nothing but a username.

Live app: [chess-analytics-smoky.vercel.app](https://chess-analytics-smoky.vercel.app/)

## Features

- Look up any public Chess.com username, no account or login required
- Rating history across bullet, blitz, and rapid
- Time spent playing, broken down by day, week, month, or year
- Backed directly by the [Chess.com public API](https://www.chess.com/news/view/published-data-api)

## Tech Stack

- [Next.js](https://nextjs.org) (App Router) + React
- [TanStack Query](https://tanstack.com/query) for data fetching/caching
- [Recharts](https://recharts.org) for charts
- Tailwind CSS

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter a Chess.com username to see its dashboard.

## Deployment

This project is deployed on [Vercel](https://vercel.com).
