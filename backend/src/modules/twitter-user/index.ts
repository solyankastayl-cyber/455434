// Twitter User Module - Full Production Mode (Block 4 - Control Plane)
import { CryptoService } from './crypto/crypto.service.js';
import { IntegrationService } from './services/integration.service.js';
import { SessionService } from './services/session.service.js';
import { AccountService } from './services/account.service.js';
import { ParsedTweetService } from './services/parsed-tweet.service.js';

// Export State Machine (Block 2)
export * from './types/twitter-integration-state.js';
export * from './services/integration-state.resolver.js';
export * from './services/integration-state.transition.js';
export * from './services/integration-state.notifier.js';

// Export models
export * from './models/twitter-consent.model.js';
export * from './models/twitter-account.model.js';
export * from './models/twitter-session.model.js';
export * from './models/twitter-integration-snapshot.model.js';
export * from './models/user-twitter-parse-target.model.js';
export * from './models/user-twitter-quota.model.js';
// Use existing TwitterTask model from execution module (only runtime exports)
export { TwitterTaskModel, TaskStatus } from '../twitter/execution/queue/task.model.js';
export * from './models/twitter-parsed-tweet.model.js';

// Export types
export * from './models/_types.js';

// Export DTOs
export * from './dto/twitter-webhook.dto.js';
export * from './dto/twitter-integration.dto.js';
export * from './dto/twitter-user.dto.js';

// Export auth/acl (Phase 1.1 - API Key Auth)
export * from './auth/require-user.hook.js';
export * from './auth/api-key.middleware.js';
export * from './acl/ownership.js';

// Export API Key management
export * from './models/user-api-key.model.js';
export * from './services/api-key.service.js';
export { registerApiKeyRoutes } from './routes/api-key.routes.js';

// Export services (Block 4)
export * from './services/parse-target.service.js';
export * from './services/quota.service.js';
export * from './services/scheduler.service.js';

// Export Phase 1.3 - Session Selection
export * from './services/session-selector.service.js';

// Export Phase 1.4 - Parse Runtime
export * from './services/parser-client.service.js';
export * from './services/abort-handler.service.js';
export * from './services/parse-runtime.service.js';
export * from './dto/parse-request.dto.js';
export * from './models/twitter-parse-task.model.js';

// Export scroll engine (Block 4.4)
export * from './scroll/scroll-profiles.js';
export * from './scroll/scroll-risk.js';
export * from './scroll/scroll-engine.js';

// Export services
export { CryptoService, IntegrationService, SessionService, AccountService, ParsedTweetService };

// Export routes
export { registerTwitterUserRoutes } from './routes/user.routes.js';
export { registerTwitterWebhookRoutes } from './routes/webhook.routes.js';
export { registerParseTargetRoutes } from './routes/parse-target.routes.js';
export { registerQuotaRoutes } from './routes/quota.routes.js';
export { registerSchedulerRoutes } from './routes/scheduler.routes.js';
export { registerScrollRuntimeRoutes } from './routes/scroll-runtime.routes.js';
// Phase 1.3 - Runtime Selection
export { registerRuntimeSelectionRoutes } from './routes/runtime-selection.routes.js';
// Phase 1.4 - Parse Routes
export { registerParseRoutes } from './routes/parse.routes.js';
// Debug Routes
export { registerDebugRoutes } from './routes/debug.routes.js';
// A.2.1 - Account Management Routes
export { registerAccountRoutes } from './routes/account.routes.js';

// Export workers
export { getPlannerWorker } from './workers/planner.worker.js';

// Export migration
export { migrateAddOwnerFields } from './migrations/2026-02-01_add_owner_fields.js';

/**
 * Initialize Twitter User Module - Production Mode
 * Services are initialized in dependency order
 */
export function createTwitterUserModule(config: { cookieEncKey: string }) {
  console.log('[TwitterUserModule] Initializing production services...');
  
  // 1. CryptoService - no dependencies
  const crypto = new CryptoService(config.cookieEncKey);
  console.log('[TwitterUserModule] ✅ CryptoService initialized');
  
  // 2. IntegrationService - MongoDB only
  const integration = new IntegrationService();
  console.log('[TwitterUserModule] ✅ IntegrationService initialized');
  
  // 3. SessionService - requires CryptoService
  const sessions = new SessionService(crypto);
  console.log('[TwitterUserModule] ✅ SessionService initialized');
  
  // 4. AccountService - MongoDB only
  const accounts = new AccountService();
  console.log('[TwitterUserModule] ✅ AccountService initialized');
  
  // 5. ParsedTweetService - MongoDB only
  const parsedTweets = new ParsedTweetService();
  console.log('[TwitterUserModule] ✅ ParsedTweetService initialized');
  
  console.log('[TwitterUserModule] All services ready');

  return {
    crypto,
    integration,
    sessions,
    accounts,
    parsedTweets,
  };
}

