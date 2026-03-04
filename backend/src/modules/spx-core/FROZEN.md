# SPX FRACTAL MODULE — FROZEN

**Tag**: `spx-fractal-v1.0-frozen`  
**Date**: 2026-02-24  
**Status**: PRODUCTION READY

---

## ⚠️ ISOLATION RULE

**NO IMPORTS FROM BTC/DXY MODULES**

All SPX code must be self-contained within `/modules/spx-core/` and `/modules/fractal/` (shared).  
Violation of this rule breaks the freeze contract.

---

## Endpoints

### Fractal Core
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fractal/spx` | Main SPX fractal terminal |
| GET | `/api/fractal/spx/horizons` | Available horizons |

### SPX-Specific
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/spx` | SPX terminal (multi-horizon) |
| GET | `/api/spx/status` | SPX status |
| GET | `/api/spx/horizons` | SPX horizons |
| GET | `/api/spx/v2.1/chart` | SPX chart data |
| GET | `/api/spx/v2.1/scan` | SPX scan results |
| GET | `/api/spx/v2.1/phase` | SPX phase detection |
| GET | `/api/spx/v2.1/guardrails` | SPX guardrails |

### Forward Performance
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/forward/metrics/summary?asset=SPX` | Forward metrics summary |
| GET | `/api/forward/equity?asset=SPX` | Equity curve |
| POST | `/api/forward/admin/snapshot/write?asset=SPX` | Write snapshot |
| POST | `/api/forward/admin/outcomes/resolve?asset=SPX` | Resolve outcomes |
| POST | `/api/forward/admin/metrics/rebuild?asset=SPX` | Rebuild metrics |

---

## Collections

| Collection | Description |
|------------|-------------|
| `spx_candles` | OHLCV data (1928-2026, 19k+ candles) |
| `spx_meta` | Metadata/checksums |
| `forwardsignals` | Forward signals (shared) |
| `forwardoutcomes` | Resolved outcomes (shared) |
| `forwardmetrics` | Cached metrics (shared) |

---

## Bootstrap Seed

**Path**: `/app/backend/data/fractal/bootstrap/spx_stooq_seed.csv`

**Coverage**: 1928-2026 (98 years)  
**Candles**: 19,242  
**Source**: Stooq (^SPX)

---

## Constants

```typescript
// spx-horizon.config.ts
SPX_HORIZONS = [7, 14, 30, 60, 90, 180, 365]
SPX_SCAN_CONFIG = {
  windowLength: 60,
  similarityThreshold: 0.88,
  topK: 5,
  minHistoryDays: 1000,
}
```

---

## Smoke Test (one command)

```bash
# Should return ok:true for all
curl -s "http://localhost:8001/api/fractal/spx?focus=30d" | jq -r '.ok'
curl -s "http://localhost:8001/api/spx" | jq -r '.ok'
curl -s "http://localhost:8001/api/spx/v2.1/chart?symbol=SPX&limit=100" | jq -r '.ok'
curl -s "http://localhost:8001/api/forward/metrics/summary?asset=SPX" | jq -r '.ok'
```

---

## File Structure

```
/app/backend/src/modules/spx-core/
├── spx-horizon.config.ts
├── spx-core.module.ts
├── spx.engine.ts
├── spx-scan.service.ts
├── spx-replay.service.ts
├── spx-focus-pack.service.ts
├── spx-normalize.service.ts
├── spx-similarity.service.ts
├── spx-phase.detection.service.ts
├── spx.admin.routes.ts
└── FROZEN.md                          ← THIS FILE
```

---

## Change Policy

1. **Bug fixes only** — no new features without version bump
2. **No BTC/DXY imports** — isolation must be maintained
3. **Backward compatible** — existing endpoints must not break
4. **Test after change** — run smoke test before commit

---

## Contact

For questions about this frozen module, check git history for original author.
