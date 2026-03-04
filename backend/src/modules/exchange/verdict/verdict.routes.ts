/**
 * B4 — Verdict Routes
 * 
 * API endpoints for Exchange Verdict.
 */

import { FastifyPluginAsync } from 'fastify';
import { buildMarketContext } from '../context/context.builder.js';
import { buildExchangeVerdict } from './verdict.engine.js';
import { getDb } from '../../../db/mongodb.js';

const COLLECTION_NAME = 'exchange_verdicts';

async function saveVerdict(verdict: any): Promise<void> {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);
  await collection.updateOne(
    { symbol: verdict.symbol },
    { $set: verdict },
    { upsert: true }
  );
}

async function getVerdict(symbol: string): Promise<any | null> {
  const db = getDb();
  const collection = db.collection(COLLECTION_NAME);
  return collection.findOne({ symbol });
}

export const verdictRoutes: FastifyPluginAsync = async (fastify) => {
  // ─────────────────────────────────────────────────────────────
  // GET /verdict/:symbol — Get verdict for symbol
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
    Querystring: { rebuild?: string };
  }>('/verdict/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol.toUpperCase();
      const rebuild = request.query.rebuild === 'true';
      
      let verdict;
      
      if (rebuild) {
        const context = await buildMarketContext(symbol);
        verdict = buildExchangeVerdict(context);
        await saveVerdict(verdict);
      } else {
        verdict = await getVerdict(symbol);
        if (!verdict) {
          // Build if not cached
          const context = await buildMarketContext(symbol);
          verdict = buildExchangeVerdict(context);
          await saveVerdict(verdict);
        }
      }
      
      // Remove debug info for public endpoint
      const { debug, ...publicVerdict } = verdict;
      
      return { ok: true, verdict: publicVerdict };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get verdict',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /verdict/:symbol/debug — Get verdict with debug info
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
  }>('/verdict/:symbol/debug', async (request, reply) => {
    try {
      const symbol = request.params.symbol.toUpperCase();
      
      const context = await buildMarketContext(symbol);
      const verdict = buildExchangeVerdict(context);
      await saveVerdict(verdict);
      
      return { ok: true, verdict, context };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get verdict debug',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /verdicts — Get verdicts for multiple symbols
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Querystring: { symbols?: string };
  }>('/verdicts', async (request, reply) => {
    try {
      const symbolsParam = String(request.query.symbols ?? '');
      const symbols = symbolsParam
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 50);
      
      if (symbols.length === 0) {
        return reply.status(400).send({
          ok: false,
          error: 'symbols_required',
          hint: 'Use ?symbols=BTCUSDT,ETHUSDT',
        });
      }
      
      const results = [];
      for (const symbol of symbols) {
        try {
          const context = await buildMarketContext(symbol);
          const verdict = buildExchangeVerdict(context);
          await saveVerdict(verdict);
          
          const { debug, ...publicVerdict } = verdict;
          results.push(publicVerdict);
        } catch (e: any) {
          results.push({
            symbol,
            error: e.message,
          });
        }
      }
      
      return { ok: true, count: results.length, verdicts: results };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get verdicts',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /verdict/health — Verdict system health
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/verdict/health', async (request, reply) => {
    try {
      const db = getDb();
      const collection = db.collection(COLLECTION_NAME);
      
      const count = await collection.countDocuments();
      const bullish = await collection.countDocuments({ verdict: 'BULLISH' });
      const bearish = await collection.countDocuments({ verdict: 'BEARISH' });
      const neutral = await collection.countDocuments({ verdict: 'NEUTRAL' });
      
      const latest = await collection.findOne({}, { sort: { updatedAt: -1 } });
      
      return {
        ok: true,
        verdictCount: count,
        distribution: { bullish, bearish, neutral },
        lastUpdate: latest?.updatedAt ?? null,
      };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get verdict health',
        message: error.message,
      });
    }
  });
};

console.log('[B4] Verdict Routes loaded');
