/**
 * TA Isolated Server — Minimal boot for TA module development
 * 
 * Starts only:
 * - MongoDB connection
 * - TA Module (Phase 4-6: Audit, Outcomes, Calibration)
 * 
 * Usage: TA_ONLY=1 yarn dev
 */

import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { connectMongo, disconnectMongo, getMongoDb } from './db/mongoose.js';
import { taRoutes } from './modules/ta/runtime/ta.controller.js';
import { initializeDetectors } from './modules/ta/detectors/index.js';

const PORT = parseInt(process.env.PORT || '8001', 10);

async function main(): Promise<void> {
  console.log('[TA Server] Starting isolated TA module...');

  // Connect to MongoDB
  console.log('[TA Server] Connecting to MongoDB...');
  await connectMongo();
  console.log('[TA Server] ✅ MongoDB connected');

  // Build minimal Fastify app
  const app: FastifyInstance = Fastify({
    logger: {
      level: 'info',
    },
    trustProxy: true,
  });

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Health endpoint
  app.get('/api/health', async () => ({
    ok: true,
    mode: 'TA_ONLY',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  }));

  // System health endpoint (for frontend compatibility)
  app.get('/api/system/health', async () => ({
    status: 'healthy',
    ts: new Date().toISOString(),
    services: {},
    metrics: { bootstrap: {} },
    notes: ['TA_ONLY mode - isolated TA module'],
  }));

  // Initialize TA detectors
  console.log('[TA Server] Initializing TA detectors...');
  initializeDetectors();

  // Register TA routes
  console.log('[TA Server] Registering TA module at /api/ta/*...');
  await app.register(taRoutes, { prefix: '/api/ta' });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[TA Server] Received ${signal}, shutting down...`);
    await app.close();
    await disconnectMongo();
    console.log('[TA Server] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[TA Server] ✅ TA module started on port ${PORT}`);
    console.log('[TA Server] Endpoints:');
    console.log('  - GET  /api/ta/health');
    console.log('  - GET  /api/ta/analyze?asset=SPX');
    console.log('  - GET  /api/ta/structure?asset=SPX');
    console.log('  - GET  /api/ta/levels?asset=SPX');
    console.log('  - GET  /api/ta/patterns?asset=SPX');
    console.log('  - GET  /api/ta/pivots?asset=SPX');
    console.log('  - GET  /api/ta/features?asset=SPX');
    console.log('  - GET  /api/ta/audit/latest?asset=SPX');
    console.log('  - GET  /api/ta/audit/runs?asset=SPX');
    console.log('  - GET  /api/ta/outcomes/latest?asset=SPX');
    console.log('  - POST /api/ta/outcomes/recompute');
    console.log('  - GET  /api/ta/performance?asset=SPX');
    console.log('  - GET  /api/ta/calibration');
    console.log('  - GET  /api/ta/calibration/pattern/:type');
    console.log('  - GET  /api/ta/calibration/all');
    console.log('  - GET  /api/ta/calibration/health');
    console.log('  - POST /api/ta/calibration/calibrate');
    console.log('  [Phase A: Hypothesis Engine Registry]');
    console.log('  - GET  /api/ta/registry/stats');
    console.log('  - GET  /api/ta/registry/patterns');
    console.log('  - GET  /api/ta/registry/pattern/:type');
    console.log('  - GET  /api/ta/registry/groups');
    console.log('  - GET  /api/ta/registry/implemented');
    console.log('  - GET  /api/ta/registry/check/:type');
    console.log('  [Phase K: ML Dataset Builder]');
    console.log('  - GET  /api/ta/ml_dataset/status');
    console.log('  - POST /api/ta/ml_dataset/build');
    console.log('  - GET  /api/ta/ml_dataset/preview');
    console.log('  - GET  /api/ta/ml_dataset/rows');
    console.log('  [Phase L: ML Overlay]');
    console.log('  - GET  /api/ta/ml_overlay/status');
    console.log('  - PATCH /api/ta/ml_overlay/config');
    console.log('  - POST /api/ta/ml_overlay/predict');
    console.log('  - GET  /api/ta/ml_overlay/predictions/latest');
    console.log('  [Phase M: Multi-Timeframe]');
    console.log('  - GET  /api/ta/mtf/status');
    console.log('  - GET  /api/ta/mtf/decision?asset=BTCUSDT');
    console.log('  - GET  /api/ta/mtf/audit/latest');
    console.log('  - GET  /api/ta/mtf/summary');
    console.log('  [Phase N: Production Hardening]');
    console.log('  - GET  /api/ta/health/extended');
    console.log('  - GET  /api/ta/engine/summary');
    console.log('  - GET  /api/ta/cache/stats');
    console.log('  - POST /api/ta/cache/config');
    console.log('  - POST /api/ta/cache/clear');
    console.log('  - GET  /api/ta/metrics');
    console.log('  - GET  /api/ta/scheduler/stats');
    console.log('  [Phase O: Real-Time Streaming]');
    console.log('  - GET  /api/ta/stream/health');
    console.log('  - GET  /api/ta/stream/stats');
    console.log('  - POST /api/ta/stream/pump');
    console.log('  - GET  /api/ta/stream/replay');
    console.log('  - POST /api/ta/stream/test');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[TA Server] Fatal error:', err);
  process.exit(1);
});
