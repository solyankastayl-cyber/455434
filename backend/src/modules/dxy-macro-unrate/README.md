# DXY Macro UNRATE Module — D6 v3

## Purpose
Adds unemployment rate (UNRATE) context as an additional macro layer for DXY analysis.

## Isolation Rules
- ❌ MUST NOT import from `/modules/btc`
- ❌ MUST NOT import from `/modules/spx`
- ❌ MUST NOT modify `/modules/dxy` core
- ✅ Only reads DXY fractal output

## Data Source
- **FRED Series**: UNRATE (Civilian Unemployment Rate)
- **Coverage**: 1948-present (~77 years)
- **Frequency**: Monthly

## Computed Metrics
| Metric | Description |
|--------|-------------|
| `current` | Current unemployment rate (%) |
| `delta3m` | 3-month change (percentage points) |
| `delta12m` | 12-month change (percentage points) |
| `trend` | UP/DOWN/FLAT based on delta3m |
| `regime` | TIGHT (≤4%) / NORMAL (4-6%) / STRESS (>6%) |
| `pressure` | -1 to +1, based on delta12m |

## Regime Definitions
- **TIGHT**: ≤4.0% — Very low unemployment, tight labor market
- **NORMAL**: 4.0-6.0% — Normal labor market conditions
- **STRESS**: >6.0% — Elevated unemployment, stressed labor market

## Adjustment Logic
```
Rising unemployment → Risk-off → USD strength → positive pressure
Falling unemployment → Risk-on → USD pressure → negative pressure

multiplier = clamp(1 + pressure × 0.10, 0.90, 1.10)
```

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dxy-macro/unrate-context` | Current context |
| GET | `/api/dxy-macro/unrate-history?months=N` | History |
| POST | `/api/dxy-macro/admin/unrate/ingest` | Ingest data |
| GET | `/api/dxy-macro/admin/unrate/meta` | Data meta |
