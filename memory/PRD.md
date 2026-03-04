# TA Engine PRD - Self-Learning Technical Analysis System

## Original Problem Statement
Модульный TA Engine для production-ready системы технического анализа. Standalone backend module с самообучающимся ML pipeline. Цель: research/backtesting engine где модель не видит будущее, каждый сигнал — эксперимент, outcome строго по протоколу, система учится на ошибках.

## Architecture
- **Backend**: TypeScript/Node.js на порту 8002
- **ML Pipeline**: Python (LightGBM) для тренировки и inference
- **MongoDB**: хранение данных (ta_* коллекции)
- **Modular**: modules/ta/ готов к извлечению как пакет

## Complete ML Flow
\`\`\`
Candles → TA Detection → Scenario → Simulation → 
Position → Outcome → Dataset v2 (80 features) → 
ML Training → Model Registry → SHADOW Inference → 
Quality Gates → LIVE Rollout
\`\`\`

## Implemented Phases ✅

### Phase 3.0 - Execution Simulator v1 ✅
- Deterministic simulation, no lookahead bias
- STOP-first, fees 4bps, slippage by TF

### Phase 3.1 - Dataset Auto Writer ✅
- Auto-write ML row on position close

### Phase 5 - Dataset Builder v2 ✅
- **80 Features** in 10 groups
- Export: CSV, JSONL, Feature Matrix

### Phase 6 - ML Training Pipeline ✅ (2026-03-04)
**Complete ML infrastructure:**

**Python Scripts (/app/ml/):**
- `train.py` - LightGBM WIN_PROB classifier
- `predict.py` - Inference runner
- `drift.py` - PSI-based drift detection

**TypeScript Services:**
- `registry.service.ts` - Model lifecycle management
- `overlay.service.ts` - ML overlay with safety gates
- `storage.ts` - MongoDB persistence

**Quality Gates (per stage):**
| Stage | Min Rows | Min AUC | Max ECE | Max Delta |
|-------|----------|---------|---------|-----------|
| SHADOW | 200 | - | - | 1.0 |
| LIVE_LITE | 5,000 | 0.56 | 0.08 | 0.15 |
| LIVE_MED | 25,000 | 0.60 | 0.06 | 0.25 |
| LIVE_FULL | 100,000 | 0.63 | 0.05 | 0.35 |

**Rollout Protocol:**
1. SHADOW: ML predicts but doesn't influence final probability
2. LIVE_LITE: alpha=0.15 blend
3. LIVE_MED: alpha=0.35, can rerank scenarios
4. LIVE_FULL: alpha=0.60, influences risk pack

**API Endpoints:**
\`\`\`
# Registry
GET  /api/ta/ml/registry/models           - List models
GET  /api/ta/ml/registry/models/:id       - Model details
POST /api/ta/ml/registry/register         - Register artifact
POST /api/ta/ml/registry/train            - Train new model
POST /api/ta/ml/registry/models/:id/stage - Set stage
POST /api/ta/ml/registry/models/:id/enable

# Rollout
GET  /api/ta/ml/rollout/check/:id         - Quality gate check

# Overlay
GET  /api/ta/ml/overlay_v2/status         - Active model status
POST /api/ta/ml/overlay_v2/predict        - ML prediction
GET  /api/ta/ml/overlay_v2/config
\`\`\`

## Test Results
- Phase 6: 100% (6/6 tests passed)
- Model trained: AUC=0.50, ECE=0.046
- ML inference working in SHADOW mode

## System Status

| Component | Status |
|-----------|--------|
| TA Detection | 75% |
| Simulation | 85% |
| Dataset v2 | 100% |
| ML Training | 100% |
| ML Inference | 100% |
| **Overall** | **~90%** |

## Current Model
- **model_001** (SHADOW, enabled)
- Rows: 405
- AUC: 0.50 (needs more data)
- ECE: 0.046 (excellent calibration)

## Next Steps (Prioritized)

### P0 - Data Accumulation
- Run more simulations to accumulate 5,000+ rows
- Add more symbols: ETH, SPX, NASDAQ

### P1 - Pattern Geometry Engine
- Pass full pattern geometry to feature extractor
- Improve feature quality for better AUC

### P2 - Phase AG: Market Structure Graph
- Pattern relationships
- State transitions

## Key Files
\`\`\`
/app/ml/
├── train.py              # LightGBM training
├── predict.py            # Inference
├── drift.py              # PSI drift detection
└── requirements.txt

/app/backend/src/modules/ta/ml/training/
├── domain.ts             # Type definitions
├── storage.ts            # MongoDB operations
├── registry.service.ts   # Model lifecycle
├── overlay.service.ts    # ML overlay
└── index.ts

/app/ml_artifacts/
└── model_001/
    ├── model.joblib      # Trained model
    ├── meta.json         # Metrics
    └── feature_importance.csv
\`\`\`

## Usage Example
\`\`\`bash
# Train model
curl -X POST localhost:8002/api/ta/ml/registry/train

# Check if can go LIVE
curl "localhost:8002/api/ta/ml/rollout/check/model_001?targetStage=LIVE_LITE"

# Get ML prediction
curl -X POST localhost:8002/api/ta/ml/overlay_v2/predict \
  -H "Content-Type: application/json" \
  -d '{"baseProbability": 0.6, "features": {...}}'
\`\`\`

---
Updated: 2026-03-04
Version: 6.0.0 (ML Pipeline Complete)
