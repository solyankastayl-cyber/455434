# Twitter Parser Module — API

REST API layer for Twitter Parser module.

## Structure

```
api/
├── public/           # User-facing endpoints
│   ├── sync.routes.ts
│   ├── targets.routes.ts
│   └── status.routes.ts
├── admin/            # Operator endpoints
│   ├── sessions.routes.ts
│   ├── tasks.routes.ts
│   ├── health.routes.ts
│   └── quality.routes.ts
├── middleware/
│   ├── api-key.guard.ts
│   └── admin.guard.ts
└── types.ts
```

## Public API

### Sync (Chrome Extension / Web)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/twitter/sync/preflight` | Check cookies before sync |
| POST | `/twitter/sync/start` | Start sync with cookies |
| GET | `/twitter/sync/status` | Get sync status |

### Targets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/twitter/targets` | List user's targets |
| POST | `/twitter/targets` | Create target |
| PUT | `/twitter/targets/:id` | Update target |
| DELETE | `/twitter/targets/:id` | Delete target |

### Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/twitter/status` | Aggregated status |

## Admin API

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/twitter/sessions` | List sessions |
| GET | `/admin/twitter/sessions/:id` | Get session |
| POST | `/admin/twitter/sessions/:id/resync` | Mark for resync |
| POST | `/admin/twitter/sessions/:id/disable` | Disable session |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/twitter/tasks` | List tasks |
| GET | `/admin/twitter/tasks/:id` | Get task |
| POST | `/admin/twitter/tasks/:id/retry` | Retry task |
| POST | `/admin/twitter/tasks/:id/abort` | Abort task |

### Health & Quality

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/twitter/health` | System health |
| GET | `/admin/twitter/quality` | Parser quality |

## Usage

The API layer provides framework-agnostic handlers.
Host app registers routes with their framework (Express, Fastify, etc.).

```typescript
import { syncHandlers } from './api/public/sync.routes.js';
import { buildHealthResponse } from './api/admin/health.routes.js';

// Example: Fastify integration
app.post('/api/v4/twitter/sync/preflight', async (req, reply) => {
  const result = await syncHandlers.preflight({
    headers: req.headers,
    body: req.body,
  });
  return reply.send(result);
});
```

## Rules

1. **No business logic in routes** — only mapping
2. **No mongoose imports** — use storage/ module
3. **No Telegram calls** — use telegram/ module
4. **Routes are thin adapters**
