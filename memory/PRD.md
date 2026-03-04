# TA Engine PRD - Self-Learning Technical Analysis System

## Original Problem Statement
Модульный TA Engine для production-ready системы технического анализа. Standalone backend module для интеграции в другие проекты. Цель: самообучающийся research/backtesting engine где модель не видит будущее, каждый сигнал — эксперимент, outcome строго по протоколу.

## Architecture
- **Backend**: TypeScript/Node.js на порту 8002
- **MongoDB**: хранение данных (ta_* коллекции)
- **Modular**: modules/ta/ готов к извлечению как пакет
- **Provider abstraction**: MarketDataProvider, IndicatorProvider, StorageProvider

## Core Flow
\`\`\`
Candles → Feature Engine → Pattern Detection → Geometry → 
Confirmation Stack → Projection Engine → Probability → 
Simulation → Position Management → Outcome → ML Dataset v2
\`\`\`

## Implemented Phases ✅

### Previous Phases ✅
- Phase K-W: ML Dataset Builder, ML Overlay, Multi-Timeframe, Production Hardening
- Phase AE2: Behaviour Intelligence
- Phase AF: Pattern Discovery Engine (5 discovered patterns)
- Phase AD: Multi-Timeframe (8 TFs)
- Phase AC: Projection Engine (6 projectors)

### Phase 3.0 - Execution Simulator v1 ✅ (2026-03-04)
- Deterministic simulation (seeded RNG)
- No lookahead bias (leakage guard)
- STOP-first, fees 4bps, slippage by TF
- Collections: ta_sim_runs, ta_sim_orders, ta_sim_positions

### Phase 3.1 - Dataset Auto Writer ✅ (2026-03-04)
- Auto-write ML row on position close
- Supports v1 and v2 schemas

### Phase 5 - Dataset Builder v2 ✅ (2026-03-04)
**~80 Features organized in 10 groups:**

| Group | Features | Description |
|-------|----------|-------------|
| Pattern Geometry | 15 | height, width, slopes, symmetry, compression |
| Pattern Context | 10 | trend direction/strength, pivot density |
| Support/Resistance | 10 | distance to S/R, strength, liquidity |
| Volatility | 8 | ATR, percentile, regime, expansion/compression |
| Momentum | 8 | RSI, MACD, velocity, divergence |
| Volume | 6 | mean, spike, trend, divergence |
| Market Structure | 7 | phase, BOS count, structure strength |
| Risk | 6 | stop distance, RR, entry quality |
| Pattern Reliability | 6 | prior winrate, cluster density |
| Time | 4 | day of week, month, session |

**API Endpoints:**
\`\`\`
GET  /api/ta/ml/dataset_v2/status        - Status with stats
GET  /api/ta/ml/dataset_v2/rows          - Get rows with pagination
GET  /api/ta/ml/dataset_v2/schema        - Feature schema
GET  /api/ta/ml/dataset_v2/export/csv    - Export to CSV
GET  /api/ta/ml/dataset_v2/export/jsonl  - Export to JSONL (for Parquet)
GET  /api/ta/ml/dataset_v2/export/matrix - Export X, y, meta for ML
GET  /api/ta/ml/dataset_v2/stats/:groupBy - Stats by pattern/side/etc
\`\`\`

**Labels:**
- winLoss (1/0)
- rMultiple
- mfePct (Max Favorable Excursion)
- maePct (Max Adverse Excursion)
- barsInTrade

## Test Results
- Phase 5: 100% (6/6 tests passed)
- 95+ ML rows in v2 dataset
- CSV export working

## Engine Stats
- **Patterns**: 99 registered
- **Detectors**: 23 total
- **Projectors**: 6
- **ML Features v2**: 80

## Next Steps (Prioritized Backlog)

### P0 - Next Phase
- [ ] **Phase 6 — ML Training + Registry + Rollout**
  - Training job (Python: LightGBM/CatBoost)
  - Model registry with quality gates (AUC, ECE, maxDelta)
  - Rollout states: SHADOW → LIVE_LITE → LIVE_MED → LIVE_FULL
  - Backtest comparison against baseline

### P1 - Enhancements
- [ ] Pattern Geometry Engine (передача геометрии в features)
- [ ] Full context passing from simulation to extractor

### P2 - Advanced
- [ ] Phase AG - Market Structure Graph
- [ ] Phase AH - Dynamic Pattern Integration
- [ ] Phase AI - Adaptive Learning

## Key Files
\`\`\`
/app/backend/src/modules/ta/
├── simulator/
│   ├── runner.ts          # Simulation loop
│   └── dataset_hook.ts    # Auto ML row writer
├── ml/
│   ├── feature_schema_v2.ts    # 80 feature definitions
│   ├── feature_extractor_v2.ts # Feature extraction
│   └── dataset_writer_v2.ts    # MongoDB + CSV/JSONL export
└── runtime/
    └── ta.controller.ts    # API endpoints
\`\`\`

## Ready for ML Training
System now generates:
\`\`\`
symbol + timeframe + 80 features + labels (R, MFE, MAE, bars)
\`\`\`

Export to CSV/JSONL for Python ML training:
\`\`\`bash
curl http://localhost:8002/api/ta/ml/dataset_v2/export/csv > dataset.csv
\`\`\`

---
Updated: 2026-03-04
Version: 5.0.0
