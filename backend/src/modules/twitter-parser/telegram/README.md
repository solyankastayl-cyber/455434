# Twitter Parser Module — Telegram

Notification system for Twitter Parser events.

## Structure

```
telegram/
├── messages/
│   ├── event.types.ts      # Event type definitions
│   ├── templates.ts        # HTML message templates
│   └── message.builder.ts  # Message builder
├── router/
│   ├── event.router.ts     # Routes events to USER/SYSTEM
│   ├── dedupe.guard.ts     # Prevents duplicate messages
│   └── router.types.ts     # Router configuration types
├── notifier/
│   ├── telegram.notifier.ts # Low-level Telegram API
│   └── notifier.types.ts   # Notifier types
└── adapters/
    ├── user.adapter.ts     # USER event builders
    └── system.adapter.ts   # SYSTEM event builders
```

## Architecture

```
[Core/Scheduler/Extension]
          │
          ▼
     [Adapters]  ←── converts runtime events to TelegramEvent
          │
          ▼
   [EventRouter] ←── checks dedupe, preferences, routes to correct channel
          │
          ├──→ [USER] → finds connection → sends to user chat
          │
          └──→ [SYSTEM] → sends to admin channel
```

## Events

### USER Events
- `NEW_TWEETS` — New tweets found
- `SESSION_EXPIRED` — Session needs resync
- `SESSION_RESYNCED` — Session restored
- `SESSION_OK` — Session healthy
- `SESSION_STALE` — Session warning
- `TARGET_COOLDOWN` — Target paused
- `HIGH_RISK` — Account stability warning
- `PARSE_COMPLETED` — Task done
- `PARSE_ABORTED` — Task failed

### SYSTEM Events
- `PARSER_DOWN` — Service offline
- `PARSER_UP` — Service recovered
- `ABORT_RATE_HIGH` — High failure rate
- `SYSTEM_COOLDOWN` — System throttling

## Usage

```typescript
import { eventRouter } from './router/event.router.js';
import { newTweetsEvent } from './adapters/user.adapter.js';

// Initialize with host functions
eventRouter.init({
  findConnection: async (userId) => { /* ... */ },
  sendUserMessage: async (chatId, text) => { /* ... */ },
  sendSystemMessage: async (params) => { /* ... */ },
});

// Send event
const params = newTweetsEvent(userId, { count: 5, target: 'bitcoin' });
await eventRouter.sendEvent(params);
```

## Rules

1. **Core/Scheduler/Extension do NOT know about Telegram**
2. **All events go through EventRouter**
3. **USER and SYSTEM are isolated**
4. **Dedupe prevents spam**
5. **Templates are FROZEN**
