/**
 * FRACTAL ONLY - Isolated Development Entrypoint
 * 
 * Minimal bootstrap for Fractal + ML + MongoDB only.
 * No Exchange, On-chain, Sentiment, WebSocket, Telegram etc.
 * 
 * Run: npx tsx src/app.fractal.ts
 */

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { connectMongo, disconnectMongo } from './db/mongoose.js';
import { registerFractalModule } from './modules/fractal/index.js';
import { registerBtcRoutes } from './modules/btc/index.js';
import { registerSpxRoutes } from './modules/spx/index.js';
import { registerSpxCoreRoutes } from './modules/spx-core/index.js';
import { registerCombinedRoutes } from './modules/combined/index.js';
import { adminAuthRoutes } from './core/admin/admin.auth.routes.js';
import { registerSpxMemoryRoutes } from './modules/spx-memory/spx-memory.routes.js';
import { registerSpxAttributionRoutes } from './modules/spx-attribution/spx-attribution.routes.js';
import { registerSpxDriftRoutes } from './modules/spx-drift/spx-drift.routes.js';
import { registerSpxConsensusRoutes } from './modules/spx-consensus/spx-consensus.routes.js';
import { registerSpxCalibrationRoutes } from './modules/spx-calibration/spx-calibration.routes.js';
import { registerSpxRulesRoutes } from './modules/spx-rules/spx-rules.routes.js';
import { registerSpxGuardrailsRoutes } from './modules/spx-guardrails/spx-guardrails.routes.js';
import { registerSpxCrisisRoutes, registerSpxCrisisDebugRoutes } from './modules/spx-crisis/spx-crisis.routes.js';
import { registerSpxRegimeRoutes } from './modules/spx-regime/regime.routes.js';
import { registerLifecycleRoutes } from './modules/lifecycle/lifecycle.routes.js';
import { registerDailyRunRoutes } from './modules/ops/daily-run/index.js';
import { registerSpxUnifiedRoutes } from './modules/fractal/api/fractal.spx.routes.js';
import { registerForwardAdminRoutes } from './modules/forward/api/forward.admin.routes.js';
import { registerDxyModule } from './modules/dxy/index.js';
import modelConfigRoutes from './modules/fractal/config/model-config.routes.js';
import lifecycleAdminRoutes from './modules/fractal/lifecycle/lifecycle.admin.routes.js';
import { getMongoDb } from './db/mongoose.js';
import { registerFreezeMiddleware, isFrozen } from './middleware/freeze.middleware.js';
import fs from 'fs';
import path from 'path';

/**
 * COLD START: Auto-load data from CSV files if MongoDB is empty
 * Ensures the system works "out of the box" after fresh deployment
 * 
 * SPX/BTC Data Sources (in priority order):
 * 1. Bootstrap seed files in repo (/app/backend/data/fractal/bootstrap/)
 * 2. Data directory (/app/data/) - may not persist across deploys
 */

const SPX_MIN_REQUIRED = 10000; // Minimum candles for fractal to work
const BTC_MIN_REQUIRED = 1000;

