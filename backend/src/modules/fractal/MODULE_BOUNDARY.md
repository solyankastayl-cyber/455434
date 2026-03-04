# FRACTAL MODULE — BOUNDARY SPEC

Version: v2.1.1  
Status: FROZEN-CONTRACT READY  
Isolation Level: STRICT

---

## 1. Purpose

Fractal module is a fully isolated decision engine responsible for:
- Multi-horizon fractal matching
- Hierarchical resolver
- Volatility regime modifier
- Adaptive sizing stack
- Snapshot writer + forward-truth engine
- Regime alerts (BLOCK 67-68)

It MUST NOT depend on other platform modules.

---

## 2. Allowed Dependencies

Fractal can only interact with the outside world through `HostDeps`.

Allowed interaction surface:

| Dependency | Interface | Purpose |
|------------|-----------|---------|
| marketData | `getCandlesDaily(symbol, limit)` | OHLCV 1D data |
| clock | `now()`, `utcNow()`, `toISOString()` | UTC time only |
| logger | `info/warn/error/debug` | Structured logging |
| storage | `getCollection(name)` | Mongo adapter |
| settings | `get/getBool/getNum/getStr` | Config via HostDeps |
| http | `get/post` | External calls (optional) |
| telegram | `sendMessage/sendAlert` | Notifications (optional) |

---

## 3. Forbidden Imports

The following imports are strictly forbidden:

```
- /modules/metabrain/*
- /modules/exchange/*
- /modules/sentiment/*
- /app/core/*
- /shared/* (if contains global singletons)
- direct process.env usage (except bootstrap/config)
- direct axios/fetch usage (except ops/)
- direct cron/timers inside module scope
```

---

## 4. Entry Point Rule

The ONLY way to mount this module:

```typescript
registerFractalModule(fastify, hostDeps, opts)
```

No auto-registration.
No side effects on import.
No background timers.

---

## 5. State Rules

- No global mutable state.
- No hidden singletons.
- All runtime state must be injected via HostDeps.

---

## 6. Governance Safety

- No auto-promotion.
- No auto-training.
- No mutation of contract parameters.
- Contract freeze must be respected.

---

## 7. Testability Requirement

Module must boot with:

```typescript
hostdeps.mock.ts
```

If it cannot run with mock deps, boundary is broken.

---

## 8. Alert System Constraints (BLOCK 67-68)

- Alert policy table: FROZEN (no changes without version bump)
- Quota limits: FROZEN (3 INFO/HIGH per 24h)
- Cooldown periods: FROZEN (6h INFO/HIGH, 1h CRITICAL)
- Severity mapping: FROZEN

Any change requires:
```
version: v2.1.x → v2.1.x+1
contractHash: new hash
freezeAuditVerdict: PASS
```

---

## 9. Directory Structure

```
/modules/fractal/
├── MODULE_BOUNDARY.md      # This file
├── index.ts                # Public exports only
├── host/                   # HostDeps interfaces
├── isolation/              # Boundary guards
├── contracts/              # Frozen contracts
├── engine/                 # Pure domain logic
├── domain/                 # Constants, types
├── storage/                # Mongo repos (allowed external)
├── ops/                    # Operations (allowed external)
├── bootstrap/              # Initialization (allowed env)
├── runtime/                # Module registration
├── alerts/                 # Alert engine (BLOCK 67-68)
└── api/                    # Route handlers
```

---

END OF SPEC
