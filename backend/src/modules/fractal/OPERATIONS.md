# Fractal Operations

## Daily Job

### Schedule

```
00:10 UTC daily
```

### Endpoint

```
POST /api/fractal/v2.1/admin/jobs/daily-run-tg
Authorization: Bearer FRACTAL_CRON_SECRET
```

### Pipeline

```
1. WRITE    → Snapshot Writer (BTC snapshots)
2. RESOLVE  → Outcome Resolver (7/14/30d matured)
3. REBUILD  → Forward Equity (recalculate curves)
4. AUDIT    → Write audit log
5. TELEGRAM → Send admin notifications
```

### Idempotency

Safe to run multiple times:
- First call: writes new data
- Subsequent calls: skips existing, returns `skipped > 0`

### Cron Setup

```bash
# Linux crontab
10 0 * * * curl -X POST "https://DOMAIN/api/fractal/v2.1/admin/jobs/daily-run-tg" \
  -H "Authorization: Bearer FRACTAL_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTC"}'
```

## Telegram Alerts

### Admin Only

Notifications go to admin chat only. No user-facing alerts.

### Alert Levels

| Level | Trigger | Frequency |
|-------|---------|----------|
| CRITICAL | HALT/PROTECTION mode | Immediate |
| ALERT | Guard warning | Immediate |
| INFO | Daily report | Daily |
| MILESTONE | 30+ resolved | Once |

### Message Format

```
🟢 FRACTAL DAILY — BTC

📅 2026-02-17
Mode: NORMAL
Health: HEALTHY | Badge: HIGH (85%)

Pipeline
WRITE: ✅ (2/0)  RESOLVE: ✅ (3)  REBUILD: ✅  AUDIT: ✅

Forward Truth
Sharpe(30d): 0.68 | MaxDD(60d): 11.2%

Resolved: 12/30
```

## Recovery Procedures

### Job Failure

1. Check logs: `/var/log/fractal_cron.log`
2. Check backend: `tail /var/log/supervisor/backend.err.log`
3. Manual retry: `POST /admin/jobs/daily-run-tg-open`

### HALT Mode

1. Review guard status: `GET /admin/overview`
2. Identify trigger reason
3. Apply appropriate playbook
4. Manual mode change if needed

### Data Issues

1. Check candle source: `GET /chart?limit=10`
2. Verify timestamps are sequential
3. No gaps in daily data

## Monitoring

### Health Endpoints

- `GET /api/health` — System health
- `GET /api/fractal/health` — Module health
- `GET /admin/freeze-status` — Freeze state
- `GET /admin/overview` — Full dashboard

### Log Locations

```
/var/log/supervisor/backend.out.log
/var/log/supervisor/backend.err.log
/var/log/fractal_cron.log
```
