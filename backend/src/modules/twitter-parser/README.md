# Twitter Parser Module

Autonomous Twitter parsing subsystem.

## Features
- Parser runtime (Playwright-based scraping)
- Scheduler / Worker (task queue)
- Cookies & Chrome Extension sync
- Retry / Backoff / Cooldown
- Admin API (sessions, tasks, health)
- Telegram notifications
- Quality metrics

## Usage

```typescript
import { initTwitterParser } from './modules/twitter-parser'

initTwitterParser({
  mongoUrl: process.env.MONGO_URL,
  encryptionKey: process.env.COOKIE_ENC_KEY,
  telegram: { token: process.env.TELEGRAM_TOKEN },
  app
})
```

## Structure

```
twitter-parser/
├── core/          # parser runtime, quality, cooldown, retry
├── scheduler/     # scheduler + worker
├── api/           # public + admin API routes
├── admin/         # admin logic (NOT UI)
├── telegram/      # notification sink
├── extension/     # sync / preflight logic
├── storage/       # mongo models & repositories
├── contracts/     # API + ENV + EVENTS contracts
├── index.ts       # initTwitterParser()
└── README.md
```

## Requirements

This module can be embedded into any Node.js backend with:
- MongoDB
- Express / Fastify compatible HTTP server

## Version

Based on: `v4.2-final`
