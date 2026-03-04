/**
 * S10.5 — Pattern API Routes (User-facing)
 * S10.6I.7 — Extended with Indicator-driven detection
 * 
 * Read-only endpoints for pattern detection.
 * NO signals, NO predictions — only explanation.
 */

import { FastifyInstance } from 'fastify';
import * as patternService from './pattern.service.js';
import { PATTERN_LIBRARY, CATEGORY_CONFIG } from './pattern.library.js';
import { detectIndicatorPatterns, clearPatternHistory } from './pattern.indicator-detector.js';
import { getIndicatorSnapshot } from '../indicators/indicator.service.js';
import { detectRegimeFromIndicators } from '../regimes/regime.service.js';

export async function patternRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/patterns — All pattern states (LEGACY)
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/patterns', async () => {
    const states = patternService.getAllPatternStates();
    
    return {
      ok: true,
      count: states.length,
      data: states.map(s => ({
        symbol: s.symbol,
        patternCount: s.patterns.length,
        hasConflict: s.hasConflict,
        bullishCount: s.bullishCount,
        bearishCount: s.bearishCount,
        neutralCount: s.neutralCount,
        patterns: s.patterns.map(p => ({
          name: p.name,
          category: p.category,
          direction: p.direction,
          strength: p.strength,
          confidence: p.confidence,
        })),
        lastUpdated: s.lastUpdated,
      })),
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/patterns/:symbol — Patterns for symbol (LEGACY)
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/patterns/:symbol',
    async (request) => {
      const { symbol } = request.params;
      
      // Generate mock input and detect patterns
      const input = patternService.generateMockPatternInput(symbol.toUpperCase());
      const state = patternService.updatePatterns(input);
      
      return {
        ok: true,
        symbol: state.symbol,
        patternCount: state.patterns.length,
        hasConflict: state.hasConflict,
        summary: {
          bullish: state.bullishCount,
          bearish: state.bearishCount,
          neutral: state.neutralCount,
        },
        patterns: state.patterns.map(p => ({
          id: p.id,
          name: p.name,
          category: p.category,
          categoryLabel: CATEGORY_CONFIG[p.category]?.label,
          categoryIcon: CATEGORY_CONFIG[p.category]?.icon,
          direction: p.direction,
          strength: p.strength,
          confidence: p.confidence,
          conditions: p.conditions,
          metrics: p.metrics,
          timeframe: p.timeframe,
          detectedAt: p.detectedAt,
        })),
        lastUpdated: state.lastUpdated,
        detectionDurationMs: state.detectionDurationMs,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // S10.6I.7 — GET /api/v10/exchange/patterns/:symbol/indicator-driven
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/patterns/:symbol/indicator-driven',
    async (request) => {
      const { symbol } = request.params;
      const symbolUpper = symbol.toUpperCase();
      
      // Get indicators
      const snapshot = getIndicatorSnapshot(symbolUpper);
      const indicatorMap: Record<string, any> = {};
      for (const ind of snapshot.indicators) {
        indicatorMap[ind.id] = {
          value: ind.value,
          category: ind.category,
          normalized: ind.normalized,
        };
      }
      
      // Get current regime
      const regimeResult = detectRegimeFromIndicators(symbolUpper, indicatorMap);
      
      // Detect patterns
      const result = detectIndicatorPatterns(symbolUpper, indicatorMap, regimeResult.regime);
      
      return {
        ok: true,
        symbol: symbolUpper,
        patternCount: result.patterns.length,
        patterns: result.patterns,
        aggregates: result.aggregates,
        currentRegime: regimeResult.regime,
        indicatorCount: result.indicatorCount,
        timestamp: result.timestamp,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // S10.6I.7 — GET /api/v10/exchange/patterns/:symbol/dual — Both methods
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/patterns/:symbol/dual',
    async (request) => {
      const { symbol } = request.params;
      const symbolUpper = symbol.toUpperCase();
      
      // Legacy patterns
      const legacyInput = patternService.generateMockPatternInput(symbolUpper);
      const legacyState = patternService.updatePatterns(legacyInput);
      
      // Indicator-driven patterns
      const snapshot = getIndicatorSnapshot(symbolUpper);
      const indicatorMap: Record<string, any> = {};
      for (const ind of snapshot.indicators) {
        indicatorMap[ind.id] = {
          value: ind.value,
          category: ind.category,
          normalized: ind.normalized,
        };
      }
      
      const regimeResult = detectRegimeFromIndicators(symbolUpper, indicatorMap);
      const indicatorResult = detectIndicatorPatterns(symbolUpper, indicatorMap, regimeResult.regime);
      
      // Compute diff
      const legacyNames = new Set(legacyState.patterns.map(p => p.name));
      const indicatorNames = new Set(indicatorResult.patterns.map(p => p.name));
      
      const onlyLegacy = legacyState.patterns.filter(p => !indicatorNames.has(p.name)).map(p => p.name);
      const onlyIndicator = indicatorResult.patterns.filter(p => !legacyNames.has(p.name)).map(p => p.name);
      const both = legacyState.patterns.filter(p => indicatorNames.has(p.name)).map(p => p.name);
      
      return {
        ok: true,
        symbol: symbolUpper,
        legacy: {
          count: legacyState.patterns.length,
          patterns: legacyState.patterns.map(p => ({
            name: p.name,
            category: p.category,
            direction: p.direction,
            confidence: p.confidence,
          })),
        },
        indicatorDriven: {
          count: indicatorResult.patterns.length,
          patterns: indicatorResult.patterns.map(p => ({
            name: p.name,
            category: p.category,
            direction: p.direction,
            confidence: p.confidence,
            stability: p.stability,
            drivers: p.drivers,
          })),
        },
        diff: {
          onlyLegacy,
          onlyIndicator,
          both,
          agreement: both.length / Math.max(1, legacyState.patterns.length + indicatorResult.patterns.length - both.length),
        },
        currentRegime: regimeResult.regime,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/patterns/active — All active patterns
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/patterns/active', async () => {
    const patterns = patternService.getActivePatterns();
    
    // Group by symbol
    const bySymbol: Record<string, typeof patterns> = {};
    for (const p of patterns) {
      if (!bySymbol[p.symbol]) bySymbol[p.symbol] = [];
      bySymbol[p.symbol].push(p);
    }
    
    return {
      ok: true,
      totalCount: patterns.length,
      symbolCount: Object.keys(bySymbol).length,
      bySymbol: Object.entries(bySymbol).map(([symbol, patterns]) => ({
        symbol,
        count: patterns.length,
        patterns: patterns.map(p => ({
          name: p.name,
          category: p.category,
          direction: p.direction,
          strength: p.strength,
          confidence: p.confidence,
        })),
      })),
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/patterns/history/:symbol — Pattern history
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/v10/exchange/patterns/history/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const limit = parseInt(request.query.limit || '20');
      
      const history = patternService.getPatternHistory(symbol, limit);
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        count: history.length,
        data: history,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/patterns/library — Pattern definitions
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/patterns/library', async () => {
    const stats = patternService.getLibraryStats();
    
    return {
      ok: true,
      ...stats,
      categories: CATEGORY_CONFIG,
    };
  });

  console.log('[S10.5] Pattern API routes registered: /api/v10/exchange/patterns/* (S10.6I.7 enabled)');
}

export default patternRoutes;
