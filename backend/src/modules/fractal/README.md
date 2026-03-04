# Fractal V2.1 — Signal Engine

## Overview

Fractal is an **isolated, frozen signal engine** for BTC 1D timeframe.

It uses probabilistic pattern matching to generate forward-looking signals
with institutional-grade governance and risk management.

## Contract Status

| Property | Value |
|----------|-------|
| Version | v2.1.0 |
| Status | **FROZEN** |
| Symbol | BTC only |
| Horizons | 7d / 14d / 30d |
| Auto-promotion | **DISABLED** |
| Auto-training | **DISABLED** |

## Main Endpoints

### Signal (Primary)
```
GET /api/fractal/v2.1/signal?symbol=BTC
```
Returns `FractalSignalContract` — the frozen interface used by MetaBrain and Frontend.

### Chart Data
```
GET /api/fractal/v2.1/chart?symbol=BTC&limit=365
```
Returns OHLCV + SMA200 + phase data.

### Overlay (Pattern Matches)
```
GET /api/fractal/v2.1/overlay?symbol=BTC&topK=10
```
Returns top pattern matches with outcomes.

### Admin Overview
```
GET /api/fractal/v2.1/admin/overview?symbol=BTC
```
Returns full admin dashboard payload.

### Shadow Divergence
```
GET /api/fractal/v2.1/admin/shadow-divergence?symbol=BTC
```
Returns ACTIVE vs SHADOW comparison for governance.

## MongoDB Collections

| Collection | Purpose |
|------------|--------|
| `fractal_snapshots` | Daily signal snapshots (ACTIVE/SHADOW) |
| `fractal_outcomes` | Resolved outcomes with realized returns |
| `fractal_equity` | Forward equity curve |
| `fractal_governance` | Governance audit trail |

## Environment Variables

```bash
# Core
MONGO_URL=mongodb://localhost:27017/fractal_dev
FRACTAL_ONLY=1
FRACTAL_ENABLED=true

# Freeze
FRACTAL_FROZEN=true
FRACTAL_VERSION=v2.1.0

# Telegram
TG_BOT_TOKEN=xxx
TG_ADMIN_CHAT_ID=xxx

# Cron
FRACTAL_CRON_SECRET=xxx
```

## Health Check

```bash
curl /api/fractal/health
# Returns: { status: "ok", version: "v2.1.0", frozen: true }
```

## Module Structure

```
/modules/fractal/
  /api/           # HTTP routes
  /contracts/     # FractalSignalContract (frozen)
  /freeze/        # Freeze guards and config
  /ops/           # Telegram + Cron
  /governance/    # Guard + Playbooks
  /lifecycle/     # Snapshot + Resolver
  /strategy/      # Backtest + Forward
  /runtime/       # Module bootstrap
```

## Isolation Principle

Fractal is a **bounded context**:
- No imports from MetaBrain/Exchange/Sentiment
- All dependencies through `HostDeps` interface
- Can be deployed standalone
- Can fail without crashing platform
