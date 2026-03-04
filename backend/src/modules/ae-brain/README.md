# AE Brain Module (C-Track)

## Overview

AE Brain is the intelligence layer that aggregates all system state and provides:
- Global state vector (C1)
- Regime classification (C2)
- Causal graph (C3)
- Scenario probabilities (C4)
- Novelty detection (C5)

## Architecture

```
/modules/ae-brain/
├── contracts/           # Type definitions
├── services/            # Business logic
├── storage/             # MongoDB models
├── api/                 # Fastify routes
├── utils/               # Math utilities
└── tests/               # Test files
```

## Components

### C1 — State Vector Aggregator
Builds normalized state from DXY terminal + macro + guard.

**Output:**
```json
{
  "asOf": "2026-02-25",
  "vector": {
    "macroSigned": -0.09,       // [-1..1]
    "macroConfidence": 0.78,    // [0..1]
    "guardLevel": 0.66,         // [0..1] NONE=0, WARN=0.33, CRISIS=0.66, BLOCK=1.0
    "dxySignalSigned": -0.42,   // [-1..1]
    "dxyConfidence": 0.86,      // [0..1]
    "regimeBias90d": -0.15      // [-1..1]
  },
  "health": { "ok": true, "missing": [] }
}
```

### C2 — Regime Classifier
State machine for market regime:
- LIQUIDITY_EXPANSION
- LIQUIDITY_CONTRACTION
- DOLLAR_DOMINANCE
- DISINFLATION_PIVOT
- RISK_OFF_STRESS
- NEUTRAL_MIXED

### C3 — Causal Graph
Rule-based causal links with dynamic weights:
- Rates → USD (+)
- CreditStress → SPX (-)
- Liquidity → BTC (+)
- USD → BTC (-)

### C4 — Scenario Engine
3 scenarios with softmax probabilities:
- BASE
- BULL_RISK_ON
- BEAR_STRESS

### C5 — Novelty Detection
KNN cosine distance for unseen configurations:
- KNOWN (< 0.12)
- RARE (0.12-0.18)
- UNSEEN (> 0.18)

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ae/health` | Module health |
| GET | `/api/ae/state` | C1 state vector |
| GET | `/api/ae/regime` | C2 regime classification |
| GET | `/api/ae/causal` | C3 causal graph |
| GET | `/api/ae/scenarios` | C4 scenarios |
| GET | `/api/ae/novelty` | C5 novelty score |
| GET | `/api/ae/terminal` | Full terminal pack |
| POST | `/api/ae/admin/snapshot` | Save state to DB |

## Usage

```bash
# Get full terminal
curl http://localhost:8001/api/ae/terminal

# Snapshot current state
curl -X POST "http://localhost:8001/api/ae/admin/snapshot?asOf=2026-02-25"

# Get novelty score
curl "http://localhost:8001/api/ae/novelty?asOf=2026-02-25"
```

## Isolation Rules

- ONLY imports from `dxy-macro-core` and `dxy` (read-only)
- NO imports from `spx`, `btc`, or other modules
- All outputs are deterministic (no LLM)

## Version

C1-C5 (2026-02-25)
