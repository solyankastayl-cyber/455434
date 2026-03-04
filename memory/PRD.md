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
Simulation → Position Management → Outcome → ML Dataset
\`\`\`

## Implemented Phases ✅

### Phase K-W (Previous) ✅
- ML Dataset Builder, ML Overlay, Multi-Timeframe
- Production Hardening, Real-Time Streaming
- Pattern Engine Expansion (99 patterns, 23 detectors)
- Replay Engine, ML Pipeline

### Phase AE2 - Behaviour Intelligence ✅
- BehaviourModelBuilder, Bayesian shrinkage
- Boost calculation with limits
- Probability pipeline: textbook → confluence → calibration → behaviourBoost → ML overlay → final

### Phase AF - Pattern Discovery Engine ✅
- Discovery Pipeline: zigzag → embedding → K-Means → validation
- 5 discovered patterns (DISCOVERY_C1-C5)

### Phase AD - Multi-Timeframe Generalization ✅
- 8 Supported Timeframes: 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M
- Scaling factors per TF

### Phase AE1 - Scenario Behaviour Storage ✅
- Key: Pattern + Protocol + Context
- 16 default trading protocols

### Phase AC - Projection Engine ✅
- Projectors: triangle, flag, HS, harmonic, elliott, channel
- Confirmation stack with contribution scores

### Phase 3.0 - Execution Simulator v1 ✅ (2026-03-04)
**Core Components:**
- **SimRunner**: Steps through candles, gets decisions, creates/fills orders, manages positions
- **MarketDataProvider**: Deterministic seeded RNG (mulberry32) for reproducible candles
- **DecisionProvider**: Uses analyzeWithCandles() — NO lookahead bias
- **Execution Engine**: Order creation, fill logic (MARKET/STOP_MARKET/LIMIT)
- **Fill Logic**: Slippage, fees, stop/target checks, STOP-first for same-candle exits

**Key Properties:**
- Deterministic: Same (symbol, tf, range, seed) → identical results
- No Lookahead: Leakage guard validates max window ts == nowTs each step
- Conservative: stopFirst=true, fees 4bps, slippage 3-10bps by TF

**Collections:**
- ta_sim_runs, ta_sim_orders, ta_sim_positions, ta_sim_events

### Phase 3.1 - Replay→Dataset Auto Writer ✅ (2026-03-04)
**Новая функциональность:**
- Автоматическая запись ML row при закрытии позиции
- Collection: ta_ml_rows_v1
- Features extraction при position close
- Label computation: r > 0 → 1 (win), else 0 (loss)
- Metadata: rMultiple, mfePct, maePct, barsInTrade, exitReason, side

**API Endpoints:**
\`\`\`
GET  /api/ta/sim/dataset_hook/config   - Hook configuration
POST /api/ta/sim/dataset_hook/config   - Update config
POST /api/ta/sim/dataset_hook/backfill - Backfill from existing positions
\`\`\`

**Hook Config:**
- enabled: true
- minRForWrite: -5 (filter massive losses)
- maxRForWrite: 10 (filter outliers)
- writeOnTimeout: true

## API Endpoints

### Simulator (Phase 3.0)
\`\`\`
GET  /api/ta/sim/stats              - Simulator statistics
GET  /api/ta/sim/config?tf=1d       - Config per timeframe
POST /api/ta/sim/run                - Run simulation
GET  /api/ta/sim/status?runId=X     - Run status
GET  /api/ta/sim/runs               - Recent runs list
GET  /api/ta/sim/positions?runId=X  - Positions from run
GET  /api/ta/sim/orders?runId=X     - Orders from run
GET  /api/ta/sim/summary?runId=X    - Summary analytics
\`\`\`

### ML Dataset (Phase 3.1)
\`\`\`
GET  /api/ta/ml/dataset/status      - Dataset stats
GET  /api/ta/ml/dataset/preview?n=10- Preview rows
GET  /api/ta/ml/dataset/export      - Export CSV
GET  /api/ta/ml/dataset/schema      - Feature schema
\`\`\`

## Test Results
- Phase 3.0: 16/16 tests passed, determinism verified
- Phase 3.1: Simulation 9 trades → 9 ML rows auto-written

## Engine Stats
- **Patterns**: 99 registered
- **Detectors**: 23 total
- **Projectors**: 6 (triangle, flag, HS, harmonic, elliott, channel)
- **ML Features**: 54

## Next Steps (Prioritized Backlog)

### P0 - Current Sprint
- [x] Phase 3.0 Execution Simulator v1
- [x] Phase 3.1 Dataset Auto Writer

### P1 - Next Phase
- [ ] Phase 5 - Dataset Builder v2
  - Enhanced features (market structure, pattern geometry)
  - Export Parquet/CSV with rich metadata

### P1 - Training Pipeline
- [ ] Phase 6 - Training + Registry + Rollout
  - Training job (Python: LightGBM/CatBoost)
  - Model registry with quality gates (AUC, ECE)
  - Safe rollout: SHADOW → LIVE

### P2 - Advanced
- [ ] Phase AG - Market Structure Graph
  - Pattern relationships graph
  - State transition analysis

- [ ] Phase AH - Dynamic Pattern Integration
  - Auto-integrate discovered patterns

- [ ] Phase AI - Adaptive Learning
  - Self-learning loop: error → understand → retrain

## Key Files
\`\`\`
/app/backend/src/modules/ta/
├── simulator/
│   ├── domain.ts          # Types (SimOrder, SimPosition, etc)
│   ├── config.ts          # Simulator config per TF
│   ├── fill.ts            # Fill logic, slippage, MFE/MAE
│   ├── execution.ts       # Order creation, position lifecycle
│   ├── storage.ts         # MongoDB operations
│   ├── runner.ts          # Main simulation loop
│   └── dataset_hook.ts    # Phase 3.1: Auto ML row writer
├── ml/
│   ├── feature_schema.ts  # ML feature definitions
│   ├── feature_extractor.ts
│   ├── dataset_writer.ts  # Write to ta_ml_rows_v1
│   └── model_registry.ts
├── runtime/
│   └── ta.controller.ts   # API endpoints
└── ...
\`\`\`

## Modularity
TA Engine готов к извлечению как отдельный пакет:
- Зависит только от interfaces (MarketDataProvider, StorageProvider)
- Не знает о auth, users, frontend, telegram
- modules/ta/ можно скопировать в любой проект

---
Updated: 2026-03-04
Version: 3.1.0
