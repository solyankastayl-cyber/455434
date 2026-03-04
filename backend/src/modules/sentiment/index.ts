/**
 * Sentiment Module Index
 */

import { FastifyInstance } from 'fastify';
import { registerSentimentRoutes } from './sentiment.routes.js';
import { registerSentimentAdminRoutes } from './sentiment.admin.routes.js';
import { registerTwitterRuntimeRoutes } from './twitter-runtime.routes.js';
import { registerSentimentAutomationRoutes } from './sentiment-automation.routes.js';
import { registerPublicSentimentRoutes } from './public-sentiment.routes.js';
import ml1ShadowRoutes from './ml1-shadow.routes.js';
import retrainDatasetRoutes from './retrain-dataset.routes.js';
import twitterDataSessionRoutes from './twitter-data-session.routes.js';

export async function initSentimentModule(app: FastifyInstance) {
  const enabled = process.env.SENTIMENT_ENABLED === 'true';
  
  if (!enabled) {
    console.log('[Sentiment] Module disabled (SENTIMENT_ENABLED != true)');
    return;
  }

  console.log('[Sentiment] Initializing module...');
  
  // Register routes
  registerSentimentRoutes(app);
  registerSentimentAdminRoutes(app);
  
  // Public Sentiment API (standalone, no admin/price/observation deps)
  registerPublicSentimentRoutes(app);
  console.log('[Sentiment] Public API routes registered (/api/public/sentiment/*)');
  
  // Phase 10.8: Twitter Runtime Validation
  registerTwitterRuntimeRoutes(app);
  console.log('[Sentiment] Twitter Runtime routes registered (10.8)');
  
  // Phase S4.1: Twitter Sentiment Automation
  registerSentimentAutomationRoutes(app);
  console.log('[Sentiment] Automation routes registered (S4.1)');
  
  // ML1: Shadow Mode
  await ml1ShadowRoutes(app);
  console.log('[Sentiment] ML1 Shadow routes registered');
  
  // ML1.R: Retrain Dataset
  await retrainDatasetRoutes(app);
  console.log('[Sentiment] ML1.R Retrain Dataset routes registered');
  
  // ML1.R.DS: Twitter Data Session
  await twitterDataSessionRoutes(app);
  console.log('[Sentiment] ML1.R.DS Twitter Data Session routes registered');
  
  console.log('[Sentiment] Module initialized ✓');
}

export { sentimentClient } from './sentiment.client.js';
export { realMLShadowClient } from './real-ml-shadow.client.js';
export { retrainDatasetService } from './retrain-dataset.service.js';
