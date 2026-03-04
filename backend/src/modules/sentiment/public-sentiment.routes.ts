/**
 * Public Sentiment API
 * ====================
 * 
 * Standalone public endpoint for sentiment analysis.
 * 
 * NO dependencies on:
 * - Admin
 * - Price Layer
 * - Observation Model
 * - Meta-Brain
 * - Twitter
 * 
 * This is a PRODUCT INTERFACE for external use.
 * 
 * Routes:
 * - POST /api/public/sentiment/analyze — Single text analysis
 * - POST /api/public/sentiment/batch — Batch analysis
 * - GET  /api/public/sentiment/health — Health check
 * - GET  /api/public/sentiment/version — Version info
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Import SentimentCore directly (standalone)
// Using direct path to compiled sentiment-core
import { 
  analyzeText, 
  analyzeTextBatch, 
  getVersionInfo, 
  getConfig,
  type SentimentResult 
} from '../../../../sentiment-core/dist/index.js';

// ============================================================
// TYPES
// ============================================================

interface AnalyzeRequest {
  text: string;
}

interface BatchRequest {
  texts: string[];
}

// ============================================================
// PUBLIC API RESPONSE FORMAT (LOCKED)
// ============================================================

interface PublicSentimentResponse {
  label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  confidence: number;
  reasons: string[];
  engine: string;
}

function toPublicResponse(result: SentimentResult): PublicSentimentResponse {
  return {
    label: result.label,
    confidence: result.confidence,
    reasons: result.reasons,
    engine: `sentiment-v${result.engine.version}`,
  };
}

// ============================================================
// ROUTES
// ============================================================

export function registerPublicSentimentRoutes(app: FastifyInstance) {
  
  // Health check
  app.get('/api/public/sentiment/health', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      status: 'READY',
      engine: `sentiment-v${getVersionInfo().engine}`,
      timestamp: new Date().toISOString(),
    });
  });
  
  // Version info
  app.get('/api/public/sentiment/version', async (req: FastifyRequest, reply: FastifyReply) => {
    const version = getVersionInfo();
    return reply.send({
      ok: true,
      data: {
        version: version.engine,
        ruleset: version.ruleset,
        frozen: version.frozen,
        core: version.core,
      },
    });
  });
  
  // Single text analysis (MAIN ENDPOINT)
  app.post('/api/public/sentiment/analyze', async (
    req: FastifyRequest<{ Body: AnalyzeRequest }>, 
    reply: FastifyReply
  ) => {
    const { text } = req.body;
    
    // Validation
    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'Text is required and must be a string',
      });
    }
    
    if (text.length > 10000) {
      return reply.status(400).send({
        ok: false,
        error: 'TEXT_TOO_LONG',
        message: 'Text must be under 10000 characters',
      });
    }
    
    if (text.trim().length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'EMPTY_TEXT',
        message: 'Text cannot be empty',
      });
    }
    
    try {
      // Analyze using SentimentCore (standalone)
      const result = analyzeText(text);
      
      return reply.send({
        ok: true,
        data: toPublicResponse(result),
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ANALYSIS_ERROR',
        message: error.message || 'Analysis failed',
      });
    }
  });
  
  // Batch analysis
  app.post('/api/public/sentiment/batch', async (
    req: FastifyRequest<{ Body: BatchRequest }>, 
    reply: FastifyReply
  ) => {
    const { texts } = req.body;
    
    // Validation
    if (!texts || !Array.isArray(texts)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'Texts array is required',
      });
    }
    
    if (texts.length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'EMPTY_BATCH',
        message: 'Texts array cannot be empty',
      });
    }
    
    if (texts.length > 50) {
      return reply.status(400).send({
        ok: false,
        error: 'BATCH_TOO_LARGE',
        message: 'Maximum 50 texts per batch',
      });
    }
    
    // Validate each text
    for (let i = 0; i < texts.length; i++) {
      if (typeof texts[i] !== 'string') {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_TEXT',
          message: `Text at index ${i} must be a string`,
        });
      }
      if (texts[i].length > 10000) {
        return reply.status(400).send({
          ok: false,
          error: 'TEXT_TOO_LONG',
          message: `Text at index ${i} exceeds 10000 characters`,
        });
      }
    }
    
    try {
      // Analyze batch using SentimentCore
      const results = analyzeTextBatch(texts);
      
      return reply.send({
        ok: true,
        data: {
          results: results.map(toPublicResponse),
          meta: {
            total: texts.length,
            engine: `sentiment-v${getVersionInfo().engine}`,
          },
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ANALYSIS_ERROR',
        message: error.message || 'Batch analysis failed',
      });
    }
  });
  
  // Full analysis (with detailed breakdown)
  app.post('/api/public/sentiment/analyze-full', async (
    req: FastifyRequest<{ Body: AnalyzeRequest }>, 
    reply: FastifyReply
  ) => {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_INPUT',
        message: 'Text is required',
      });
    }
    
    if (text.length > 10000) {
      return reply.status(400).send({
        ok: false,
        error: 'TEXT_TOO_LONG',
        message: 'Text must be under 10000 characters',
      });
    }
    
    try {
      // Return full SentimentResult (for debugging/integration)
      const result = analyzeText(text);
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'ANALYSIS_ERROR',
        message: error.message || 'Analysis failed',
      });
    }
  });
  
  console.log('[PublicSentiment] Routes registered: /api/public/sentiment/*');
}
