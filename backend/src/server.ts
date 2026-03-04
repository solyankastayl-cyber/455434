import 'dotenv/config';
import { buildApp } from './app.js';
import { connectMongo, disconnectMongo } from './db/mongoose.js';
import { env } from './config/env.js';
import { scheduler, registerDefaultJobs } from './jobs/scheduler.js';
import { runStartupChecks } from './core/system/startup.checks.js';
import { startHealthMonitor, stopHealthMonitor } from './core/system/health.monitor.js';
import * as bootstrapWorker from './core/bootstrap/bootstrap.worker.js';
import { startTelegramPolling, stopTelegramPolling } from './telegram-polling.worker.js';
import { seedTokenRegistry } from './core/resolver/token.resolver.js';
import { ensureDefaultConfig } from './core/engine/engine_runtime_config.model.js';
import { TokenUniverseModel } from './core/token_universe/token_universe.model.js';
import { seedTokenUniverse } from './core/token_universe/token_universe.seed.js';
import { startMLDataJobs, stopMLDataJobs } from './jobs/ml_data.jobs.js';

// BATCH 1 - ML Retrain Scheduler
import { startRetrainScheduler, stopRetrainScheduler } from './core/ml_retrain/index.js';

// BATCH 2 - Dataset Export Job
import { startDatasetExportJob, stopDatasetExportJob } from './core/ml_retrain/index.js';

// ML v2.2 - Auto-Retrain Policy
import { seedDefaultPolicies } from './core/ml_retrain/auto_retrain/index.js';

// Note: Weekly Cron is started in fractal.module.ts

async function main(): Promise<void> {
  console.log('[Server] Starting BlockView Backend...');
  
  // Connect to MongoDB
  console.log('[Server] Connecting to MongoDB...');
  await connectMongo();

  // Build Fastify app
  const app = buildApp();

  // B6: Run startup checks (fail-fast)
  await runStartupChecks(app);

  // P2.5: Seed token registry with known tokens
  console.log('[Server] Seeding token registry...');
  await seedTokenRegistry();
  
  // P4.1: Run Twitter User Module migration (commented for testing)
  // console.log('[Server] Running Twitter User Module migration...');
  // const { migrateAddOwnerFields } = await import('./modules/twitter-user/index.js');
  // await migrateAddOwnerFields();
  
  // БЛОК 1: Ensure ML Runtime Config exists (default: OFF)
  console.log('[Server] Initializing ML Runtime Config...');
  await ensureDefaultConfig();
  
  // БЛОК 1.5: Ensure Phase 5 Calibration Active defaults
  console.log('[Server] Initializing Phase 5 Calibration defaults...');
  const { ensureCalibrationActiveDefaults } = await import('./core/ml_calibration_phase5/calibration_active.model.js');
  await ensureCalibrationActiveDefaults();
  
  // БЛОК 2: Seed Token Universe if empty
  const tokenCount = await TokenUniverseModel.countDocuments();
  if (tokenCount === 0) {
    console.log('[Server] Seeding Token Universe...');
    await seedTokenUniverse();
  } else {
    console.log(`[Server] Token Universe already has ${tokenCount} tokens`);
  }

  // БЛОК 3: Initialize Signal Reweighting v1.1
  console.log('[Server] Initializing Signal Reweighting...');
  const { initializeSignalReweighting } = await import('./core/signal_reweighting/signal_reweighting.service.js');
  await initializeSignalReweighting();

  // БЛОК 4: Initialize Self-Learning Config (ETAP 5.1)
  console.log('[Server] Initializing Self-Learning Config...');
  const { ensureDefaultSelfLearningConfig } = await import('./core/self_learning/self_learning_config.model.js');
  await ensureDefaultSelfLearningConfig();

  // P1.5.B: Seed Market API Sources if empty
  console.log('[Server] Checking Market API Sources...');
  const { seedMarketSources } = await import('./core/market_data/sources/seed_market_sources.js');
  const seedResult = await seedMarketSources();
  if (seedResult.seeded) {
    console.log(`[Server] Seeded ${seedResult.count} default market sources`);
  } else {
    console.log(`[Server] Market sources already configured (${seedResult.count} sources)`);
  }

  // 🔴 MINIMAL_BOOT MODE - Skip heavy workers for testing
  const minimalBoot = process.env.MINIMAL_BOOT === '1';
  
  if (minimalBoot) {
    console.log('[Server] ⚠️  MINIMAL_BOOT mode enabled - skipping background workers');
  } else {
    // Register scheduled jobs (including ERC-20 indexer)
    registerDefaultJobs();

    // Start scheduler jobs
    scheduler.startAll();

    // Start bootstrap worker
    const workerStarted = await bootstrapWorker.start();
    console.log(`[Server] Bootstrap worker: ${workerStarted ? 'started' : 'skipped (lock held)'}`);

    // B5: Start health monitor
    startHealthMonitor();

    // TEMPORARY FIX: Start Telegram polling (until ingress routing is fixed)
    console.log('[Server] Starting Telegram polling worker (TEMPORARY FIX)...');
    startTelegramPolling().catch(err => {
      console.error('[Server] Telegram polling error:', err);
    });

    // PHASE 4.3: Start ML Data Accumulation Jobs
    console.log('[Server] Starting ML Data Accumulation Jobs...');
    startMLDataJobs();

    // BATCH 1: Start ML Retrain Scheduler
    console.log('[Server] Starting ML Retrain Scheduler...');
    startRetrainScheduler();

    // BATCH 2: Start Dataset Export Job
    console.log('[Server] Starting Dataset Export Job...');
    startDatasetExportJob();

    // ML v2.2: Seed default policies (all disabled)
    console.log('[Server] Seeding default auto-retrain policies...');
    await seedDefaultPolicies();
    
    // Note: Weekly Cron is started in fractal.module.ts when Fractal module loads
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Server] Received ${signal}, shutting down...`);

    // Stop Telegram polling
    stopTelegramPolling();
    
    // Stop ML Data Jobs
    stopMLDataJobs();
    
    // BATCH 1: Stop Retrain Scheduler
    stopRetrainScheduler();
    
    // BATCH 2: Stop Dataset Export Job
    stopDatasetExportJob();
    
    // Note: Weekly Cron cleanup handled by process exit
    
    // Stop monitoring first
    stopHealthMonitor();
    
    // Stop worker
    await bootstrapWorker.stop();
    
    // Stop scheduler
    scheduler.stopAll();
    
    // Close app and DB
    await app.close();
    await disconnectMongo();

    console.log('[Server] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`[Server] ✓ Backend started on port ${env.PORT}`);
    console.log(`[Server] Environment: ${env.NODE_ENV}`);
    console.log(`[Server] WebSocket: ${env.WS_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`[Server] Indexer: ${env.INDEXER_ENABLED && env.INFURA_RPC_URL ? 'enabled' : 'disabled'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
