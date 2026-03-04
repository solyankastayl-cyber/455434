import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { env } from './config/env.js';
import { registerRoutes } from './api/routes.js';
import { zodPlugin } from './plugins/zod.js';
import { setupWebSocketGateway } from './core/websocket/index.js';
import { AppError } from './common/errors.js';

// ═══════════════════════════════════════════════════════════════
// MINIMAL_BOOT: Fractal-only mode for isolated development
// ═══════════════════════════════════════════════════════════════
const MINIMAL_BOOT = process.env.MINIMAL_BOOT === '1';
const FRACTAL_ONLY = process.env.FRACTAL_ONLY === '1';

/**
 * Build Fastify Application
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    trustProxy: true,
  });

  // CORS
  app.register(cors, {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(','),
    credentials: true,
  });

  // Plugins
  app.register(zodPlugin);
  
  // WebSocket plugin - register at root level (skip in FRACTAL_ONLY mode)
  if (env.WS_ENABLED && !FRACTAL_ONLY) {
    app.register(fastifyWebsocket, {
      options: { maxPayload: 1048576 }
    });
    app.log.info('WebSocket plugin registered');
  }

  // Global error handler
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);

    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        ok: false,
        error: err.code,
        message: err.message,
      });
    }

    // Fastify validation errors
    if (err.validation) {
      return reply.status(400).send({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: err.message,
      });
    }

    // Unknown errors
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(statusCode).send({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  });

  // Not found handler
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({
      ok: false,
      error: 'NOT_FOUND',
      message: 'Route not found',
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FRACTAL_ONLY MODE: Skip all other modules
  // ═══════════════════════════════════════════════════════════════
  if (FRACTAL_ONLY) {
    console.log('[BOOT] 🎯 FRACTAL_ONLY mode - registering only Fractal module');
    
    // Minimal health endpoint
    app.get('/api/health', async () => ({
      ok: true,
      mode: 'FRACTAL_ONLY',
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
    app.register(async (fastify) => {
      console.log('[BOOT] Registering Fractal Module (isolated)...');
      try {
        const { registerFractalModule } = await import('./modules/fractal/index.js');
        await registerFractalModule(fastify);
        console.log('[BOOT] ✅ Fractal Module registered at /api/fractal/*');
        
        // Register BTC Terminal (BLOCK A - Final Product) in same context
        console.log('[BOOT] Registering BTC Terminal (Final)...');
        const { registerBtcRoutes } = await import('./modules/btc/index.js');
        await registerBtcRoutes(fastify);
        console.log('[BOOT] ✅ BTC Terminal registered at /api/btc/v2.1/*');
        
        // Register SPX Terminal (BLOCK B - Building)
        console.log('[BOOT] Registering SPX Terminal (Building)...');
        const { registerSpxRoutes } = await import('./modules/spx/index.js');
        await registerSpxRoutes(fastify);
        console.log('[BOOT] ✅ SPX Terminal registered at /api/spx/v2.1/*');
        
        // Register SPX Core (BLOCK B5 - Fractal Core)
        console.log('[BOOT] Registering SPX Core (Fractal Engine)...');
        const { registerSpxCoreRoutes } = await import('./modules/spx-core/index.js');
        await registerSpxCoreRoutes(fastify);
        console.log('[BOOT] ✅ SPX Core registered at /api/spx/v2.1/focus-pack');
        
        // Register Combined Terminal (BLOCK C - Building)
        console.log('[BOOT] Registering Combined Terminal (Building)...');
        const { registerCombinedRoutes } = await import('./modules/combined/index.js');
        await registerCombinedRoutes(fastify);
        console.log('[BOOT] ✅ Combined Terminal registered at /api/combined/v2.1/*');
        
        // Register Audit Routes (L2/L3 Audit)
        console.log('[BOOT] Registering Audit Module (L2/L3)...');
        const { default: registerAuditRoutes } = await import('./modules/fractal/audit/audit.routes.js');
        await registerAuditRoutes(fastify);
        console.log('[BOOT] ✅ Audit Module registered at /api/audit/*');
        
      } catch (err) {
        console.error('[BOOT] Failed to register modules:', err);
      }
    });
    
    return app;
  }

  // Register routes (full mode)
  app.register(registerRoutes);
  
  // Register Twitter User Module (P4.1 + Block 4 Control Plane + Phase 1.1 API Keys)
  console.log('[BOOT] before twitter-user module');
  app.register(async (fastify) => {
    console.log('[BOOT] inside twitter-user module registration');
    
    const {
      createTwitterUserModule,
      registerTwitterUserRoutes,
      registerTwitterWebhookRoutes,
      registerApiKeyRoutes,
      registerParseTargetRoutes,
      registerQuotaRoutes,
      registerSchedulerRoutes,
      registerScrollRuntimeRoutes,
      registerRuntimeSelectionRoutes,
      registerParseRoutes,
      registerDebugRoutes,
      registerAccountRoutes,
    } = await import('./modules/twitter-user/index.js');
    
    // Phase 5.2.1: Telegram Binding routes
    const { telegramBindingRoutes } = await import('./modules/twitter-user/routes/telegram-binding.routes.js');

    console.log('[BOOT] twitter-user module imported');

    const cookieEncKey = process.env.COOKIE_ENC_KEY || '';
    const twitterModule = createTwitterUserModule({ cookieEncKey });

    console.log('[BOOT] twitter-user module created');

    // Register all routes
    await registerTwitterUserRoutes(fastify, {
      integration: twitterModule.integration,
      sessions: twitterModule.sessions,
    });
    
    // Phase 1.1: API Key management routes
    await registerApiKeyRoutes(fastify);
    
    // Webhook routes (now uses API Key auth)
    await registerTwitterWebhookRoutes(fastify, {
      sessions: twitterModule.sessions,
    });
    
    // Block 4 routes
    await registerParseTargetRoutes(fastify);
    await registerQuotaRoutes(fastify);
    await registerSchedulerRoutes(fastify);
    await registerScrollRuntimeRoutes(fastify);
    
    // Phase 1.3: Runtime Selection routes
    await registerRuntimeSelectionRoutes(fastify);
    
    // Phase 1.4: Parse routes
    await registerParseRoutes(fastify);
    
    // Debug routes
    await registerDebugRoutes(fastify);
    
    // A.2.1: Account Management routes
    await registerAccountRoutes(fastify);
    
    // Phase 5.2.1: Telegram Binding routes
    await telegramBindingRoutes(fastify);

    console.log('[BOOT] all routes registered (Block 4 + Phase 1.1-1.4 + Debug + A.2.1 Accounts + Phase 5.2.1 Telegram)');

    fastify.log.info('Twitter User Module (P4.1 + Block 4 + Phase 1.1-1.4) registered');
  });
  console.log('[BOOT] after twitter-user module');
  
  // A.3 - Admin Control Plane
  app.register(async (fastify) => {
    console.log('[BOOT] registering twitter-admin module');
    try {
      const adminModule = await import('./modules/twitter-admin/routes/admin.routes.js');
      await adminModule.registerAdminTwitterRoutes(fastify);
      console.log('[BOOT] twitter-admin module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register twitter-admin module:', err);
    }
  });
  
  // Register Twitter module (v4.0)
  app.register(async (instance) => {
    const { registerTwitterModule } = await import('./modules/twitter/twitter.module.js');
    await registerTwitterModule(instance);
  });

  // NOTE: Twitter Parser Admin module DISABLED - replaced by MULTI architecture
  // New routes registered via twitter/accounts, twitter/sessions, twitter/slots
  // app.register(async (instance) => {
  //   const { registerTwitterParserAdminModule } = await import('./modules/twitter_parser_admin/index.js');
  //   await registerTwitterParserAdminModule(instance);
  // });

  // WebSocket endpoint - register after websocket plugin
  if (env.WS_ENABLED) {
    app.after(() => {
      setupWebSocketGateway(app);
    });
  }

  // Register Sentiment Module (S2.1)
  app.register(async (fastify) => {
    const sentimentEnabled = process.env.SENTIMENT_ENABLED === 'true';
    if (sentimentEnabled) {
      console.log('[BOOT] Registering sentiment module...');
      try {
        const { initSentimentModule } = await import('./modules/sentiment/index.js');
        await initSentimentModule(fastify);
        console.log('[BOOT] Sentiment module registered successfully');
      } catch (err) {
        console.error('[BOOT] Failed to register sentiment module:', err);
      }
    } else {
      console.log('[BOOT] Sentiment module disabled (SENTIMENT_ENABLED != true)');
    }
  });

  // Register Runtime Control Admin (S4.ADM)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering runtime control admin module...');
    try {
      const runtimeControlRoutes = await import('./modules/admin/runtime-control.routes.js');
      await runtimeControlRoutes.default(fastify);
      console.log('[BOOT] Runtime control admin module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register runtime control admin module:', err);
    }
  });

  // Register Price Layer (S5.2)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering price layer module (S5.2)...');
    try {
      const { priceLayerRoutes } = await import('./modules/price-layer/index.js');
      await priceLayerRoutes(fastify);
      console.log('[BOOT] Price layer module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register price layer module:', err);
    }
    
    // S5.6.H — Historical Replay Module
    try {
      const { registerReplayRoutes } = await import('./modules/replay/index.js');
      await registerReplayRoutes(fastify);
      console.log('[BOOT] Replay module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register replay module:', err);
    }
  });

  // S10 — Exchange Intelligence Module
  app.register(async (fastify) => {
    console.log('[BOOT] Registering S10 Exchange module...');
    try {
      const { registerExchangeModule } = await import('./modules/exchange/index.js');
      await registerExchangeModule(fastify);
      console.log('[BOOT] S10 Exchange module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register S10 Exchange module:', err);
    }
  });

  // Phase 2 — Observability Module (Transparency & Diagnostics)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 2 Observability module...');
    try {
      const { registerObservabilityRoutes } = await import('./modules/observability/index.js');
      await registerObservabilityRoutes(fastify);
      console.log('[BOOT] Phase 2 Observability module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Observability module:', err);
    }
  });

  // Phase 3 — ML Confidence Calibration Module
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 3 ML module...');
    try {
      const { registerMlRoutes } = await import('./modules/ml/index.js');
      await registerMlRoutes(fastify);
      console.log('[BOOT] Phase 3 ML module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register ML module:', err);
    }
  });

  // Phase 4 — Final Decision Module (Buy/Sell/Avoid)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 4 Decision module...');
    try {
      const { registerDecisionRoutes } = await import('./modules/finalDecision/index.js');
      await registerDecisionRoutes(fastify);
      console.log('[BOOT] Phase 4 Decision module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Decision module:', err);
    }
  });

  // S10.7 — Exchange ML Module
  app.register(async (fastify) => {
    console.log('[BOOT] Registering S10.7 Exchange ML module...');
    try {
      const { mlRoutes, mlShadowRoutes, mlopsPromotionRoutes, step3PromotionRoutes } = await import('./modules/exchange-ml/index.js');
      await fastify.register(mlRoutes);
      await fastify.register(mlShadowRoutes);
      await fastify.register(mlopsPromotionRoutes);
      await fastify.register(step3PromotionRoutes);
      console.log('[BOOT] S10.7 Exchange ML module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register S10.7 Exchange ML module:', err);
    }
  });

  // S10.8 — Meta-Brain (Exchange → Meta-Brain Hook)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering S10.8 Meta-Brain module...');
    try {
      const { metaBrainRoutes } = await import('./modules/meta-brain/index.js');
      await fastify.register(metaBrainRoutes);
      console.log('[BOOT] S10.8 Meta-Brain module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register S10.8 Meta-Brain module:', err);
    }
  });

  // C1 — Fusion Layer (Exchange × Sentiment Alignment)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering C1 Fusion module...');
    try {
      const { alignmentRoutes } = await import('./modules/fusion/index.js');
      await fastify.register(alignmentRoutes, { prefix: '/api/v10/fusion' });
      console.log('[BOOT] C1 Fusion module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register C1 Fusion module:', err);
    }
  });

  // C2.1 — Onchain Data Foundation
  app.register(async (fastify) => {
    console.log('[BOOT] Registering C2.1 Onchain module...');
    try {
      const { onchainRoutes } = await import('./modules/onchain/index.js');
      await fastify.register(onchainRoutes, { prefix: '/api/v10/onchain' });
      console.log('[BOOT] C2.1 Onchain module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register C2.1 Onchain module:', err);
    }
  });

  // C2.2 — Exchange × On-chain Validation
  app.register(async (fastify) => {
    console.log('[BOOT] Registering C2.2 Validation module...');
    try {
      const { validationRoutes } = await import('./modules/validation/index.js');
      await fastify.register(validationRoutes, { prefix: '/api/v10/validation' });
      console.log('[BOOT] C2.2 Validation module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register C2.2 Validation module:', err);
    }
  });

  // C3 — Meta-Brain v2 (Final Decision Layer)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering C3 Meta-Brain v2 module...');
    try {
      const { metaBrainV2Routes } = await import('./modules/metaBrainV2/index.js');
      await fastify.register(metaBrainV2Routes, { prefix: '/api/v10/meta-brain-v2' });
      console.log('[BOOT] C3 Meta-Brain v2 module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register C3 Meta-Brain v2 module:', err);
    }
  });

  // Phase 1.2 — Market Module (Search + Asset Resolver)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 1.2 Market module...');
    try {
      const { marketRoutes } = await import('./modules/market/index.js');
      await fastify.register(marketRoutes, { prefix: '/api/v10/market' });
      console.log('[BOOT] Phase 1.2 Market module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Market module:', err);
    }
  });

  // Phase 2.1 — Features Module (Feature Snapshot Builder)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 2.1 Features module...');
    try {
      const { featureRoutes } = await import('./modules/features/index.js');
      await fastify.register(featureRoutes, { prefix: '/api/v10/features' });
      console.log('[BOOT] Phase 2.1 Features module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Features module:', err);
    }
  });

  // Phase 2.2 — Dataset Module (ML Dataset Builder)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 2.2 Dataset module...');
    try {
      const { datasetRoutes } = await import('./modules/dataset/index.js');
      await fastify.register(datasetRoutes, { prefix: '/api/v10/dataset' });
      console.log('[BOOT] Phase 2.2 Dataset module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Dataset module:', err);
    }
  });

  // Phase 2.3 — Confidence Module (Confidence Decay Engine)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 2.3 Confidence module...');
    try {
      const { confidenceRoutes } = await import('./modules/confidence/index.js');
      await fastify.register(confidenceRoutes, { prefix: '/api/v10/confidence' });
      console.log('[BOOT] Phase 2.3 Confidence module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Confidence module:', err);
    }
  });

  // Phase 1 (Prod) — Network Admin Module
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 1 Network module...');
    try {
      const { networkAdminRoutes } = await import('./modules/network/index.js');
      await fastify.register(networkAdminRoutes, { prefix: '/api/v10/admin/network' });
      console.log('[BOOT] Phase 1 Network module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Network module:', err);
    }
  });

  // Phase 5 — Learning Module (Auto-Learning Loop)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Phase 5 Learning module...');
    try {
      const { registerLearningModule } = await import('./modules/learning/index.js');
      await registerLearningModule(fastify);
      console.log('[BOOT] Phase 5 Learning module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Learning module:', err);
    }
  });

  // Product Signals — Alerts Module (Telegram/Discord notifications)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Alerts module...');
    try {
      const { registerAlertRoutes, alertDispatcher } = await import('./modules/alerts/index.js');
      await registerAlertRoutes(fastify);
      await alertDispatcher.init();
      console.log('[BOOT] Alerts module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Alerts module:', err);
    }
  });

  // Product Signals — Snapshot Module (Share Links)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Snapshot module...');
    try {
      const { registerSnapshotRoutes } = await import('./modules/snapshot/index.js');
      await registerSnapshotRoutes(fastify);
      console.log('[BOOT] Snapshot module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Snapshot module:', err);
    }
  });

  // FOMO Alerts Module (Telegram notifications)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering FOMO Alerts module...');
    try {
      const { registerFomoAlertRoutes, fomoAlertEngine } = await import('./modules/fomo-alerts/index.js');
      await registerFomoAlertRoutes(fastify);
      await fomoAlertEngine.init();
      console.log('[BOOT] FOMO Alerts module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register FOMO Alerts module:', err);
    }
  });

  // Macro Context Module (Market State Anchor)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Macro Context module...');
    try {
      const { macroRoutes, startMacroAlertMonitor } = await import('./modules/macro/index.js');
      await fastify.register(macroRoutes, { prefix: '/api/v10/macro' });
      
      // Start macro alert monitoring
      startMacroAlertMonitor();
      
      console.log('[BOOT] Macro Context module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Macro Context module:', err);
    }
  });

  // Macro Intelligence Module (Market Regime Engine)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Macro Intelligence module...');
    try {
      const { macroIntelRoutes } = await import('./modules/macro-intel/index.js');
      await fastify.register(macroIntelRoutes, { prefix: '/api/v10/macro-intel' });
      console.log('[BOOT] Macro Intelligence module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Macro Intelligence module:', err);
    }
  });

  // Market Expectation Module (P1 - Expectation → Outcome → Feedback Loop)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Market Expectation module...');
    try {
      const { registerMarketExpectationRoutes } = await import('./modules/market-expectation/index.js');
      await registerMarketExpectationRoutes(fastify);
      console.log('[BOOT] Market Expectation module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Market Expectation module:', err);
    }
  });

  // Assets Module (Canonical Asset + Multi-Venue Truth Layer)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Assets module...');
    try {
      const { registerAssetsRoutes } = await import('./modules/assets/index.js');
      await registerAssetsRoutes(fastify);
      console.log('[BOOT] Assets module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Assets module:', err);
    }
  });

  // Central Chart Module
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Chart module...');
    try {
      const { chartRoutes } = await import('./modules/chart/index.js');
      await fastify.register(chartRoutes);
      console.log('[BOOT] Chart module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Chart module:', err);
    }
  });

  // Price vs Expectation Module (композитный endpoint для графика)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Price vs Expectation module...');
    try {
      const { priceVsExpectationRoutes } = await import('./modules/chart/price_vs_expectation.routes.js');
      await fastify.register(priceVsExpectationRoutes);
      console.log('[BOOT] Price vs Expectation module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Price vs Expectation module:', err);
    }
  });

  // Price vs Expectation V2 Module (new forecast-based system)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Price vs Expectation V2 module...');
    try {
      const { priceVsExpectationV2Routes } = await import('./modules/chart/price_vs_expectation_v2.routes.js');
      await fastify.register(priceVsExpectationV2Routes);
      console.log('[BOOT] Price vs Expectation V2 module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Price vs Expectation V2 module:', err);
    }
  });

  // Price vs Expectation V3 Module (Verdict Engine adapter)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Price vs Expectation V3 (Verdict Adapter) module...');
    try {
      const { verdictAdapterRoutes } = await import('./modules/chart/verdict_adapter.routes.js');
      await fastify.register(verdictAdapterRoutes);
      console.log('[BOOT] Price vs Expectation V3 module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Price vs Expectation V3 module:', err);
    }
  });

  // Candles API (TradingView-like OHLC data)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Candles API module...');
    try {
      const { registerCandlesRoutes } = await import('./modules/market/chart/candles.routes.js');
      await registerCandlesRoutes(fastify);
      console.log('[BOOT] Candles API module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Candles API module:', err);
    }
  });

  // Exchange Learning Health Module (admin debug)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Exchange Learning Health module...');
    try {
      const { exchangeLearningHealthRoutes } = await import('./modules/exchange/admin/exchange_learning_health.routes.js');
      await fastify.register(exchangeLearningHealthRoutes);
      console.log('[BOOT] Exchange Learning Health module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Exchange Learning Health module:', err);
    }
  });

  // Alt Scanner Module (Cross-sectional Altcoin Analysis)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Alt Scanner module...');
    try {
      const { registerAltScannerRoutes } = await import('./modules/exchange-alt/index.js');
      await registerAltScannerRoutes(fastify);
      console.log('[BOOT] Alt Scanner module registered successfully');
    } catch (err) {
      console.error('[BOOT] Failed to register Alt Scanner module:', err);
    }
  });

  // P1.1 — Verdict Engine Module (Cross-Horizon Ensemble Decision Engine)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Verdict Engine module...');
    try {
      const { VerdictEngineImpl, IntelligenceMetaBrainAdapter, ShadowHealthAdapter } = await import('./modules/verdict/index.js');
      const { CredibilityService } = await import('./modules/evolution/index.js');
      const verdictRoutes = await import('./modules/verdict/api/verdict.routes.js');
      
      // Create services
      const credibilityService = new CredibilityService();
      
      // P2: Real MetaBrain adapter (connects to /modules/intelligence/)
      const metaBrain = new IntelligenceMetaBrainAdapter();
      
      // P2: Real Health adapter (connects to ML Shadow Monitor)
      const healthPort = new ShadowHealthAdapter();
      
      // Create engine with all real adapters:
      // - MetaBrain: applies invariants, risk caps, macro regime
      // - Calibration: applies credibility-based confidence modifiers
      // - Health: applies shadow monitor damping
      const engine = new VerdictEngineImpl(
        metaBrain,
        {
          getConfidenceModifier: (args: any) => credibilityService.getConfidenceModifier(args),
        },
        healthPort
      );
      
      // Register routes
      await verdictRoutes.default(fastify, { engine });
      
      console.log('[BOOT] Verdict Engine module registered with real MetaBrain + ShadowHealth');
    } catch (err) {
      console.error('[BOOT] Failed to register Verdict Engine module:', err);
    }
  });

  // P1.2 — Evolution Module (Self-Learning Feedback Loop)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Evolution module...');
    try {
      const { OutcomeService, CredibilityService, RealPriceAdapter, startEvolutionCron } = await import('./modules/evolution/index.js');
      const evolutionRoutes = await import('./modules/evolution/api/evolution.routes.js');
      
      // Create services
      const credibilityService = new CredibilityService();
      
      // P1: Real PricePort using price.service.ts
      // Single source of truth for: chart, outcomes, forecast baseline, evolution
      const pricePort = new RealPriceAdapter();
      
      const outcomeService = new OutcomeService(pricePort, credibilityService);
      
      // Register routes with pricePort for testing endpoint
      await evolutionRoutes.default(fastify, { outcomeService, credibilityService, pricePort });
      
      // Start cron job for automatic outcome evaluation
      try {
        startEvolutionCron(outcomeService);
      } catch (cronErr) {
        console.warn('[BOOT] Evolution cron failed to start (node-cron might not be installed):', cronErr);
      }
      
      console.log('[BOOT] Evolution module registered with RealPriceAdapter');
    } catch (err) {
      console.error('[BOOT] Failed to register Evolution module:', err);
    }
  });

  // P3: Smart Caching Layer — Verdict V4 Fast API + Cache Admin + Jobs
  app.register(async (fastify) => {
    console.log('[BOOT] Registering P3 Smart Caching Layer...');
    try {
      // V4 Fast API endpoint
      const { verdictV4Routes } = await import('./modules/verdict/routes/verdict_v4.routes.js');
      await verdictV4Routes(fastify);
      
      // Cache Admin routes
      const { verdictCacheAdminRoutes } = await import('./modules/verdict/routes/verdict_cache_admin.routes.js');
      await verdictCacheAdminRoutes(fastify);
      
      // Start Heavy Verdict warmup job (Block 7)
      const { heavyVerdictJob } = await import('./modules/verdict/jobs/heavy-verdict.job.js');
      heavyVerdictJob.start();
      
      // Start Heavy Verdict refresh job (Block 12: TTL Auto-Refresh)
      const { heavyVerdictRefreshJob } = await import('./modules/verdict/jobs/heavy-verdict.refresh.job.js');
      heavyVerdictRefreshJob.start();
      
      console.log('[BOOT] P3 Smart Caching Layer registered (V4 API + Cache Admin + Warmup Job + Refresh Job)');
    } catch (err) {
      console.error('[BOOT] Failed to register P3 Smart Caching Layer:', err);
    }
  });

  // BLOCK B: Multi-Asset Ranking (Top Conviction)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering BLOCK B: Rankings API...');
    try {
      const { rankingsRoutes } = await import('./modules/market/routes/rankings.routes.js');
      await rankingsRoutes(fastify);
      console.log('[BOOT] BLOCK B: Rankings API registered');
    } catch (err) {
      console.error('[BOOT] Failed to register Rankings API:', err);
    }
  });

  // Symbols API (Dynamic Asset Search)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Symbols API...');
    try {
      const { symbolsRoutes } = await import('./modules/market/routes/symbols.routes.js');
      await symbolsRoutes(fastify);
      console.log('[BOOT] Symbols API registered');
    } catch (err) {
      console.error('[BOOT] Failed to register Symbols API:', err);
    }
  });

  // BLOCK F1: Forecast Series (Time-Series Forecast Persistence)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering BLOCK F1: Forecast Series...');
    try {
      const { getDb } = await import('./db/mongodb.js');
      const { registerForecastSeriesRoutes, registerForecastSnapshotJob, registerForecastOnlyRoutes } = await import('./modules/forecast-series/index.js');
      const { heavyComputeService } = await import('./modules/verdict/runtime/heavy-compute.service.js');
      
      const db = getDb();
      
      // Adapter function to convert heavyComputeService output to VerdictLike
      const getVerdictV4 = async (args: { symbol: string; horizon: '1D' | '7D' | '30D' }) => {
        const payload = await heavyComputeService.compute(args.symbol, args.horizon);
        if (!payload.verdict) return null;
        
        // Extract price data
        const fromPrice = payload.layers?.snapshot?.price || 0;
        
        return {
          symbol: args.symbol,
          horizon: args.horizon,
          fromPrice,
          expectedMovePct: payload.verdict.expectedMovePct || payload.verdict.expectedReturn || 0,
          confidence: payload.verdict.confidenceAdjusted || payload.verdict.confidence || 0.5,
          explain: {
            overlays: {
              volatilityPct: payload.layers?.features?.volatility_1d,
            },
            meta: {
              verdictId: `${args.symbol}-${args.horizon}-${Date.now()}`,
            },
          },
        };
      };
      
      // V3.2: Adapter for forecast-only routes (per layer)
      const getVerdictForLayer = async (args: { symbol: string; horizon: '1D' | '7D' | '30D'; layer?: string }) => {
        const payload = await heavyComputeService.compute(args.symbol, args.horizon);
        
        if (!payload.verdict) return null;
        
        // Get current price from snapshot
        const lastPrice = payload.layers?.snapshot?.price || 0;
        
        // Find candidate for requested horizon (has correct expectedReturn!)
        const candidates = payload.candidates || [];
        const horizonCandidate = candidates.find((c: any) => c.horizon === args.horizon);
        
        let expectedMovePct = 0;
        let confidence = 0.5;
        
        if (horizonCandidate) {
          // Use candidate's expectedReturn (it's already in decimal form, e.g. 0.098 = 9.8%)
          expectedMovePct = horizonCandidate.expectedReturn || 0;
          confidence = horizonCandidate.confidence || 0.5;
          
          console.log(`[getVerdictForLayer] ${args.symbol}/${args.horizon}: Using candidate expectedReturn=${expectedMovePct} (${(expectedMovePct * 100).toFixed(2)}%)`);
        } else {
          // Fallback to verdict data
          const rawReturn = payload.verdict.expectedReturn ?? 0;
          expectedMovePct = rawReturn;
          confidence = payload.verdict.confidence ?? 0.5;
          
          console.log(`[getVerdictForLayer] ${args.symbol}/${args.horizon}: FALLBACK verdict expectedReturn=${expectedMovePct}`);
        }
        
        return {
          fromPrice: lastPrice,
          expectedMovePct,
          confidence,
        };
      };
      
      // Register routes
      await registerForecastSeriesRoutes(fastify, { db, getVerdictV4 });
      
      // V3.4: Import snapshot creator for outcome tracking
      let createSnapshot: ((params: any) => Promise<string>) | undefined;
      try {
        const { getOutcomeTrackerService } = await import('./modules/forecast-series/outcome-tracking/index.js');
        const { getCurrentPrice } = await import('./modules/chart/services/price.service.js');
        
        const priceProvider = {
          getCurrentPrice: async (symbol: string) => getCurrentPrice(symbol),
          getHistoricalPrice: async (symbol: string, _timestamp: Date) => getCurrentPrice(symbol),
        };
        
        const outcomeService = getOutcomeTrackerService(db, priceProvider);
        createSnapshot = (params: any) => outcomeService.createSnapshot(params);
        console.log('[BOOT] V3.4: Snapshot creator initialized');
      } catch (snapshotErr: any) {
        console.warn('[BOOT] V3.4: Snapshot creator not available:', snapshotErr.message);
      }
      
      // V3.2: Register forecast-only routes (Brownian Bridge) + V3.4: Snapshot creation
      await registerForecastOnlyRoutes(fastify, { db, getVerdictForLayer, createSnapshot });
      
      // Register daily snapshot job (disabled by default, enable when ready)
      registerForecastSnapshotJob(fastify, {
        db,
        getVerdictV4,
        config: {
          enabled: process.env.FORECAST_SNAPSHOT_JOB === '1',
          runOnStart: false,
          intervalMs: 24 * 60 * 60 * 1000, // 24h
        },
      });
      
      console.log('[BOOT] BLOCK F1: Forecast Series registered (routes + job + forecast-only)');
    } catch (err) {
      console.error('[BOOT] Failed to register Forecast Series:', err);
    }
  });

  // V3.4: Outcome Tracking (WIN/LOSS tracking for forecasts)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering V3.4: Outcome Tracking...');
    try {
      const { getDb } = await import('./db/mongodb.js');
      const { 
        registerForecastOutcomeRoutes, 
        registerOutcomeTrackerJob,
      } = await import('./modules/forecast-series/index.js');
      const { getCurrentPrice } = await import('./modules/chart/services/price.service.js');
      
      const db = getDb();
      
      // Adapter for price provider
      const priceProvider = {
        getCurrentPrice: async (symbol: string) => {
          return getCurrentPrice(symbol);
        },
        getHistoricalPrice: async (symbol: string, _timestamp: Date) => {
          // For historical, use current price as fallback
          // In production, this should query historical candle data
          return getCurrentPrice(symbol);
        },
      };
      
      // Register outcome routes
      await registerForecastOutcomeRoutes(fastify, { db, priceProvider });
      
      // V3.10-STABLE: Register snapshots history routes (for Ghost Mode overlay)
      const { registerForecastSnapshotsHistoryRoutes } = await import('./modules/forecast-series/forecast-snapshots-history.routes.js');
      await registerForecastSnapshotsHistoryRoutes(fastify, { db });
      
      // Register outcome tracker job (checks pending snapshots)
      const outcomeJobEnabled = process.env.OUTCOME_TRACKER_JOB === '1';
      if (outcomeJobEnabled) {
        registerOutcomeTrackerJob(db, priceProvider, {
          enabled: true,
          intervalMs: 5 * 60 * 1000, // 5 minutes
        });
      }
      
      console.log('[BOOT] V3.4: Outcome Tracking + V3.10 Snapshots History registered');
    } catch (err) {
      console.error('[BOOT] Failed to register Outcome Tracking:', err);
    }
  });

  // V3.5-V3.7: Quality + Drift Engine
  app.register(async (fastify) => {
    console.log('[BOOT] Registering V3.5-V3.7: Quality + Drift Engine...');
    try {
      const { getDb } = await import('./db/mongodb.js');
      const { 
        registerForecastQualityRoutes,
        registerForecastDriftRoutes,
      } = await import('./modules/forecast-series/index.js');
      
      const db = getDb();
      
      // V3.5-V3.6: Quality Badge API
      await registerForecastQualityRoutes(fastify, { db });
      
      // V3.7: Drift Detector API
      await registerForecastDriftRoutes(fastify, { db });
      
      console.log('[BOOT] V3.5-V3.7: Quality + Drift Engine registered');
    } catch (err) {
      console.error('[BOOT] Failed to register Quality + Drift Engine:', err);
    }
  });

  // Forecast Performance Table (joins snapshots + outcomes for UI)
  app.register(async (fastify) => {
    console.log('[BOOT] Registering Forecast Performance Table...');
    try {
      const { getDb } = await import('./db/mongodb.js');
      const { registerForecastTableRoutes } = await import('./modules/forecast-series/forecast-table.routes.js');
      
      const db = getDb();
      registerForecastTableRoutes(fastify, db);
      
      console.log('[BOOT] Forecast Performance Table registered');
    } catch (err) {
      console.error('[BOOT] Failed to register Forecast Performance Table:', err);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // LAYER 2: Connections Module Proxy
  // ═══════════════════════════════════════════════════════════════
  // Connections is a STANDALONE service (port 8003).
  // These routes proxy requests through main API for frontend access.
  // READ-ONLY - does NOT affect forecast pipeline.
  app.register(async (fastify) => {
    const connectionsEnabled = process.env.CONNECTIONS_ENABLED === 'true';
    if (!connectionsEnabled) {
      console.log('[BOOT] Connections Proxy DISABLED (CONNECTIONS_ENABLED != true)');
      return;
    }
    
    console.log('[BOOT] Registering Connections Proxy (Layer 2)...');
    try {
      const { registerConnectionsProxyRoutes, registerConnectionsAdminRoutes } = await import('./modules/connections-proxy/index.js');
      await fastify.register(registerConnectionsProxyRoutes, { prefix: '/api/connections' });
      await fastify.register(registerConnectionsAdminRoutes, { prefix: '/api/admin/connections' });
      console.log('[BOOT] Connections Proxy registered at /api/connections/*');
      console.log('[BOOT] Connections Admin registered at /api/admin/connections/*');
    } catch (err) {
      console.error('[BOOT] Failed to register Connections Proxy:', err);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // FRACTAL MODULE: Historical Pattern Matching Engine
  // ═══════════════════════════════════════════════════════════════
  // Independent module for finding historical market analogs.
  // READ-ONLY - provides context, does NOT generate trading signals.
  // excluded_from_training: true
  app.register(async (fastify) => {
    const fractalEnabled = process.env.FRACTAL_ENABLED !== 'false';
    console.log(`[BOOT] Fractal Module ${fractalEnabled ? 'ENABLED' : 'DISABLED'}`);
    
    try {
      const { registerFractalModule } = await import('./modules/fractal/index.js');
      await registerFractalModule(fastify);
      console.log('[BOOT] Fractal Module registered at /api/fractal/*');
    } catch (err) {
      console.error('[BOOT] Failed to register Fractal Module:', err);
    }
  });

  return app;
}
