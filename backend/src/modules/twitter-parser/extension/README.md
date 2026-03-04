# Twitter Parser Module — Extension

Sync and preflight logic for Chrome Extension, Web UI, and ZIP clients.

## Structure

```
extension/
├── preflight/
│   ├── preflight.check.ts   # Main preflight logic
│   └── cookie.validator.ts  # Cookie validation
├── sync/
│   ├── sync.logic.ts        # Sync preparation and result building
│   └── sync.types.ts        # Type definitions
├── messages/
│   └── sync-messages.ts     # Human-readable messages (FROZEN)
└── adapters/
    ├── chrome.adapter.ts    # Chrome Extension payload adapter
    └── web.adapter.ts       # Web UI / ZIP payload adapter
```

## Contract

This module implements `EXTENSION_SYNC_CONTRACT.md`.

### Status Values (FROZEN)
- `READY` — Can sync
- `NO_COOKIES` — Not logged into Twitter
- `SESSION_EXPIRED` — Session expired
- `API_KEY_INVALID` — Invalid API key
- `PARTIAL` — Partial sync
- `SERVICE_UNAVAILABLE` — Service down
- `NETWORK_ERROR` — Connection error
- `INTERNAL_ERROR` — Unexpected error

## Usage

### Chrome Extension
```typescript
import { fromChromePayload } from './adapters/chrome.adapter.js';
import { runPreflightCheck } from './preflight/preflight.check.js';

const input = fromChromePayload(chromePayload);
const result = runPreflightCheck({
  cookies: input.cookies,
  hasApiKey: true,
  systemHealthy: true,
});
```

### Web UI
```typescript
import { fromWebPayload } from './adapters/web.adapter.js';
import { prepareSyncInput } from './sync/sync.logic.js';

const input = fromWebPayload(webPayload);
const prepared = prepareSyncInput(input);
```

## Rules

1. **No auto-sync** — User must explicitly trigger sync
2. **No silent retry** — All errors are shown to user
3. **Single source of truth** — Messages come from sync-messages.ts only
4. **Adapters don't modify logic** — They only transform payloads
