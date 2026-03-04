/**
 * Twitter Post Enrichment Aggregation Layer
 * ==========================================
 * 
 * СТЫКОВОЧНЫЙ СЛОЙ — склеивает результаты независимых модулей.
 * 
 * ВАЖНО:
 * - sentiment НЕ ЗНАЕТ про authorIntel
 * - authorIntel НЕ ЗНАЕТ про sentiment
 * - price НЕ ЗНАЕТ про оба
 * - Они "встречаются" ТОЛЬКО ЗДЕСЬ
 * 
 * Это LEGO-стык для модульной архитектуры.
 */

import { sentimentClient } from '../modules/sentiment/sentiment.client.js';

// ============================================================
// Feature Flags
// ============================================================

const FLAGS = {
  SENTIMENT_ENABLED: process.env.TWITTER_SENTIMENT_ENABLED === 'true',
  AUTHOR_INTEL_ENABLED: process.env.AUTHOR_INTEL_ENABLED === 'true',
  PRICE_CONTEXT_ENABLED: process.env.TWITTER_PRICE_ENABLED === 'true',
};

// ============================================================
// Types (local, не зависят от contracts напрямую в runtime)
// ============================================================

interface TwitterPost {
  tweet_id: string;
  text: string;
  author: {
    author_id: string;
    username: string;
    avatar_url: string;
    followers_count: number;
    following_count: number;
  };
  engagement?: {
    likes: number;
    reposts: number;
    replies: number;
  };
  created_at?: string;
}

interface SentimentResult {
  label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  score: number;
  confidence: string;
  confidenceScore: number;
  reasons: string[];
  engineVersion: string;
  processedAt: string;
}

interface AuthorIntelResult {
  trustScore: number;
  botProbability: number;
  influenceScore: number;
  followerQuality: number;
  accountAge: number;
  activityPattern: string;
  flags: string[];
  processedAt: string;
}

interface PriceContextResult {
  asset: string;
  priceAtPost: number;
  price24hAfter?: number;
  priceChange24h?: number;
  processedAt: string;
}

interface EnrichedPost {
  post: TwitterPost;
  sentiment: SentimentResult | null;
  authorIntel: AuthorIntelResult | null;
  priceContext: PriceContextResult | null;
  enrichedAt: string;
  enabledModules: string[];
}

// ============================================================
// Module Adapters (изолированные вызовы)
// ============================================================

/**
 * Sentiment Module Adapter
 * Зона ответственности: /modules/sentiment/*
 */
async function enrichWithSentiment(text: string): Promise<SentimentResult | null> {
  if (!FLAGS.SENTIMENT_ENABLED) return null;
  
  try {
    const result = await sentimentClient.predict(text);
    
    return {
      label: result.label as 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE',
      score: result.score,
      confidence: result.meta?.confidence || 'UNKNOWN',
      confidenceScore: result.meta?.confidenceScore || 0,
      reasons: result.meta?.reasons || [],
      engineVersion: result.meta?.engineVersion || 'unknown',
      processedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('[Aggregation] Sentiment enrichment failed:', error.message);
    return null;
  }
}

/**
 * Author Intelligence Module Adapter
 * Зона ответственности: /modules/author-intel/*
 * 
 * PLACEHOLDER — будет реализован другим разработчиком
 */
async function enrichWithAuthorIntel(author: TwitterPost['author']): Promise<AuthorIntelResult | null> {
  if (!FLAGS.AUTHOR_INTEL_ENABLED) return null;
  
  // TODO: Implement when author-intel module is ready
  // import { authorIntelEngine } from '../modules/author-intel/author-intel.client.js';
  // return authorIntelEngine.analyze(author);
  
  console.warn('[Aggregation] Author Intel module not implemented yet');
  return null;
}

/**
 * Price Context Module Adapter
 * Зона ответственности: /modules/price/* (S5)
 * 
 * PLACEHOLDER — будет реализован в Phase S5
 */
async function enrichWithPriceContext(post: TwitterPost): Promise<PriceContextResult | null> {
  if (!FLAGS.PRICE_CONTEXT_ENABLED) return null;
  
  // TODO: Implement when price module is ready (S5)
  // import { priceContextEngine } from '../modules/price/price-context.client.js';
  // return priceContextEngine.analyze(post);
  
  console.warn('[Aggregation] Price Context module not implemented yet');
  return null;
}

// ============================================================
// Main Aggregation Function
// ============================================================

/**
 * Обогащает TwitterPost данными из всех включённых модулей.
 * 
 * Каждый модуль вызывается НЕЗАВИСИМО.
 * Ошибка одного модуля НЕ влияет на другие.
 */
export async function enrichTwitterPost(post: TwitterPost): Promise<EnrichedPost> {
  const enabledModules: string[] = [];
  
  // Parallel enrichment — модули независимы
  const [sentiment, authorIntel, priceContext] = await Promise.all([
    enrichWithSentiment(post.text),
    enrichWithAuthorIntel(post.author),
    enrichWithPriceContext(post),
  ]);
  
  // Track enabled modules
  if (FLAGS.SENTIMENT_ENABLED) enabledModules.push('sentiment');
  if (FLAGS.AUTHOR_INTEL_ENABLED) enabledModules.push('author-intel');
  if (FLAGS.PRICE_CONTEXT_ENABLED) enabledModules.push('price-context');
  
  return {
    post,
    sentiment,
    authorIntel,
    priceContext,
    enrichedAt: new Date().toISOString(),
    enabledModules,
  };
}

/**
 * Batch enrichment для очереди
 */
export async function enrichTwitterPostBatch(posts: TwitterPost[]): Promise<EnrichedPost[]> {
  return Promise.all(posts.map(enrichTwitterPost));
}

// ============================================================
// Status & Health
// ============================================================

export function getAggregationStatus() {
  return {
    flags: FLAGS,
    modules: {
      sentiment: {
        enabled: FLAGS.SENTIMENT_ENABLED,
        status: 'ready',
      },
      authorIntel: {
        enabled: FLAGS.AUTHOR_INTEL_ENABLED,
        status: FLAGS.AUTHOR_INTEL_ENABLED ? 'not_implemented' : 'disabled',
      },
      priceContext: {
        enabled: FLAGS.PRICE_CONTEXT_ENABLED,
        status: FLAGS.PRICE_CONTEXT_ENABLED ? 'not_implemented' : 'disabled',
      },
    },
  };
}

export default {
  enrich: enrichTwitterPost,
  enrichBatch: enrichTwitterPostBatch,
  getStatus: getAggregationStatus,
};
