/**
 * Twitter Parser Module — Storage Index
 * 
 * Single entry point for all storage models.
 * Based on: v4.2-final
 */

// Types
export * from './types.js';

// Models
export { TwitterSessionModel, type ITwitterSession } from './session.model.js';
export { TwitterAccountModel, type ITwitterAccount } from './account.model.js';
export { TwitterTaskModel, type ITwitterTask, PRIORITY_VALUES } from './task.model.js';
export { TwitterParseTargetModel, type ITwitterParseTarget } from './target.model.js';
export { TwitterParsedTweetModel, type ITwitterParsedTweet, type ITweetAuthor, type ITweetMetrics } from './tweet.model.js';
export { ParserQualityMetricsModel, type IParserQualityMetrics } from './quality.model.js';

/**
 * Initialize storage (register all models)
 * 
 * Called by initTwitterParser() during module init.
 * Models are auto-registered when imported, but this ensures
 * all models are loaded before any queries.
 */
export function initStorage(): void {
  // Models are registered on import
  // This function is a hook for future init logic
  console.log('[TwitterParser:Storage] Models registered');
}
