// Twitter Module - Registration (MULTI Architecture + P1 Production + P2 Queue)

import { FastifyInstance } from 'fastify';
import { registerTwitterRoutes } from './twitter.controller.js';
import { registerFreezeRoutes } from './freeze/index.js';
import { registerAccountRoutes } from './accounts/index.js';
import { registerSessionRoutes } from './sessions/index.js';
import { registerProxySlotRoutes } from './slots/index.js';
import { registerWarmthRoutes } from './warmth/warmth.routes.js';
import { registerRiskRoutes } from './risk/risk.routes.js';
import { registerProxyQualityRoutes } from './proxy-quality/proxy-quality.routes.js';
import { registerWorkerRoutes } from './worker/worker.routes.js';
import { preflightRoutes } from './preflight/preflight.routes.js';
import { registerAdminSystemRoutes } from './admin-system/admin-system.routes.js';
import { systemScheduler } from './admin-system/system-scheduler.service.js';
import { sessionHealthWorker } from '../../workers/session-health.worker.js';
import { twitterParserExecutor } from './execution/executor.service.js';

export async function registerTwitterModule(app: FastifyInstance): Promise<void> {
  // Main Twitter API routes (proxy to parser service)
  await app.register(async (instance) => {
    await registerTwitterRoutes(instance);
  }, { prefix: '/api/v4/twitter' });
  
  // Preflight check routes (at root level, already has /api/v4/twitter prefix in route)
  await app.register(preflightRoutes);
  
  // Admin System Parsing routes (SYSTEM scope only)
  await app.register(registerAdminSystemRoutes, { prefix: '/api/v4/admin/system' });
  
  // Admin routes for MULTI architecture
  await app.register(async (instance) => {
    // Accounts management
    await registerAccountRoutes(instance);
    // Sessions management (cookies)
    await registerSessionRoutes(instance);
    // Proxy slots management
    await registerProxySlotRoutes(instance);
    // P3 FREEZE Validation
    await registerFreezeRoutes(instance);
    // P1: Warmth routes
    await registerWarmthRoutes(instance);
    // P1: Risk routes
    await registerRiskRoutes(instance);
    // P1: Proxy Quality routes
    await registerProxyQualityRoutes(instance);
    // P1/P2: Worker routes
    await registerWorkerRoutes(instance);
  }, { prefix: '/api/admin/twitter-parser' });
  
  // Workers startup
  app.addHook('onReady', async () => {
    // P1: Start session health worker
    console.log('[Twitter Module] Starting Session Health Worker...');
    sessionHealthWorker.start();
    
    // P2: Start task queue worker
    console.log('[Twitter Module] Starting Task Queue Worker...');
    twitterParserExecutor.startWorker();
    
    // Phase 1.6: Start SYSTEM Scheduler (respects SYSTEM_SCHEDULER_ENABLED env)
    console.log('[Twitter Module] Starting System Scheduler...');
    systemScheduler.start();
  });
  
  // Workers shutdown
  app.addHook('onClose', async () => {
    console.log('[Twitter Module] Stopping workers...');
    sessionHealthWorker.stop();
    await twitterParserExecutor.stopWorker();
    
    // Phase 1.6: Stop System Scheduler
    systemScheduler.stop();
  });
  
  app.log.info('[Twitter Module] Registered at /api/v4/twitter');
  app.log.info('[Twitter Module] Admin routes at /api/admin/twitter-parser');
  app.log.info('[Twitter Module] Preflight check at /api/v4/twitter/preflight-check');
  app.log.info('[Twitter Module] P1/P2 Production features enabled');
}

export * from './twitter.types.js';
export * from './twitter.dto.js';
export * from './twitter.client.js';
export * from './twitter.service.js';
