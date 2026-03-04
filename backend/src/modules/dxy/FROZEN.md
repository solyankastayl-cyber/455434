# DXY FRACTAL MODULE — FROZEN

**Tag**: `dxy-fractal-v1.1-frozen`  
**Date**: 2026-02-25  
**Status**: PRODUCTION READY (A4 Terminal)

---

## ⚠️ ISOLATION RULE

**NO IMPORTS FROM BTC/SPX MODULES**

All DXY code must be self-contained within `/modules/dxy/`.  
Violation of this rule breaks the freeze contract.

---

## Endpoints

### A4 Terminal (Unified API)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fractal/dxy/terminal` | **PRIMARY** — unified terminal (core+synthetic+replay+hybrid+meta) |

**Query params:**
- `focus`: "7d" | "14d" | "30d" | "90d" | "180d" | "365d" (default: "30d")
- `rank`: 1..10 (default: 1) — which match for replay/hybrid
- `windowLen`: number (optional)
- `topK`: number (optional, default: 10)

### Fractal Core (Secondary)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fractal/dxy` | Main DXY fractal (legacy) |
| GET | `/api/fractal/dxy/replay` | Replay packs |
| GET | `/api/fractal/dxy/synthetic` | Synthetic trajectory |
| GET | `/api/fractal/dxy/hybrid` | Hybrid forecast |
| GET | `/api/fractal/dxy/horizons` | Available horizons |
| GET | `/api/fractal/dxy/audit` | Audit diagnostics |

### Walk-Forward (A3.5)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/fractal/dxy/walk/run` | Run walk-forward |
| POST | `/api/fractal/dxy/walk/resolve` | Resolve outcomes |
| GET | `/api/fractal/dxy/walk/summary` | Summary stats |
| GET | `/api/fractal/dxy/walk/status` | Status check |

### Calibration (A3.6-A3.7)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/fractal/dxy/calibrate/grid-90d` | Grid search 90d |
| POST | `/api/fractal/dxy/calibrate/grid-90d-v2` | V2 with quality gate |
| GET | `/api/fractal/dxy/calibrate/latest` | Latest calibration |

### Forward Performance (D4)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/forward/dxy/admin/snapshot` | Create forward signals |
| POST | `/api/forward/dxy/admin/outcomes/resolve` | Resolve outcomes |
| POST | `/api/forward/dxy/admin/metrics/recompute` | Recompute metrics |
| GET | `/api/forward/dxy/admin/stats` | Signal/outcome statistics |
| GET | `/api/forward/dxy/admin/signals` | Get signals for date |
| GET | `/api/forward/dxy/summary` | Forward performance summary |
| GET | `/api/forward/dxy/equity` | Equity curve |
| GET | `/api/forward/dxy/horizons` | Available horizons |

---

## A4 Smoke Tests (REQUIRED)

```bash
# 1) 30d tactical — full pack, tradingEnabled=true
curl -s "http://localhost:8001/api/fractal/dxy/terminal?focus=30d" | jq '{ok, mode: .meta.mode, tradingEnabled: .meta.tradingEnabled, replayWeight: .hybrid.replayWeight, action: .core.decision.action}'
# Expected: {"ok":true,"mode":"tactical","tradingEnabled":true,"replayWeight":0.5,"action":"LONG"|"SHORT"}

# 2) 90d regime — tradingEnabled=false, action=HOLD
curl -s "http://localhost:8001/api/fractal/dxy/terminal?focus=90d" | jq '{ok, mode: .meta.mode, tradingEnabled: .meta.tradingEnabled, action: .core.decision.action, warnings: (.meta.warnings | length)}'
# Expected: {"ok":true,"mode":"regime","tradingEnabled":false,"action":"HOLD","warnings":2}

# 3) Rank switch — different matchId
curl -s "http://localhost:8001/api/fractal/dxy/terminal?focus=30d&rank=1" | jq -r '.replay.matchId'
curl -s "http://localhost:8001/api/fractal/dxy/terminal?focus=30d&rank=2" | jq -r '.replay.matchId'
# Expected: Different matchIds

# 4) Bands monotonicity — p10 <= p50 <= p90
curl -s "http://localhost:8001/api/fractal/dxy/terminal?focus=30d" | jq '[.synthetic.bands.p10[-1].value, .synthetic.bands.p50[-1].value, .synthetic.bands.p90[-1].value] | .[0] <= .[1] and .[1] <= .[2]'
# Expected: true

# 5) Health check
curl -s http://localhost:8001/api/health | jq -r '.ok'
# Expected: true
```

---

## Collections

| Collection | Description |
|------------|-------------|
| `dxy_candles` | OHLCV data (73 years, 18k+ candles) |
| `dxy_meta` | Metadata/checksums |
| `dxy_forward_signals` | Forward signals |
| `dxy_forward_outcomes` | Resolved outcomes |
| `dxy_forward_metrics` | Cached metrics |
| `dxy_walk_signals` | Walk-forward signals |
| `dxy_walk_outcomes` | Walk-forward outcomes |
| `dxy_walk_metrics` | Walk-forward metrics |
| `dxy_calibration_runs` | Calibration results |

---

## A3.8 Horizon-Specific Defaults

| Horizon | Mode | Trading | WindowLen | Threshold | WeightMode | TopK |
|---------|------|---------|-----------|-----------|------------|------|
| 7d | tactical | ✅ | 180 | 0.01 | W2 | 10 |
| 14d | tactical | ✅ | 180 | 0.01 | W2 | 10 |
| 30d | tactical | ✅ | 180 | 0.01 | W2 | 10 |
| 90d | regime | ❌ | 600 | 0.03 | W2 | 10 |
| 180d | regime | ❌ | 600 | 0.03 | W2 | 10 |
| 365d | regime | ❌ | 600 | 0.03 | W2 | 10 |

**Config file:** `/backend/src/modules/dxy/config/dxy.defaults.ts`

---

## File Structure

```
/app/backend/src/modules/dxy/
├── index.ts
├── FROZEN.md                          ← THIS FILE
├── contracts/
│   ├── dxy.types.ts
│   ├── dxy.replay.contract.ts
│   └── dxy_terminal.contract.ts       ← A4
├── config/
│   └── dxy.defaults.ts                ← A3.8
├── storage/
│   └── dxy-candles.model.ts
├── services/
│   ├── dxy-chart.service.ts
│   ├── dxy-scan.service.ts
│   ├── dxy-replay.service.ts
│   ├── dxy-focus-pack.service.ts
│   ├── dxy-synthetic.service.ts
│   ├── dxy-normalize.service.ts
│   ├── dxy-similarity.service.ts
│   ├── dxy-ingest.service.ts
│   └── dxy_terminal.service.ts        ← A4
├── utils/
│   ├── normalize.ts
│   └── hybrid_blend.ts                ← A4
├── api/
│   ├── dxy.fractal.routes.ts
│   ├── dxy.terminal.routes.ts         ← A4
│   ├── dxy.chart.routes.ts
│   └── dxy.admin.routes.ts
├── walk/                              ← A3.5
└── forward/                           ← D4
```

---

## Change Policy

1. **Bug fixes only** — no new features without version bump
2. **No BTC/SPX imports** — isolation must be maintained
3. **Backward compatible** — existing endpoints must not break
4. **Test after change** — run smoke test before commit

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.0.0 | 2026-02-24 | Initial freeze |
| v1.1.0 | 2026-02-25 | A3.8 + A4 Terminal |

---

## Contact

For questions about this frozen module, check git history for original author.
