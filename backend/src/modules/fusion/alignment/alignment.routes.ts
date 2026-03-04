/**
 * C1 — Alignment Routes
 * 
 * API endpoints for Exchange × Sentiment Alignment.
 */

import { FastifyPluginAsync } from 'fastify';
import { alignmentService, AlignmentService } from './alignment.service.js';
import { summarizeAlignments, getDistribution, generateInsights } from './alignment.diagnostics.js';
import {
  AlignmentResult,
  ExchangeLayerInput,
  SentimentLayerInput,
  AlignmentBatchItem,
} from './alignment.contracts.js';
import { buildMarketContext } from '../../exchange/context/context.builder.js';
import { buildExchangeVerdict } from '../../exchange/verdict/verdict.engine.js';
import { getDb } from '../../../db/mongodb.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS: Get Exchange Input
// ═══════════════════════════════════════════════════════════════

async function getExchangeInput(symbol: string): Promise<ExchangeLayerInput> {
  try {
    const context = await buildMarketContext(symbol);
    const verdict = buildExchangeVerdict(context);
    
    return {
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      readiness: context.readiness.status as 'READY' | 'DEGRADED' | 'NO_DATA',
      reasons: verdict.reasons.blockers,
      drivers: [
        ...verdict.reasons.bullish,
        ...verdict.reasons.bearish,
      ],
    };
  } catch (e) {
    return {
      verdict: 'NEUTRAL',
      confidence: 0,
      readiness: 'NO_DATA',
      reasons: ['exchange_error'],
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS: Get Sentiment Input
// ═══════════════════════════════════════════════════════════════

async function getSentimentInput(symbol: string): Promise<SentimentLayerInput> {
  try {
    // Try to get sentiment from observations or sentiment module
    const db = getDb();
    
    // First try twitter_observations
    const twitterObs = await db.collection('twitter_observations').findOne(
      {},
      { sort: { timestamp: -1 } }
    );
    
    if (twitterObs?.sentiment) {
      const sent = twitterObs.sentiment;
      return {
        verdict: sent.marketBias === 'bullish' ? 'BULLISH' :
                sent.marketBias === 'bearish' ? 'BEARISH' : 'NEUTRAL',
        confidence: sent.confidence ?? 0.5,
        usable: sent.confidence >= 0.35,
        reasons: sent.drivers ?? [],
        drivers: sent.keyTopics ?? [],
        keywords: sent.keywords ?? [],
        source: 'twitter',
      };
    }
    
    // Fallback: mock sentiment for demo
    return {
      verdict: 'NEUTRAL',
      confidence: 0.4,
      usable: true,
      reasons: ['mock_sentiment'],
      source: 'mock',
    };
  } catch (e) {
    return {
      verdict: 'NEUTRAL',
      confidence: 0,
      usable: false,
      reasons: ['sentiment_error'],
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export const alignmentRoutes: FastifyPluginAsync = async (fastify) => {
  // ─────────────────────────────────────────────────────────────
  // GET /alignment/:symbol — Compute alignment for symbol
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
  }>('/alignment/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol.toUpperCase();
      const t0 = new Date().toISOString();
      
      // Get inputs from both layers
      const [exchange, sentiment] = await Promise.all([
        getExchangeInput(symbol),
        getSentimentInput(symbol),
      ]);
      
      // Compute alignment
      const result = alignmentService.compute(symbol, t0, exchange, sentiment);
      
      return { ok: true, alignment: result };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to compute alignment',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /alignment/compute — Compute with provided inputs
  // ─────────────────────────────────────────────────────────────
  
  fastify.post<{
    Body: {
      symbol: string;
      t0?: string;
      exchange: ExchangeLayerInput;
      sentiment: SentimentLayerInput;
    };
  }>('/alignment/compute', async (request, reply) => {
    try {
      const { symbol, t0, exchange, sentiment } = request.body;
      
      const result = alignmentService.compute(
        symbol.toUpperCase(),
        t0 ?? new Date().toISOString(),
        exchange,
        sentiment
      );
      
      return { ok: true, alignment: result };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to compute alignment',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /alignments — Compute for multiple symbols
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Querystring: { symbols?: string };
  }>('/alignments', async (request, reply) => {
    try {
      const symbolsParam = String(request.query.symbols ?? '');
      const symbols = symbolsParam
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 20);
      
      if (symbols.length === 0) {
        return reply.status(400).send({
          ok: false,
          error: 'symbols_required',
          hint: 'Use ?symbols=BTCUSDT,ETHUSDT',
        });
      }
      
      const t0 = new Date().toISOString();
      const results: AlignmentResult[] = [];
      
      for (const symbol of symbols) {
        try {
          const [exchange, sentiment] = await Promise.all([
            getExchangeInput(symbol),
            getSentimentInput(symbol),
          ]);
          
          const result = alignmentService.compute(symbol, t0, exchange, sentiment);
          results.push(result);
        } catch (e: any) {
          // Skip failed symbols
          console.warn(`[Alignment] Failed for ${symbol}:`, e.message);
        }
      }
      
      return { ok: true, count: results.length, alignments: results };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to compute alignments',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /alignment/batch — Batch compute with provided inputs
  // ─────────────────────────────────────────────────────────────
  
  fastify.post<{
    Body: { items: AlignmentBatchItem[] };
  }>('/alignment/batch', async (request, reply) => {
    try {
      const items = request.body.items?.slice(0, 100) ?? [];
      
      const results = items.map(item =>
        alignmentService.compute(
          item.symbol.toUpperCase(),
          item.t0 ?? new Date().toISOString(),
          item.exchange,
          item.sentiment
        )
      );
      
      return { ok: true, total: results.length, results };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to batch compute',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /alignment/diagnostics — Summary statistics
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Querystring: { symbols?: string };
  }>('/alignment/diagnostics', async (request, reply) => {
    try {
      const symbolsParam = String(request.query.symbols ?? 'BTCUSDT,ETHUSDT,SOLUSDT');
      const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      
      const t0 = new Date().toISOString();
      const results: AlignmentResult[] = [];
      
      for (const symbol of symbols) {
        try {
          const [exchange, sentiment] = await Promise.all([
            getExchangeInput(symbol),
            getSentimentInput(symbol),
          ]);
          
          results.push(alignmentService.compute(symbol, t0, exchange, sentiment));
        } catch (e) {
          // Skip
        }
      }
      
      const diagnostics = summarizeAlignments(results);
      const distribution = getDistribution(results);
      const insights = generateInsights(diagnostics);
      
      return {
        ok: true,
        diagnostics,
        distribution,
        insights,
        symbols: symbols.length,
      };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get diagnostics',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /alignment/config — Get current config
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/alignment/config', async (request, reply) => {
    return { ok: true, config: alignmentService.getConfig() };
  });
};

console.log('[C1] Alignment Routes loaded');
