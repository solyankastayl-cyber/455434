# Architecture v2.3 — Capital Scaling (Risk Budget Targeting)

## Overview

v2.3 introduces **Capital Scaling** — an institutional-grade risk budget targeting layer that scales risk allocations based on volatility, tail risk, and market regime.

### Version Info
- System Version: `2.2.0-production-baseline` (FROZEN)
- Capital Scaling Version: `2.3.0-shadow`
- Freeze Status: Core modules frozen, Capital Scaling in shadow mode

---

## Pipeline Architecture

```
Macro → Quantile → CrossAsset → MetaMemory
  → Brain → Shrink → GlobalScale → Optimizer
  → Capital Scaling (Risk Targeting)  ← NEW v2.3
  → Allocations
```

---

## Capital Scaling Math

### 1. Base Risk Budget
```
baseRiskBudget = 0.65 (configurable)
```

### 2. Vol Targeting
```
volScale = clamp(targetVol / realizedVol, 0.80, 1.20)
```
- Higher realized vol → lower scale (reduce risk)
- Lower realized vol → higher scale (more risk)

### 3. Tail Risk Penalty
```
tailScore = clamp01((tailRisk - 0.03) / 0.07)
tailScale = 1 - tailPenaltyMax × tailScore
```
- Starts penalizing at 3% tail risk
- Maximum penalty at 10% tail risk

### 4. Regime Scale
```
TAIL scenario  → regimeScale = 0.90
BASE scenario  → regimeScale = 1.00
RISK scenario  → regimeScale = 1.02
```

### 5. Final Risk Budget
```
rawRiskBudget = baseRiskBudget × volScale × tailScale × regimeScale
riskBudgetFinal = clamp(rawRiskBudget, minRiskBudget, maxRiskBudget)
```

### 6. Guard Caps
```
BLOCK  → max 10% risk
CRISIS → max 25% risk
```

### 7. Apply Scaling
```
riskBefore = spx + btc
scaleFactor = riskBudgetFinal / riskBefore

spx' = spx × scaleFactor
btc' = btc × scaleFactor
cash' = 1 - (spx' + btc')
```

---

## Safety Gates

1. **TAIL Safety Gate**: No risk increase in TAIL scenario
2. **Delta Cap**: Max allocation delta of 10% in normal conditions (15% in crisis)
3. **Guard Dominance**: BLOCK/CRISIS caps override calculated risk budget
4. **Sum Validation**: Always sum to 1.0, normalize if drift detected

---

## Configuration

Located at: `/app/backend/src/modules/capital-scaling/capital_scaling.config.ts`

```typescript
{
  baseRiskBudget: 0.65,
  targetVol: 0.12,
  volClampMin: 0.80,
  volClampMax: 1.20,
  tailPenaltyMax: 0.25,
  minRiskBudget: 0.10,
  maxRiskBudget: 0.80,
  guardCaps: {
    BLOCK: 0.10,
    CRISIS: 0.25
  },
  maxDeltaNormal: 0.10,
  maxDeltaCrisis: 0.15
}
```

---

## API Endpoints

### Capital Scaling Module

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/capital-scaling/health` | GET | Health check & version info |
| `/api/capital-scaling/config` | GET | Get current config |
| `/api/capital-scaling/config` | PATCH | Update config |
| `/api/capital-scaling/config/reset` | POST | Reset to defaults |
| `/api/capital-scaling/preview` | GET | Shadow mode preview |
| `/api/capital-scaling/apply` | POST | Apply scaling |

### Engine Integration

```
GET /api/engine/global?brain=1&optimizer=1&capital=1&capitalMode=shadow
```

Query Parameters:
- `capital=1` — Enable capital scaling
- `capitalMode=shadow|on` — Mode (shadow doesn't change allocations)

---

## Freeze Rules (v2.2 Core)

**DO NOT MODIFY:**
- Brain module (`/modules/brain/`)
- Macro engine (`/modules/macro-engine/`)
- Quantile module (`/modules/quantile/`)
- CrossAsset module (`/modules/cross-asset/`)
- MetaRisk module (`/modules/meta-risk/`)
- Optimizer module (`/modules/brain/optimizer/`)

**Blocked:**
- Adaptive auto-promote (blocked by SYSTEM_FREEZE)
- Scenario prior changes
- MetaRisk cap modifications

---

## Shadow → Production Activation

1. Run P13 backtest with `capitalMode=shadow`
2. Validate metrics:
   - MaxDD ≤ baseline
   - Sharpe ≥ current
   - CAGR not worse than -1%
3. If validated, update:
   ```typescript
   CAPITAL_SCALING_VERSION = "2.3.0-production"
   ```
4. Set `capitalMode=on` as default

---

## Files Structure

```
/app/backend/src/
├── core/
│   └── version.ts              # System version & freeze state
├── modules/
│   └── capital-scaling/
│       ├── index.ts            # Module exports
│       ├── capital_scaling.contract.ts   # Type definitions
│       ├── capital_scaling.config.ts     # Configuration
│       ├── capital_scaling.service.ts    # Core logic
│       └── capital_scaling.routes.ts     # API routes
└── config/
    └── production_snapshot_v2_2.json     # Frozen config snapshot
```

---

## Contract (CapitalScalingPack)

```typescript
{
  mode: "off" | "on" | "shadow",
  baseRiskBudget: number,
  riskBudgetBefore: number,
  riskBudgetAfter: number,
  scaleFactor: number,
  drivers: {
    volScale: number,
    tailScale: number,
    regimeScale: number,
    guardAdjusted: boolean,
    clamp: boolean
  },
  before: { spx, btc, cash },
  after: { spx, btc, cash },
  hash: string,          // Determinism check
  timestamp: string,
  warnings: string[]
}
```

---

## Result

After v2.3:
- **Institutional risk targeting** — Risk budget adapts to market conditions
- **Vol targeting** — Automatic risk adjustment based on volatility
- **Tail protection** — Penalty for elevated tail risk
- **Guard integration** — BLOCK/CRISIS caps respected
- **Shadow mode** — Safe testing without affecting production allocations
