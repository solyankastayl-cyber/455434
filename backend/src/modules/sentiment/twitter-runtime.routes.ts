/**
 * Phase 10.8 + 10.9 — Twitter Runtime & Data Quality Routes
 * ==========================================================
 * 
 * API endpoints for Twitter validation, health monitoring, and data quality.
 * Part of Sentiment Engine but isolated from core logic.
 * 
 * 10.8: Runtime validation (CAPTCHA, health)
 * 10.9: Data completeness validation (LOCKED contract v1)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ============================================================
// Contract v1 Constants (LOCKED - Phase 10.9)
// ============================================================

const CONTRACT_VERSION = '1.0.0';
const CONTRACT_LOCKED = true;
const CONTRACT_LOCKED_AT = '2025-12-01';

const REQUIRED_FIELDS = [
  'post.tweet_id',
  'post.text',
  'post.metrics.likes',
  'post.metrics.reposts',
  'author.author_id',
  'author.username',
  'author.avatar_url',
  'author.followers_count',
  'author.following_count',
];

const MIN_COMPLETENESS_SCORE = 0.85;

// ============================================================
// In-memory Runtime State (Phase 10.8 + 10.9)
// ============================================================

interface TwitterRuntimeState {
  enabled: boolean;
  sentimentEnabled: boolean;
  priceEnabled: boolean;
  mode: 'RULES_ONLY' | 'LIGHT_ML' | 'FULL_ML';
  health: {
    status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE';
    captchaCount: number;
    consecutiveCaptchas: number;
    lastSuccessAt: Date | null;
    avgPostsPerMinute: number;
    validPayloadRate: number;
    autoDisabled: boolean;
    reason?: string;
  };
  stats: {
    totalValidated: number;
    validCount: number;
    degradedCount: number;
    droppedCount: number;
    lastValidatedAt: Date | null;
  };
  dataQuality: {
    totalChecked: number;
    completeCount: number;
    partialCount: number;
    invalidCount: number;
    avgCompletenessScore: number;
    missingFieldsFrequency: Record<string, number>;
    lastCheckedAt: Date | null;
  };
}

const runtimeState: TwitterRuntimeState = {
  enabled: process.env.TWITTER_PARSER_ENABLED === 'true',
  sentimentEnabled: process.env.TWITTER_SENTIMENT_ENABLED === 'true',
  priceEnabled: process.env.TWITTER_PRICE_ENABLED === 'true',
  mode: 'RULES_ONLY',
  health: {
    status: 'OFFLINE',
    captchaCount: 0,
    consecutiveCaptchas: 0,
    lastSuccessAt: null,
    avgPostsPerMinute: 0,
    validPayloadRate: 1,
    autoDisabled: false,
  },
  stats: {
    totalValidated: 0,
    validCount: 0,
    degradedCount: 0,
    droppedCount: 0,
    lastValidatedAt: null,
  },
  dataQuality: {
    totalChecked: 0,
    completeCount: 0,
    partialCount: 0,
    invalidCount: 0,
    avgCompletenessScore: 0,
    missingFieldsFrequency: {},
    lastCheckedAt: null,
  },
};

// ============================================================
// Validator Config (frozen v1.5)
// ============================================================

const VALIDATOR_CONFIG = {
  minTextLength: 10,
  influenceThresholds: { weak: 1.0, normal: 2.5, strong: 4.0 },
  minFollowersForStrong: 1000,
  minEngagementForStrong: 50,
  captchaCriticalLimit: 3,
  minValidPayloadRate: 0.8,
};

// ============================================================
// Data Completeness Functions (Phase 10.9)
// ============================================================

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

function isValidValue(value: any): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (typeof value === 'number' && isNaN(value)) return false;
  return true;
}

interface CompletenessResult {
  valid: boolean;
  score: number;
  missing: string[];
  warnings: string[];
  status: 'COMPLETE' | 'PARTIAL' | 'INVALID';
}

function validateDataCompleteness(payload: any): CompletenessResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  let presentCount = 0;
  
  // Normalize payload structure
  const normalized = {
    post: {
      tweet_id: payload.post?.tweet_id || payload.tweet_id || payload.tweetId || payload.id,
      text: payload.post?.text || payload.text,
      metrics: {
        likes: payload.post?.metrics?.likes ?? payload.metrics?.likes ?? payload.likes,
        reposts: payload.post?.metrics?.reposts ?? payload.metrics?.reposts ?? payload.reposts,
      },
    },
    author: {
      author_id: payload.author?.author_id || payload.author?.id,
      username: payload.author?.username || payload.username,
      avatar_url: payload.author?.avatar_url || payload.author?.avatarUrl || payload.author?.avatar,
      followers_count: payload.author?.followers_count ?? payload.author?.followers,
      following_count: payload.author?.following_count ?? payload.author?.following,
    },
  };

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    const value = getNestedValue(normalized, field);
    if (isValidValue(value)) {
      presentCount++;
    } else {
      missing.push(field);
    }
  }

  const totalRequired = REQUIRED_FIELDS.length;
  const score = presentCount / totalRequired;
  const hasAllRequired = missing.length === 0;
  const valid = hasAllRequired;
  
  let status: 'COMPLETE' | 'PARTIAL' | 'INVALID';
  if (valid && score >= 0.95) {
    status = 'COMPLETE';
  } else if (hasAllRequired || score >= MIN_COMPLETENESS_SCORE) {
    status = 'PARTIAL';
  } else {
    status = 'INVALID';
  }

  return { valid, score: Math.round(score * 100) / 100, missing, warnings, status };
}

function isMinimumViablePayload(payload: any): { ok: boolean; reason?: string } {
  const tweetId = payload?.post?.tweet_id || payload?.tweet_id || payload?.tweetId || payload?.id;
  const text = payload?.post?.text || payload?.text;
  const avatarUrl = payload?.author?.avatar_url || payload?.author?.avatarUrl || payload?.author?.avatar;
  const likes = payload?.post?.metrics?.likes ?? payload?.metrics?.likes ?? payload?.likes;
  const reposts = payload?.post?.metrics?.reposts ?? payload?.metrics?.reposts ?? payload?.reposts;
  const followers = payload?.author?.followers_count ?? payload?.author?.followers;

  if (!tweetId) return { ok: false, reason: 'Missing tweet_id' };
  if (!text) return { ok: false, reason: 'Missing text' };
  if (!avatarUrl) return { ok: false, reason: 'Missing author avatar_url' };
  if (likes === undefined && reposts === undefined) return { ok: false, reason: 'Missing engagement metrics' };
  if (followers === undefined) return { ok: false, reason: 'Missing author followers_count' };
  
  return { ok: true };
}

// ============================================================
// Validation Functions
// ============================================================

function calculateInfluenceScore(followers: number, likes: number, retweets: number): number {
  const engagement = likes + retweets;
  const followerScore = Math.log10(followers + 1);
  const engagementScore = Math.log10(engagement + 1);
  return followerScore * 0.4 + engagementScore * 0.6;
}

function getSignalStrength(
  influenceScore: number,
  textLength: number,
  hasQuestion: boolean
): 'NONE' | 'WEAK' | 'NORMAL' | 'STRONG' {
  if (textLength < 20) return 'WEAK';
  if (hasQuestion) return 'WEAK';
  
  const { weak, normal, strong } = VALIDATOR_CONFIG.influenceThresholds;
  if (influenceScore >= strong) return 'STRONG';
  if (influenceScore >= normal) return 'NORMAL';
  if (influenceScore >= weak) return 'WEAK';
  return 'NONE';
}

interface ValidationResult {
  status: 'VALID' | 'DEGRADED' | 'INVALID' | 'DROPPED';
  warnings: string[];
  errors: string[];
  influenceScore: number;
  signalStrength: 'NONE' | 'WEAK' | 'NORMAL' | 'STRONG';
  canProcess: boolean;
  canInfluence: boolean;
  contextMultiplier: number;
}

function validateTweetPayload(tweet: any): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Critical checks
  if (!tweet.id && !tweet.tweetId) errors.push('Missing tweet ID');
  if (!tweet.text) errors.push('Missing text');
  if (tweet.text && tweet.text.length < VALIDATOR_CONFIG.minTextLength) {
    warnings.push(`Text too short (${tweet.text.length} chars)`);
  }
  
  // Author validation
  const username = tweet.author?.username || tweet.username;
  if (!username) errors.push('Missing author username');
  if (!tweet.author?.avatar && !tweet.author?.avatarUrl) warnings.push('Missing author avatar');
  
  const followers = tweet.author?.followers || 0;
  if (followers === 0) warnings.push('Missing followers count');
  
  // Metrics validation
  const likes = tweet.metrics?.likes ?? tweet.likes ?? 0;
  const retweets = tweet.metrics?.retweets ?? tweet.reposts ?? 0;
  if (likes === 0 && retweets === 0) warnings.push('Missing engagement metrics');
  
  // Determine status
  let status: 'VALID' | 'DEGRADED' | 'INVALID' | 'DROPPED';
  if (errors.some(e => e.includes('Missing tweet ID') || e.includes('Missing text'))) {
    status = 'DROPPED';
  } else if (errors.length > 0) {
    status = 'INVALID';
  } else if (warnings.length >= 2) {
    status = 'DEGRADED';
  } else {
    status = 'VALID';
  }
  
  // Calculate influence
  const influenceScore = calculateInfluenceScore(followers, likes, retweets);
  const hasQuestion = tweet.text?.includes('?') || false;
  const signalStrength = getSignalStrength(influenceScore, tweet.text?.length || 0, hasQuestion);
  
  // Context multiplier for sentiment
  let contextMultiplier = 1.0;
  if (signalStrength === 'STRONG') contextMultiplier = 1.3;
  else if (signalStrength === 'NORMAL') contextMultiplier = 1.1;
  else if (signalStrength === 'WEAK') contextMultiplier = 0.9;
  else contextMultiplier = 0.7;
  if (hasQuestion) contextMultiplier *= 0.8;
  contextMultiplier = Math.max(0.5, Math.min(1.5, contextMultiplier));
  
  return {
    status,
    warnings,
    errors,
    influenceScore: Math.round(influenceScore * 100) / 100,
    signalStrength,
    canProcess: status !== 'DROPPED',
    canInfluence: status === 'VALID' && signalStrength !== 'NONE',
    contextMultiplier: Math.round(contextMultiplier * 100) / 100,
  };
}

// ============================================================
// Routes Registration
// ============================================================

export function registerTwitterRuntimeRoutes(app: FastifyInstance) {
  
  // ============================================
  // GET /admin/sentiment/twitter/status
  // ============================================
  app.get('/api/v4/admin/sentiment/twitter/status', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      data: {
        contract: {
          version: CONTRACT_VERSION,
          locked: CONTRACT_LOCKED,
          lockedAt: CONTRACT_LOCKED_AT,
        },
        enabled: runtimeState.enabled,
        sentimentEnabled: runtimeState.sentimentEnabled,
        priceEnabled: runtimeState.priceEnabled,
        mode: runtimeState.mode,
        health: runtimeState.health,
        stats: runtimeState.stats,
        dataQuality: runtimeState.dataQuality,
        config: VALIDATOR_CONFIG,
      },
    });
  });

  // ============================================
  // GET /admin/sentiment/twitter/health
  // ============================================
  app.get('/api/v4/admin/sentiment/twitter/health', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      data: runtimeState.health,
    });
  });

  // ============================================
  // POST /admin/sentiment/twitter/validate
  // Validate a single tweet payload
  // ============================================
  app.post('/api/v4/admin/sentiment/twitter/validate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tweet } = req.body as { tweet: any };
    
    if (!tweet) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_TWEET',
        message: 'Tweet payload required',
      });
    }
    
    const result = validateTweetPayload(tweet);
    
    // Update stats
    runtimeState.stats.totalValidated++;
    runtimeState.stats.lastValidatedAt = new Date();
    if (result.status === 'VALID') runtimeState.stats.validCount++;
    else if (result.status === 'DEGRADED') runtimeState.stats.degradedCount++;
    else if (result.status === 'DROPPED') runtimeState.stats.droppedCount++;
    
    // Update health valid payload rate
    runtimeState.health.validPayloadRate = 
      runtimeState.stats.validCount / runtimeState.stats.totalValidated;
    
    return reply.send({
      ok: true,
      data: result,
    });
  });

  // ============================================
  // POST /admin/sentiment/twitter/validate-batch
  // Validate multiple tweets
  // ============================================
  app.post('/api/v4/admin/sentiment/twitter/validate-batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const { tweets } = req.body as { tweets: any[] };
    
    if (!tweets || !Array.isArray(tweets)) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_TWEETS',
        message: 'Array of tweets required',
      });
    }
    
    const results = tweets.map((tweet, index) => ({
      index,
      tweetId: tweet.id || tweet.tweetId,
      ...validateTweetPayload(tweet),
    }));
    
    const summary = {
      total: results.length,
      valid: results.filter(r => r.status === 'VALID').length,
      degraded: results.filter(r => r.status === 'DEGRADED').length,
      invalid: results.filter(r => r.status === 'INVALID').length,
      dropped: results.filter(r => r.status === 'DROPPED').length,
      canInfluence: results.filter(r => r.canInfluence).length,
    };
    
    // Update stats
    runtimeState.stats.totalValidated += results.length;
    runtimeState.stats.validCount += summary.valid;
    runtimeState.stats.degradedCount += summary.degraded;
    runtimeState.stats.droppedCount += summary.dropped;
    runtimeState.stats.lastValidatedAt = new Date();
    runtimeState.health.validPayloadRate = 
      runtimeState.stats.validCount / runtimeState.stats.totalValidated;
    
    return reply.send({
      ok: true,
      data: {
        summary,
        results,
      },
    });
  });

  // ============================================
  // PATCH /admin/sentiment/twitter/config
  // Update runtime mode
  // ============================================
  app.patch('/api/v4/admin/sentiment/twitter/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const { enabled, mode } = req.body as { enabled?: boolean; mode?: string };
    
    if (enabled !== undefined) {
      runtimeState.enabled = enabled;
    }
    
    if (mode && ['RULES_ONLY', 'LIGHT_ML', 'FULL_ML'].includes(mode)) {
      runtimeState.mode = mode as 'RULES_ONLY' | 'LIGHT_ML' | 'FULL_ML';
    }
    
    return reply.send({
      ok: true,
      data: {
        enabled: runtimeState.enabled,
        mode: runtimeState.mode,
      },
      message: `Twitter runtime updated: enabled=${runtimeState.enabled}, mode=${runtimeState.mode}`,
    });
  });

  // ============================================
  // POST /admin/sentiment/twitter/captcha
  // Report CAPTCHA detection
  // ============================================
  app.post('/api/v4/admin/sentiment/twitter/captcha', async (req: FastifyRequest, reply: FastifyReply) => {
    runtimeState.health.captchaCount++;
    runtimeState.health.consecutiveCaptchas++;
    
    if (runtimeState.health.consecutiveCaptchas >= VALIDATOR_CONFIG.captchaCriticalLimit) {
      runtimeState.health.status = 'CRITICAL';
      runtimeState.health.autoDisabled = true;
      runtimeState.health.reason = `${runtimeState.health.consecutiveCaptchas} consecutive CAPTCHAs`;
    } else {
      runtimeState.health.status = 'DEGRADED';
    }
    
    return reply.send({
      ok: true,
      data: runtimeState.health,
      message: `CAPTCHA recorded. Total: ${runtimeState.health.captchaCount}, Consecutive: ${runtimeState.health.consecutiveCaptchas}`,
    });
  });

  // ============================================
  // POST /admin/sentiment/twitter/success
  // Report successful parse
  // ============================================
  app.post('/api/v4/admin/sentiment/twitter/success', async (req: FastifyRequest, reply: FastifyReply) => {
    runtimeState.health.consecutiveCaptchas = 0;
    runtimeState.health.lastSuccessAt = new Date();
    runtimeState.health.avgPostsPerMinute++;
    
    if (runtimeState.health.autoDisabled) {
      runtimeState.health.autoDisabled = false;
      runtimeState.health.reason = undefined;
    }
    
    runtimeState.health.status = 'HEALTHY';
    
    return reply.send({
      ok: true,
      data: runtimeState.health,
    });
  });

  // ============================================
  // POST /admin/sentiment/twitter/reset
  // Reset health counters
  // ============================================
  app.post('/api/v4/admin/sentiment/twitter/reset', async (req: FastifyRequest, reply: FastifyReply) => {
    runtimeState.health = {
      status: 'OFFLINE',
      captchaCount: 0,
      consecutiveCaptchas: 0,
      lastSuccessAt: null,
      avgPostsPerMinute: 0,
      validPayloadRate: 1,
      autoDisabled: false,
    };
    
    runtimeState.stats = {
      totalValidated: 0,
      validCount: 0,
      degradedCount: 0,
      droppedCount: 0,
      lastValidatedAt: null,
    };
    
    runtimeState.dataQuality = {
      totalChecked: 0,
      completeCount: 0,
      partialCount: 0,
      invalidCount: 0,
      avgCompletenessScore: 0,
      missingFieldsFrequency: {},
      lastCheckedAt: null,
    };
    
    return reply.send({
      ok: true,
      message: 'Twitter runtime state reset',
      data: {
        health: runtimeState.health,
        stats: runtimeState.stats,
        dataQuality: runtimeState.dataQuality,
      },
    });
  });

  // ============================================================
  // Phase 10.9 — Data Quality Endpoints
  // ============================================================

  // ============================================
  // GET /admin/sentiment/twitter/contract
  // Get contract version info (LOCKED)
  // ============================================
  app.get('/api/v4/admin/sentiment/twitter/contract', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      data: {
        version: CONTRACT_VERSION,
        locked: CONTRACT_LOCKED,
        lockedAt: CONTRACT_LOCKED_AT,
        requiredFields: REQUIRED_FIELDS,
        minCompletenessScore: MIN_COMPLETENESS_SCORE,
      },
      message: CONTRACT_LOCKED 
        ? `Contract v${CONTRACT_VERSION} is LOCKED. Changes require new version.`
        : 'Contract is mutable.',
    });
  });

  // ============================================
  // GET /admin/sentiment/twitter/data-quality
  // Get data quality stats
  // ============================================
  app.get('/api/v4/admin/sentiment/twitter/data-quality', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      data: {
        ...runtimeState.dataQuality,
        completeRate: runtimeState.dataQuality.totalChecked > 0 
          ? Math.round((runtimeState.dataQuality.completeCount / runtimeState.dataQuality.totalChecked) * 100) / 100
          : 0,
        invalidRate: runtimeState.dataQuality.totalChecked > 0
          ? Math.round((runtimeState.dataQuality.invalidCount / runtimeState.dataQuality.totalChecked) * 100) / 100
          : 0,
      },
    });
  });

  // ============================================
  // POST /admin/sentiment/twitter/check-completeness
  // Check data completeness of a payload
  // ============================================
  app.post('/api/v4/admin/sentiment/twitter/check-completeness', async (req: FastifyRequest, reply: FastifyReply) => {
    const { payload } = req.body as { payload: any };
    
    if (!payload) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_PAYLOAD',
        message: 'Twitter payload required',
      });
    }
    
    const completeness = validateDataCompleteness(payload);
    const minimumViable = isMinimumViablePayload(payload);
    
    // Update data quality stats
    runtimeState.dataQuality.totalChecked++;
    runtimeState.dataQuality.lastCheckedAt = new Date();
    
    if (completeness.status === 'COMPLETE') {
      runtimeState.dataQuality.completeCount++;
    } else if (completeness.status === 'PARTIAL') {
      runtimeState.dataQuality.partialCount++;
    } else {
      runtimeState.dataQuality.invalidCount++;
    }
    
    // Track missing fields frequency
    for (const field of completeness.missing) {
      runtimeState.dataQuality.missingFieldsFrequency[field] = 
        (runtimeState.dataQuality.missingFieldsFrequency[field] || 0) + 1;
    }
    
    // Update average score
    const prevTotal = runtimeState.dataQuality.totalChecked - 1;
    const prevAvg = runtimeState.dataQuality.avgCompletenessScore;
    runtimeState.dataQuality.avgCompletenessScore = 
      (prevAvg * prevTotal + completeness.score) / runtimeState.dataQuality.totalChecked;
    
    return reply.send({
      ok: true,
      data: {
        completeness,
        minimumViable,
        canProcess: minimumViable.ok,
        canInfluence: completeness.status === 'COMPLETE',
        recommendation: !minimumViable.ok 
          ? 'DROP: ' + minimumViable.reason
          : completeness.status === 'INVALID'
            ? 'SKIP: Missing required fields'
            : completeness.status === 'PARTIAL'
              ? 'PROCESS: With reduced influence weight'
              : 'FULL: All fields present',
      },
    });
  });

  // ============================================
  // POST /admin/sentiment/twitter/check-batch
  // Check completeness for multiple payloads
  // ============================================
  app.post('/api/v4/admin/sentiment/twitter/check-batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const { payloads } = req.body as { payloads: any[] };
    
    if (!payloads || !Array.isArray(payloads)) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_PAYLOADS',
        message: 'Array of payloads required',
      });
    }
    
    const results = payloads.map((payload, index) => {
      const completeness = validateDataCompleteness(payload);
      const minimumViable = isMinimumViablePayload(payload);
      
      // Update stats
      runtimeState.dataQuality.totalChecked++;
      if (completeness.status === 'COMPLETE') runtimeState.dataQuality.completeCount++;
      else if (completeness.status === 'PARTIAL') runtimeState.dataQuality.partialCount++;
      else runtimeState.dataQuality.invalidCount++;
      
      for (const field of completeness.missing) {
        runtimeState.dataQuality.missingFieldsFrequency[field] = 
          (runtimeState.dataQuality.missingFieldsFrequency[field] || 0) + 1;
      }
      
      return {
        index,
        tweetId: payload?.post?.tweet_id || payload?.tweet_id || payload?.tweetId || payload?.id,
        completeness,
        minimumViable,
        canProcess: minimumViable.ok,
      };
    });
    
    runtimeState.dataQuality.lastCheckedAt = new Date();
    
    const summary = {
      total: results.length,
      complete: results.filter(r => r.completeness.status === 'COMPLETE').length,
      partial: results.filter(r => r.completeness.status === 'PARTIAL').length,
      invalid: results.filter(r => r.completeness.status === 'INVALID').length,
      canProcess: results.filter(r => r.canProcess).length,
    };
    
    return reply.send({
      ok: true,
      data: {
        summary,
        results,
        topMissingFields: Object.entries(runtimeState.dataQuality.missingFieldsFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([field, count]) => ({ field, count })),
      },
    });
  });
}

export default registerTwitterRuntimeRoutes;
