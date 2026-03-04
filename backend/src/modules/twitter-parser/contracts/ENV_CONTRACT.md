# ENV Contract — Twitter Parser Module

> **Version:** v4.2-final
> **Scope:** Twitter Parser Module ONLY

This document defines environment variables required by the Twitter Parser Module.

---

## Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGO_URL` | MongoDB connection string | `mongodb://localhost:27017/fomo` |
| `COOKIE_ENC_KEY` | AES-256-GCM key (32 bytes, hex) | `64-char hex string` |

---

## Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | — |
| `TELEGRAM_ADMIN_CHAT_ID` | Admin chat for system alerts | — |

---

## Usage in Module

❌ **FORBIDDEN** inside module:
```typescript
// WRONG
const mongoUrl = process.env.MONGO_URL;
```

✅ **REQUIRED** — pass via config:
```typescript
// CORRECT
initTwitterParser({
  mongoUrl: process.env.MONGO_URL,
  encryptionKey: process.env.COOKIE_ENC_KEY,
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN
  },
  app
});
```

---

## Validation

Module MUST validate config on init:
- `mongoUrl` — required, valid connection string
- `encryptionKey` — required, 64-char hex
- `telegram.token` — optional, if provided must be valid

Missing required config → throw Error, do not start.

---

## Collections Used

All collections are prefixed for isolation:

| Collection | Description |
|------------|-------------|
| `twitter_tasks` | Task queue |
| `twitter_sessions` | User sessions (encrypted cookies) |
| `twitter_accounts` | Twitter account metadata |
| `twitter_targets` | Parsing targets (keywords, accounts) |
| `twitter_results` | Parsed tweets |
| `twitter_quality` | Quality metrics |

---

**DO NOT** use shared collections from other modules.