async function coldStartDataCheck() {
  const db = getMongoDb();
  
  // ═══════════════════════════════════════════════════════════════
  // SPX CANDLES — Check and bootstrap if needed
  // ═══════════════════════════════════════════════════════════════
  const spxCount = await db.collection('spx_candles').countDocuments();
  console.log(`[Cold Start] SPX candles in DB: ${spxCount}`);
  
  if (spxCount < SPX_MIN_REQUIRED) {
    console.log(`[Cold Start] SPX data insufficient (${spxCount} < ${SPX_MIN_REQUIRED}), bootstrapping...`);
    
    // Priority: bootstrap seed (in repo) > data directory (may not persist)
    const seedPaths = [
      '/app/backend/data/fractal/bootstrap/spx_stooq_seed.csv', // Primary: repo seed
      '/app/data/spx_stooq.csv', // Fallback: data directory
    ];
    
    let loaded = false;
    for (const csvPath of seedPaths) {
      if (fs.existsSync(csvPath)) {
        console.log(`[Cold Start] Found SPX seed at: ${csvPath}`);
        try {
          const csvContent = fs.readFileSync(csvPath, 'utf-8');
          const lines = csvContent.trim().split('\n');
          
          // Parse CSV (Date,Open,High,Low,Close,Volume format)
          const candles: any[] = [];
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            if (parts.length >= 5) {
              const dateStr = parts[0].trim();
              const open = parseFloat(parts[1]);
              const high = parseFloat(parts[2]);
              const low = parseFloat(parts[3]);
              const close = parseFloat(parts[4]);
              const volume = parts[5] ? parseFloat(parts[5]) : 0;
              
              // Parse date string to timestamp for indexing
              const dateParts = dateStr.split('-');
              const ts = new Date(
                parseInt(dateParts[0]),
                parseInt(dateParts[1]) - 1,
                parseInt(dateParts[2])
              ).getTime();
              
              if (dateStr && !isNaN(close) && !isNaN(ts)) {
                candles.push({
                  date: dateStr,
                  ts, // Timestamp for queries
                  open,
                  high,
                  low,
                  close,
                  volume,
                  symbol: 'SPX',
                  source: 'COLD_START_SEED',
                  insertedAt: new Date()
                });
              }
            }
          }
          
          if (candles.length > 0) {
            // Bulk upsert
            const bulkOps = candles.map(c => ({
              updateOne: {
                filter: { date: c.date, symbol: 'SPX' },
                update: { $set: c },
                upsert: true
              }
            }));
            
            const result = await db.collection('spx_candles').bulkWrite(bulkOps, { ordered: false });
            console.log(`[Cold Start] ✅ SPX bootstrap complete: ${result.upsertedCount + result.modifiedCount} candles loaded`);
            loaded = true;
            break;
          }
        } catch (err) {
          console.error(`[Cold Start] Failed to load SPX from ${csvPath}:`, err);
        }
      }
    }
    
    if (!loaded) {
      console.error('[Cold Start] ❌ CRITICAL: No SPX seed found! Fractal SPX will not work.');
    }
  } else {
    console.log(`[Cold Start] ✅ SPX data OK (${spxCount} candles)`);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // BTC CANDLES — Check (loads on-demand via API if missing)
  // ═══════════════════════════════════════════════════════════════
  const btcCount = await db.collection('fractal_canonical_ohlcv').countDocuments();
  console.log(`[Cold Start] BTC candles in DB: ${btcCount}`);
  
  if (btcCount < BTC_MIN_REQUIRED) {
    console.log(`[Cold Start] ⚠️ BTC data insufficient (${btcCount} < ${BTC_MIN_REQUIRED}) - will load on first request`);
  } else {
    console.log(`[Cold Start] ✅ BTC data OK (${btcCount} candles)`);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DXY CANDLES — Check and bootstrap if needed (BACKEND-ONLY)
  // Extended seed: FRED DTWEXM (1973-2005) + Stooq (2006-2026)
  // coverageYears: 53 years, ~13,000 candles
  // ═══════════════════════════════════════════════════════════════
  const DXY_MIN_REQUIRED = 10000; // ~40+ years minimum for proper fractal
  const dxyCount = await db.collection('dxy_candles').countDocuments();
  console.log(`[Cold Start] DXY candles in DB: ${dxyCount}`);
  
  if (dxyCount < DXY_MIN_REQUIRED) {
    console.log(`[Cold Start] DXY data insufficient (${dxyCount} < ${DXY_MIN_REQUIRED}), bootstrapping...`);
    
    const dxySeedPaths = [
      '/app/backend/data/fractal/bootstrap/dxy_extended_seed.csv', // Primary: extended 1973+ data
      '/app/backend/data/fractal/bootstrap/dxy_stooq_seed.csv', // Fallback: 2006+ only
      '/app/data/dxy_stooq.csv', // Legacy fallback
    ];
    
    let dxyLoaded = false;
    for (const csvPath of dxySeedPaths) {
      if (fs.existsSync(csvPath)) {
        console.log(`[Cold Start] Found DXY seed at: ${csvPath}`);
        try {
          const csvContent = fs.readFileSync(csvPath, 'utf-8');
          const lines = csvContent.trim().split('\n');
          
          const candles: any[] = [];
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            if (parts.length >= 5) {
              const dateStr = parts[0].trim();
              const open = parseFloat(parts[1]);
              const high = parseFloat(parts[2]);
              const low = parseFloat(parts[3]);
              const close = parseFloat(parts[4]);
              const volume = parts[5] ? parseFloat(parts[5]) : 0;
              
              const dateParts = dateStr.split('-');
              const ts = new Date(
                parseInt(dateParts[0]),
                parseInt(dateParts[1]) - 1,
                parseInt(dateParts[2])
              ).getTime();
              
              if (dateStr && !isNaN(close) && !isNaN(ts)) {
                candles.push({
                  date: dateStr,
                  ts,
                  open,
                  high,
                  low,
                  close,
                  volume,
                  symbol: 'DXY',
                  source: 'COLD_START_SEED',
                  insertedAt: new Date()
                });
              }
            }
          }
          
          if (candles.length > 0) {
            const bulkOps = candles.map(c => ({
              updateOne: {
                filter: { date: c.date, symbol: 'DXY' },
                update: { $set: c },
                upsert: true
              }
            }));
            
            const result = await db.collection('dxy_candles').bulkWrite(bulkOps, { ordered: false });
            console.log(`[Cold Start] ✅ DXY bootstrap complete: ${result.upsertedCount + result.modifiedCount} candles loaded`);
            console.log(`[Cold Start] ⚠️ DXY coverage: 2006+ only. Extended 1973+ data pending manual upload.`);
            dxyLoaded = true;
            break;
          }
        } catch (err) {
          console.error(`[Cold Start] Failed to load DXY from ${csvPath}:`, err);
        }
      }
    }
    
    if (!dxyLoaded) {
      console.error('[Cold Start] ❌ No DXY seed found! Fractal DXY will not work.');
    }
  } else {
    console.log(`[Cold Start] ✅ DXY data OK (${dxyCount} candles)`);
  }
  
  // Ensure indexes - ts for queries, date+symbol for uniqueness
  await db.collection('spx_candles').createIndex({ ts: -1 });
  await db.collection('spx_candles').createIndex({ ts: 1, symbol: 1 }, { unique: true });
  await db.collection('spx_candles').createIndex({ date: 1, symbol: 1 }, { unique: true });
  
  // DXY uses mongoose model with just 'date' field (no ts/symbol)
  await db.collection('dxy_candles').createIndex({ date: -1 }).catch(() => {});
  await db.collection('dxy_candles').createIndex({ date: 1 }, { unique: true }).catch(() => {});
  
  console.log('[Cold Start] ✅ Indexes ensured');
  
  console.log('[Cold Start] Bootstrap complete');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  FRACTAL PLATFORM — Production Mode');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  FROZEN: ${isFrozen() ? 'YES — Mutations blocked' : 'NO'}`);
  console.log(`  VERSION: ${process.env.FREEZE_VERSION || 'dev'}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  // Get port from env or default
  const PORT = parseInt(process.env.PORT || '8001');
  
  // Connect to MongoDB
  console.log('[Fractal] Connecting to MongoDB...');
  await connectMongo();
  
  // Build minimal Fastify app
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });
  
  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  
  // PROD FREEZE MIDDLEWARE — блокирует мутации если SYSTEM_FROZEN=true
  registerFreezeMiddleware(app);
  
  // Health endpoint
  app.get('/api/health', async () => ({
    ok: true,
    mode: 'FRACTAL_ONLY',
    frozen: isFrozen(),
    version: process.env.FREEZE_VERSION || 'dev',
    timestamp: new Date().toISOString()
  }));
  
  // System health endpoint for SystemStatusBanner
  app.get('/api/system/health', async () => ({
    status: 'healthy',
    ts: new Date().toISOString(),
    services: {},
    metrics: { bootstrap: {} },
    notes: [],
  }));
  
  // Register ONLY Fractal module
  console.log('[Fractal] Registering Fractal Module...');
  await registerFractalModule(app);
  console.log('[Fractal] ✅ Fractal Module registered');
  
  // ═══════════════════════════════════════════════════════════════
  // TA MODULE — Technical Analysis Engine (NEW ISOLATED MODULE)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering TA Module (Technical Analysis)...');
  const { registerTaModule } = await import('./modules/ta/index.js');
  await registerTaModule(app);
  console.log('[Fractal] ✅ TA Module registered at /api/ta/*');
  
  // BLOCK A: Register BTC Terminal (Final Product)
  console.log('[Fractal] Registering BTC Terminal (Final)...');
  await registerBtcRoutes(app);
  console.log('[Fractal] ✅ BTC Terminal registered at /api/btc/v2.1/*');
  
  // BLOCK B: Register SPX Terminal (Building)
  console.log('[Fractal] Registering SPX Terminal (Building)...');
  await registerSpxRoutes(app);
  console.log('[Fractal] ✅ SPX Terminal registered at /api/spx/v2.1/*');
  
  // BLOCK B5: Register SPX Core (Fractal Engine)
  console.log('[Fractal] Registering SPX Core (Fractal Engine)...');
  await registerSpxCoreRoutes(app);
  console.log('[Fractal] ✅ SPX Core registered at /api/spx/v2.1/focus-pack');
  
  // BLOCK B6: Register SPX Memory Layer
  console.log('[Fractal] Registering SPX Memory Layer...');
  await registerSpxMemoryRoutes(app);
  console.log('[Fractal] ✅ SPX Memory registered at /api/spx/v2.1/admin/memory/*');
  
  // BLOCK B6.2: Register SPX Attribution
  console.log('[Fractal] Registering SPX Attribution...');
  await registerSpxAttributionRoutes(app);
  console.log('[Fractal] ✅ SPX Attribution registered at /api/spx/v2.1/admin/attribution/*');
  
  // BLOCK B6.3: Register SPX Drift Intelligence
  console.log('[Fractal] Registering SPX Drift Intelligence...');
  await registerSpxDriftRoutes(app);
  console.log('[Fractal] ✅ SPX Drift registered at /api/spx/v2.1/admin/drift/*');
  
  // BLOCK B5.5: Register SPX Consensus Engine
  console.log('[Fractal] Registering SPX Consensus Engine...');
  await registerSpxConsensusRoutes(app);
  console.log('[Fractal] ✅ SPX Consensus registered at /api/spx/v2.1/consensus');
  
  // BLOCK B6.4: Register SPX Calibration
  console.log('[Fractal] Registering SPX Calibration...');
  await registerSpxCalibrationRoutes(app);
  console.log('[Fractal] ✅ SPX Calibration registered at /api/spx/v2.1/admin/calibration/*');
  
  // BLOCK B6.6: Register SPX Rules Extraction
  console.log('[Fractal] Registering SPX Rules Extraction...');
  registerSpxRulesRoutes(app);
  console.log('[Fractal] ✅ SPX Rules registered at /api/spx/v2.1/admin/rules/*');
  
  // BLOCK B6.7: Register SPX Guardrails
  console.log('[Fractal] Registering SPX Guardrails...');
  await registerSpxGuardrailsRoutes(app);
  console.log('[Fractal] ✅ SPX Guardrails registered at /api/spx/v2.1/guardrails/*');
  
  // BLOCK B6.10: Register SPX Crisis Validation
  console.log('[Fractal] Registering SPX Crisis Validation...');
  await registerSpxCrisisRoutes(app);
  await registerSpxCrisisDebugRoutes(app);
  console.log('[Fractal] ✅ SPX Crisis B6.10 registered at /api/spx/v2.1/admin/crisis/*');
  
  // BLOCK B6.11: Register SPX Regime Decomposition Engine
  console.log('[Fractal] Registering SPX Regime Engine...');
  await registerSpxRegimeRoutes(app);
  console.log('[Fractal] ✅ SPX Regime B6.11 registered at /api/spx/v2.1/admin/regimes/*');
  
  // BLOCK L1: Register Unified Lifecycle Engine
  console.log('[Fractal] Registering Unified Lifecycle Engine...');
  await registerLifecycleRoutes(app);
  console.log('[Fractal] ✅ Lifecycle L1 registered at /api/lifecycle/*');
  
  // BLOCK L4.1: Register Daily Run Orchestrator
  console.log('[Fractal] Registering Daily Run Orchestrator...');
  await registerDailyRunRoutes(app);
  console.log('[Fractal] ✅ Daily Run L4.1 registered at /api/ops/daily-run/*');
  
  // BLOCK U1: Register SPX Unified Routes (BTC-compatible contract)
  console.log('[Fractal] Registering SPX Unified Routes (BTC-compatible)...');
  await registerSpxUnifiedRoutes(app);
  console.log('[Fractal] ✅ SPX Unified registered at /api/fractal/spx/*');
  
  // BLOCK FP: Register Forward Performance Admin Routes
  console.log('[Fractal] Registering Forward Performance Admin...');
  await registerForwardAdminRoutes(app);
  console.log('[Fractal] ✅ Forward Admin registered at /api/forward/admin/*');
  
  // BLOCK D: Register DXY Module (ISOLATED)
  console.log('[Fractal] Registering DXY Module (ISOLATED)...');
  await registerDxyModule(app);
  console.log('[Fractal] ✅ DXY Module registered at /api/fractal/dxy/*');
  
  // BLOCK D4: Register DXY Forward Performance
  console.log('[Fractal] Registering DXY Forward Performance...');
  const { registerDxyForwardRoutes } = await import('./modules/dxy/forward/api/dxy_forward.admin.routes.js');
  await registerDxyForwardRoutes(app);
  console.log('[Fractal] ✅ DXY Forward registered at /api/forward/dxy/*');
  
  // BLOCK D6: Register DXY Macro Module (Interest Rate Context)
  console.log('[Fractal] Registering DXY Macro Module (D6)...');
  const { registerDxyMacroModule } = await import('./modules/dxy-macro/index.js');
  await registerDxyMacroModule(app);
  console.log('[Fractal] ✅ DXY Macro registered at /api/fractal/dxy/macro, /api/dxy-macro/*');
  
  // BLOCK D6 v2: Register CPI Macro Module
  console.log('[Fractal] Registering CPI Macro Module (D6 v2)...');
  const { registerCpiModule } = await import('./modules/dxy-macro-cpi/index.js');
  await registerCpiModule(app);
  console.log('[Fractal] ✅ CPI Macro registered at /api/dxy-macro/cpi-*');
  
  // BLOCK D6 v3: Register UNRATE Macro Module
  console.log('[Fractal] Registering UNRATE Macro Module (D6 v3)...');
  const { registerUnrateModule } = await import('./modules/dxy-macro-unrate/index.js');
  await registerUnrateModule(app);
  console.log('[Fractal] ✅ UNRATE Macro registered at /api/dxy-macro/unrate-*');
  
  // BLOCK A3.5: Register DXY Walk-Forward Validation
  console.log('[Fractal] Registering DXY Walk-Forward Validation (A3.5)...');
  const { registerDxyWalkRoutes } = await import('./modules/dxy/walk/dxy-walk.routes.js');
  await registerDxyWalkRoutes(app);
  console.log('[Fractal] ✅ DXY Walk-Forward registered at /api/fractal/dxy/walk/*');
  
  // BLOCK B1: Register DXY Macro Core Platform
  console.log('[Fractal] Registering DXY Macro Core Platform (B1)...');
  const { registerDxyMacroCoreModule } = await import('./modules/dxy-macro-core/index.js');
  await registerDxyMacroCoreModule(app);
  console.log('[Fractal] ✅ DXY Macro Core B1 registered at /api/dxy-macro-core/*');
  
  // NOTE: DXY Audit Routes are already registered in dxy.fractal.routes.ts
  // Duplicate registration removed to prevent FST_ERR_DUPLICATED_ROUTE
  
  // BLOCK C: Register AE Brain Module (C1-C5)
  console.log('[Fractal] Registering AE Brain Module (C1-C5)...');
  const { registerAeRoutes } = await import('./modules/ae-brain/api/ae.routes.js');
  await registerAeRoutes(app);
  console.log('[Fractal] ✅ AE Brain registered at /api/ae/*');
  
  // BLOCK C7: Register AE Cluster Module
  console.log('[Fractal] Registering AE Cluster Module (C7)...');
  const { registerClusterRoutes } = await import('./modules/ae-brain/cluster/api/cluster.routes.js');
  await registerClusterRoutes(app);
  console.log('[Fractal] ✅ AE Cluster registered at /api/ae/cluster/*');
  
  // BLOCK C8: Register AE Transition Module
  console.log('[Fractal] Registering AE Transition Module (C8)...');
  const { registerTransitionRoutes } = await import('./modules/ae-brain/transition/api/transition.routes.js');
  await registerTransitionRoutes(app);
  console.log('[Fractal] ✅ AE Transition registered at /api/ae/transition/*');
  
  // BLOCK D1: Register SPX Cascade Module (DXY/AE → SPX)
  console.log('[Fractal] Registering SPX Cascade Module (D1)...');
  const { registerSpxCascadeRoutes } = await import('./modules/spx-cascade/spx_cascade.routes.js');
  await registerSpxCascadeRoutes(app);
  console.log('[Fractal] ✅ SPX Cascade D1 registered at /api/fractal/spx/cascade');
  
  // BLOCK D1.1: Register SPX Cascade Validation
  console.log('[Fractal] Registering SPX Cascade Validation (D1.1)...');
  const { registerSpxValidationRoutes } = await import('./modules/spx-cascade/spx_validation.routes.js');
  await registerSpxValidationRoutes(app);
  console.log('[Fractal] ✅ SPX Validation D1.1 registered at /api/forward/spx/admin/validate/cascade');
  
  // BLOCK D2: Register BTC Cascade Module (DXY/AE/SPX → BTC)
  console.log('[Fractal] Registering BTC Cascade Module (D2)...');
  const { registerBtcCascadeRoutes } = await import('./modules/btc-cascade/btc_cascade.routes.js');
  await registerBtcCascadeRoutes(app);
  console.log('[Fractal] ✅ BTC Cascade D2 registered at /api/fractal/btc/cascade');
  
  // BLOCK D2.1: Register BTC Cascade Validation
  console.log('[Fractal] Registering BTC Cascade Validation (D2.1)...');
  const { registerBtcValidationRoutes } = await import('./modules/btc-cascade/validation/btc_validation.routes.js');
  await registerBtcValidationRoutes(app);
  console.log('[Fractal] ✅ BTC Validation D2.1 registered at /api/forward/btc/admin/validate/cascade');
  
  // BLOCK P3.3: Register Honest As-Of Bias Check Routes
  console.log('[Fractal] Registering P3.3 Bias Check Routes...');
  const { registerP33BiasCheckRoutes } = await import('./modules/admin/p33_bias_check.routes.js');
  await registerP33BiasCheckRoutes(app);
  console.log('[Fractal] ✅ P3.3 Bias Check registered at /api/p33/*');
  
  // BLOCK P5: Register Engine Global (Asset Allocation Layer)
  console.log('[Fractal] Registering Engine Global (P5)...');
  const { registerEngineGlobalRoutes } = await import('./modules/engine-global/engine_global.routes.js');
  await registerEngineGlobalRoutes(app);
  console.log('[Fractal] ✅ Engine Global P5 registered at /api/engine/*');
  
  // BLOCK P1.3: Register Guard Hysteresis Module
  console.log('[Fractal] Registering Guard Hysteresis Module (P1.3)...');
  const { registerGuardHysteresisRoutes } = await import('./modules/dxy-macro-guard/guard_hysteresis.routes.js');
  await registerGuardHysteresisRoutes(app);
  console.log('[Fractal] ✅ Guard Hysteresis P1.3 registered at /api/dxy-macro-core/guard/*');
  
  // BLOCK P2: Register Liquidity Engine Module
  console.log('[Fractal] Registering Liquidity Engine Module (P2)...');
  const { registerLiquidityRoutes } = await import('./modules/liquidity-engine/liquidity.routes.js');
  await registerLiquidityRoutes(app);
  console.log('[Fractal] ✅ Liquidity Engine P2 registered at /api/liquidity/*');
  
  // NOTE: SPX Phase routes already registered via spx-core module
  
  // BLOCK C: Register Combined Terminal (Building)
  console.log('[Fractal] Registering Combined Terminal (Building)...');
  await registerCombinedRoutes(app);
  console.log('[Fractal] ✅ Combined Terminal registered at /api/combined/v2.1/*');
  
  // Register Admin Auth routes
  console.log('[Fractal] Registering Admin Auth...');
  await app.register(adminAuthRoutes, { prefix: '/api/admin' });
  console.log('[Fractal] ✅ Admin Auth registered');
  
  // ═══════════════════════════════════════════════════════════════
  // P0: MODEL CONFIG ROUTES — Runtime config management
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Model Config routes (P0)...');
  await app.register(modelConfigRoutes);
  console.log('[Fractal] ✅ Model Config routes registered');

  // ═══════════════════════════════════════════════════════════════
  // P1-A + P2: LIFECYCLE ADMIN ROUTES — Version management & snapshots
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Lifecycle Admin routes (P1-A + P2)...');
  await app.register(lifecycleAdminRoutes);
  console.log('[Fractal] ✅ Lifecycle Admin routes registered');
  
  // ═══════════════════════════════════════════════════════════════
  // INDEX ENGINE V2 — Unified API for all indices
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Index Engine V2...');
  const { registerIndexEngineRoutes } = await import('./modules/index-engine/routes/index.routes.js');
  await registerIndexEngineRoutes(app);
  console.log('[Fractal] ✅ Index Engine V2 registered at /api/v2/index/*');
  
  // ═══════════════════════════════════════════════════════════════
  // MACRO ENGINE (V1 + V2 with Router)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Macro Engine (V1/V2)...');
  const { registerMacroEngineRoutes } = await import('./modules/macro-engine/routes/macro_engine.routes.js');
  await registerMacroEngineRoutes(app);
  console.log('[Fractal] ✅ Macro Engine registered at /api/macro-engine/*');
  
  // ═══════════════════════════════════════════════════════════════
  // V2 CALIBRATION OBJECTIVE — P5.6 + P5.9 (HIT_RATE + Per-Horizon)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering V2 Calibration Objective...');
  const { registerV2CalibrationObjectiveRoutes } = await import('./modules/macro-engine/v2/v2_calibration_objective.routes.js');
  await registerV2CalibrationObjectiveRoutes(app);
  console.log('[Fractal] ✅ V2 Calibration Objective at /api/macro-engine/v2/calibration/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P5.8 — REGIME-CONDITIONED CALIBRATION
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering RC Calibration...');
  const { registerRCCalibrationRoutes } = await import('./modules/macro-engine/v2/rc_calibration.routes.js');
  await registerRCCalibrationRoutes(app);
  console.log('[Fractal] ✅ RC Calibration at /api/macro-engine/v2/calibration/*-rc');
  
  // ═══════════════════════════════════════════════════════════════
  // COMPARE + VALIDATION LAYER (Institutional V1 vs V2)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Compare + Validation Layer...');
  const { registerCompareRoutes } = await import('./modules/macro-engine/compare/compare.routes.js');
  await registerCompareRoutes(app);
  console.log('[Fractal] ✅ Compare Layer registered at /api/macro-engine/*/compare, /backtest, /promotion');
  
  // ═══════════════════════════════════════════════════════════════
  // P6.1-P6.5 — SHADOW AUDIT + DIVERGENCE ALERTS
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Shadow Audit & Health Monitoring...');
  const { shadowAuditRoutes } = await import('./modules/macro-engine/shadow/shadow_audit.routes.js');
  await shadowAuditRoutes(app);
  console.log('[Fractal] ✅ Shadow Audit registered at /api/macro-engine/health, /shadow/*');
  
  // ═══════════════════════════════════════════════════════════════
  // AE/S-BRAIN V2 — Intelligence Layer
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering AE/S-Brain v2...');
  const { brainRoutes } = await import('./modules/brain/routes/brain.routes.js');
  await brainRoutes(app);
  console.log('[Fractal] ✅ Brain v2 registered at /api/brain/v2/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P8.0 — ML QUANTILE FORECAST LAYER
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Brain ML (Quantile Forecasts)...');
  const { brainMlRoutes } = await import('./modules/brain/ml/routes/brain_ml.routes.js');
  await brainMlRoutes(app);
  const { brainForecastRoutes } = await import('./modules/brain/ml/routes/brain_forecast.routes.js');
  await brainForecastRoutes(app);
  console.log('[Fractal] ✅ Brain ML registered at /api/brain/v2/features, /forecast');
  
  // ═══════════════════════════════════════════════════════════════
  // P9.0 — CROSS-ASSET CORRELATION REGIME CLASSIFIER
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Cross-Asset Regime Classifier...');
  const { crossAssetRoutes } = await import('./modules/brain/routes/cross_asset.routes.js');
  await crossAssetRoutes(app);
  console.log('[Fractal] ✅ Cross-Asset registered at /api/brain/v2/cross-asset');
  
  // ═══════════════════════════════════════════════════════════════
  // P9.1 + P9.2 — BRAIN COMPARE & SIMULATION
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Brain Compare + Simulation...');
  const { brainCompareSimRoutes } = await import('./modules/brain/routes/brain_compare_sim.routes.js');
  await brainCompareSimRoutes(app);
  console.log('[Fractal] ✅ Brain Compare+Sim registered at /api/brain/v2/compare, /sim');
  
  // ═══════════════════════════════════════════════════════════════
  // STRESS SIMULATION + PLATFORM CRASH-TEST
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Stress + Crash-Test...');
  const { stressCrashTestRoutes } = await import('./modules/brain/routes/stress_crash_test.routes.js');
  await stressCrashTestRoutes(app);
  console.log('[Fractal] ✅ Stress+CrashTest registered at /api/brain/v2/stress, /api/platform/crash-test');
  
  // ═══════════════════════════════════════════════════════════════
  // P10.1 — REGIME MEMORY STATE (Duration + Stability)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Regime Memory State (P10.1)...');
  const { regimeMemoryRoutes } = await import('./modules/brain/routes/regime_memory.routes.js');
  await regimeMemoryRoutes(app);
  console.log('[Fractal] ✅ Regime Memory P10.1 registered at /api/brain/v2/regime-memory/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P10.2 — META RISK SCALE (Posture + Caps)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering MetaRisk Scale (P10.2)...');
  const { metaRiskRoutes } = await import('./modules/brain/routes/meta_risk.routes.js');
  await metaRiskRoutes(app);
  console.log('[Fractal] ✅ MetaRisk P10.2 registered at /api/brain/v2/meta-risk/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P11 — CAPITAL ALLOCATION OPTIMIZER
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Optimizer (P11)...');
  const { optimizerRoutes } = await import('./modules/brain/optimizer/optimizer.routes.js');
  await optimizerRoutes(app);
  console.log('[Fractal] ✅ Optimizer P11 registered at /api/brain/v2/optimizer/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P12 — ADAPTIVE COEFFICIENT LEARNING
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Adaptive Learning (P12)...');
  const { adaptiveRoutes } = await import('./modules/brain/adaptive/adaptive.routes.js');
  await adaptiveRoutes(app);
  console.log('[Fractal] ✅ Adaptive P12 registered at /api/brain/v2/adaptive/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P13 — PORTFOLIO RETURN BACKTEST
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Portfolio Backtest (P13)...');
  const { p13BacktestRoutes } = await import('./modules/backtest/p13.routes.js');
  await p13BacktestRoutes(app);
  console.log('[Fractal] ✅ P13 Backtest registered at /api/backtest/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P14 — REGIME & VOLATILITY ANALYSIS
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Performance Analysis (P14)...');
  const { analysisRoutes } = await import('./modules/analysis/routes/analysis.routes.js');
  await analysisRoutes(app);
  console.log('[Fractal] ✅ P14 Analysis registered at /api/analysis/*');
  
  // ═══════════════════════════════════════════════════════════════
  // v2.3 — CAPITAL SCALING (Risk Budget Targeting)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Capital Scaling v2.3...');
  const { capitalScalingRoutes } = await import('./modules/capital-scaling/index.js');
  await capitalScalingRoutes(app);
  console.log('[Fractal] ✅ Capital Scaling v2.3 registered at /api/capital-scaling/*');
  
  // ═══════════════════════════════════════════════════════════════
  // UI BRAIN — User Brain Page v3
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering UI Brain (User Page v3)...');
  const { brainOverviewRoutes } = await import('./modules/ui-brain/index.js');
  await brainOverviewRoutes(app);
  console.log('[Fractal] ✅ UI Brain registered at /api/ui/brain/*');
  
  // ═══════════════════════════════════════════════════════════════
  // UI DXY — DXY Fractal Overview Page
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering UI DXY...');
  const { dxyOverviewRoutes } = await import('./modules/ui-dxy/index.js');
  await dxyOverviewRoutes(app);
  console.log('[Fractal] ✅ UI DXY registered at /api/ui/fractal/dxy/*');
  
  // ═══════════════════════════════════════════════════════════════
  // SPX MACRO OVERLAY — Macro-Adjusted SPX Projections
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering SPX Macro Overlay...');
  const { spxMacroOverlayRoutes } = await import('./modules/spx-macro-overlay/index.js');
  await spxMacroOverlayRoutes(app);
  
  // ═══════════════════════════════════════════════════════════════
  // HORIZON META — Adaptive Similarity + Hierarchy (BLOCK 77)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Horizon Meta (Adaptive Similarity + Hierarchy)...');
  const { horizonMetaRoutes, ensureProjectionTrackingIndexes } = await import('./modules/fractal/horizon-meta/index.js');
  await horizonMetaRoutes(app);
  await ensureProjectionTrackingIndexes();
  console.log('[Fractal] ✅ Horizon Meta registered at /api/fractal/horizon-meta/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P4: CROSS-ASSET COMPOSITE LIFECYCLE
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Cross-Asset Composite Lifecycle (P4)...');
  const { compositeLifecycleRoutes } = await import('./modules/cross-asset/index.js');
  await compositeLifecycleRoutes(app);
  console.log('[Fractal] ✅ Cross-Asset registered at /api/cross-asset/*');
  
  // ═══════════════════════════════════════════════════════════════
  // BTC OVERLAY — SPX → BTC Influence Engine (BLOCK 78)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering BTC Overlay (SPX → BTC Influence)...');
  const { btcOverlayRoutes } = await import('./modules/btc-overlay/index.js');
  await btcOverlayRoutes(app);
  console.log('[Fractal] ✅ BTC Overlay registered at /api/overlay/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P5-FINAL: ADMIN JOBS & HEALTH ROUTES
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Admin Jobs & Health routes...');
  const { default: adminJobsRoutes } = await import('./modules/jobs/admin_jobs.routes.js');
  await adminJobsRoutes(app);
  console.log('[Fractal] ✅ Admin Jobs & Health registered at /api/admin/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P5.2: TIMELINE ROUTES (Version History)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Timeline routes...');
  const { default: registerTimelineRoutes } = await import('./modules/admin/timeline/timeline.routes.js');
  await registerTimelineRoutes(app);
  console.log('[Fractal] ✅ Timeline registered at /api/admin/timeline/*');
  
  // ═══════════════════════════════════════════════════════════════
  // P5.3: HEALTH SCHEDULER (Cron every 6 hours)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Starting Health Scheduler (P5.3)...');
  const { startHealthScheduler } = await import('./modules/jobs/health_scheduler.job.js');
  startHealthScheduler();
  console.log('[Fractal] ✅ Health Scheduler started (every 6 hours)');
  
  // ═══════════════════════════════════════════════════════════════
  // FINALIZATION: UNIFIED ADMIN DASHBOARD AGGREGATOR
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering Unified Admin Dashboard routes...');
  const { default: registerDashboardRoutes } = await import('./modules/admin/dashboard/dashboard.routes.js');
  await registerDashboardRoutes(app);
  console.log('[Fractal] ✅ Unified Admin Dashboard registered');
  
  // ═══════════════════════════════════════════════════════════════
  // P6: DRIFT ANALYTICS (by-horizon, rolling, by-regime, composite)
  // ═══════════════════════════════════════════════════════════════
  console.log('[Fractal] Registering P6 Drift Analytics routes...');
  const { registerDriftAnalyticsRoutes } = await import('./modules/admin/drift-analytics/index.js');
  await registerDriftAnalyticsRoutes(app);
  console.log('[Fractal] ✅ P6 Drift Analytics registered at /api/admin/:scope/drift/*');
  
  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Fractal] Received ${signal}, shutting down...`);
    await app.close();
    await disconnectMongo();
    console.log('[Fractal] Shutdown complete');
    process.exit(0);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // COLD START: Auto-load data if missing
  console.log('[Fractal] Checking data availability (Cold Start)...');
  await coldStartDataCheck();
  
  // Start server
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  ✅ Fractal Backend started on port ${PORT}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('📦 Available Endpoints:');
    console.log('  GET  /api/health');
    console.log('  GET  /api/fractal/health');
    console.log('  GET  /api/fractal/signal');
    console.log('  GET  /api/fractal/match');
    console.log('  POST /api/fractal/match');
    console.log('  GET  /api/fractal/explain');
    console.log('  GET  /api/fractal/explain/detailed');
    console.log('  GET  /api/fractal/overlay');
    console.log('  POST /api/fractal/admin/backtest');
    console.log('  POST /api/fractal/admin/autolearn/run');
    console.log('  POST /api/fractal/admin/autolearn/monitor');
    console.log('  GET  /api/fractal/admin/dataset');
    console.log('');
    console.log('📦 Index Engine V2:');
    console.log('  GET  /api/v2/index/:symbol/pack');
    console.log('  GET  /api/v2/index/:symbol/macro');
    console.log('  GET  /api/v2/regime/current');
    console.log('  GET  /api/v2/regime/transition-matrix');
    console.log('');
  } catch (err) {
    console.error('[Fractal] Fatal error:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Fractal] Fatal error:', err);
  process.exit(1);
});
