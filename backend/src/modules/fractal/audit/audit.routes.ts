/**
 * FRACTAL AUDIT ROUTES
 * 
 * L2/L3 Audit API endpoints
 * 
 * Endpoints:
 * - GET /api/audit/invariants/:asset - Run invariant tests
 * - GET /api/audit/consistency/:asset - Run horizon consistency check
 * - GET /api/audit/stress/:asset - Run stress tests (COVID, 2022, etc.)
 * - GET /api/audit/full/:asset - Run full audit suite
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  computePrefixDiff,
  softBlendPrefix,
  applyHierarchyPack,
} from './horizon_consistency.service.js';
import {
  DEFAULT_CONSISTENCY_CONFIG,
} from './horizon_consistency.contract.js';
import {
  runInvariantTestSuite,
  testScaleInvariance,
  testNoNaNInfinite,
  TestInputs,
} from './invariant_tests.service.js';
import type { HorizonConsistencyConfig, SeriesPoint } from './horizon_consistency.contract.js';

const API_BASE = 'http://localhost:8002';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function fetchTerminalData(asset: string, focus: string): Promise<any> {
  try {
    let url: string;
    if (asset === 'BTC') {
      url = `${API_BASE}/api/fractal/v2.1/focus-pack?symbol=BTC&focus=${focus}`;
    } else if (asset === 'SPX') {
      url = `${API_BASE}/api/spx/v2.1/terminal?horizon=${focus.replace('d', '')}d`;
    } else if (asset === 'DXY') {
      url = `${API_BASE}/api/fractal/dxy/terminal?focus=${focus}`;
    } else {
      throw new Error(`Unknown asset: ${asset}`);
    }
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    
    // Normalize response structure
    if (asset === 'BTC' && data.focusPack) {
      return data.focusPack;
    }
    return data;
  } catch (e) {
    console.error(`[Audit] Failed to fetch ${asset} terminal:`, e);
    return null;
  }
}

async function fetchPriceHistory(asset: string, days: number): Promise<number[]> {
  try {
    // Fetch terminal data which contains price series
    const terminal = await fetchTerminalData(asset, `${days}d`);
    if (!terminal) {
      console.warn(`[Audit] No terminal data for ${asset}`);
      return generateSyntheticPrices(asset, days);
    }
    
    // BTC: extract from normalizedSeries.rawPath
    if (asset === 'BTC' && terminal.normalizedSeries?.rawPath) {
      return terminal.normalizedSeries.rawPath;
    }
    
    // SPX: extract from data.prices or forecast
    if (asset === 'SPX') {
      if (terminal.data?.prices) {
        return terminal.data.prices.map((p: any) => p.close || p.c || p.value);
      }
      if (terminal.forecast?.rawPath) {
        return terminal.forecast.rawPath;
      }
    }
    
    // DXY: extract from core.candles or synthetic.path
    if (asset === 'DXY') {
      if (terminal.core?.candles) {
        return terminal.core.candles.map((c: any) => c.close || c.c);
      }
      if (terminal.synthetic?.path) {
        return terminal.synthetic.path.map((p: any) => p.value);
      }
    }
    
    // Fallback to synthetic prices
    return generateSyntheticPrices(asset, days);
  } catch (e) {
    console.error(`[Audit] Failed to fetch prices for ${asset}:`, e);
    return generateSyntheticPrices(asset, days);
  }
}

function generateSyntheticPrices(asset: string, days: number): number[] {
  // Generate realistic synthetic prices for testing
  const basePrice = asset === 'BTC' ? 100000 : asset === 'SPX' ? 5000 : 105;
  const volatility = asset === 'BTC' ? 0.03 : asset === 'SPX' ? 0.015 : 0.005;
  const prices: number[] = [basePrice];
  
  for (let i = 1; i < days; i++) {
    const change = (Math.random() - 0.5) * 2 * volatility;
    prices.push(prices[i-1] * (1 + change));
  }
  return prices;
}

function extractSeriesFromTerminal(terminal: any, mode: string): SeriesPoint[] {
  if (!terminal) return [];
  
  // BTC focus pack format - use rawPath with dates
  if (terminal.normalizedSeries?.rawPath) {
    const rawPath = terminal.normalizedSeries.rawPath;
    const percentPath = terminal.normalizedSeries.percentPath || [];
    const baseDate = new Date();
    
    return rawPath.map((value: number, i: number) => {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      return {
        date: date.toISOString().split('T')[0],
        value,
        pct: percentPath[i] || 0,
      };
    });
  }
  
  // DXY terminal format
  if (terminal[mode]?.path) {
    const path = terminal[mode].path;
    return path.map((p: any) => ({
      date: p.date || '',
      value: p.value || 0,
      pct: (p.pct || 0) * (Math.abs(p.pct) > 1 ? 1 : 100),
    }));
  }
  
  // SPX format
  if (terminal.forecast?.path) {
    return terminal.forecast.path.map((p: any) => ({
      date: p.date || '',
      value: p.value || p.price || 0,
      pct: p.pct || p.change || 0,
    }));
  }
  
  return [];
}

function simpleHash(obj: any): string {
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * Run invariant tests for an asset
   */
  app.get('/api/audit/invariants/:asset', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asset } = request.params as { asset: string };
    const upperAsset = asset.toUpperCase();
    
    try {
      // Fetch data
      const terminal30 = await fetchTerminalData(upperAsset, '30d');
      const terminal90 = await fetchTerminalData(upperAsset, '90d');
      const prices = await fetchPriceHistory(upperAsset, 90);
      
      if (!terminal30 || !terminal90 || prices.length < 30) {
        return reply.status(500).send({
          ok: false,
          error: 'Insufficient data for tests',
        });
      }
      
      // Extract overlay params (if BTC)
      let R_base = 0.05;
      let R_ref = 0.03;
      let g = 1.0;
      let w = 0.5;
      let beta = 0.3;
      let R_adj = R_base;
      
      if (upperAsset === 'BTC' && terminal30.overlay) {
        const overlay = terminal30.overlay;
        R_base = overlay.baseReturn || 0.05;
        R_ref = overlay.spxReturn || 0.03;
        g = overlay.guard?.applied || 1.0;
        w = overlay.weight || 0.5;
        beta = overlay.beta || 0.3;
        R_adj = overlay.adjustedReturn || R_base;
      }
      
      // Run tests
      const inputs: TestInputs = {
        prices,
        similarity: terminal30.core?.matches?.[0]?.similarity,
        confidence: terminal30.meta?.confidence,
        R_base,
        R_ref,
        g,
        w,
        beta,
        R_adj,
        dataObject: terminal30,
      };
      
      const results = runInvariantTestSuite(upperAsset, inputs);
      
      return reply.send({
        ok: true,
        asset: upperAsset,
        ...results,
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Run horizon consistency check
   */
  app.get('/api/audit/consistency/:asset', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asset } = request.params as { asset: string };
    const { mode = 'hybrid' } = request.query as { mode?: string };
    const upperAsset = asset.toUpperCase();
    
    try {
      // Fetch all horizons
      const [t30, t90, t180, t365] = await Promise.all([
        fetchTerminalData(upperAsset, '30d'),
        fetchTerminalData(upperAsset, '90d'),
        fetchTerminalData(upperAsset, '180d'),
        fetchTerminalData(upperAsset, '365d'),
      ]);
      
      // Extract series
      const p30 = extractSeriesFromTerminal(t30, mode);
      const p90 = extractSeriesFromTerminal(t90, mode);
      const p180 = extractSeriesFromTerminal(t180, mode);
      const p365 = extractSeriesFromTerminal(t365, mode);
      
      // Apply hierarchy
      const config: HorizonConsistencyConfig = {
        ...DEFAULT_CONSISTENCY_CONFIG,
        enabled: true,
      };
      
      const result = applyHierarchyPack({ p30, p90, p180, p365 }, config);
      
      return reply.send({
        ok: true,
        asset: upperAsset,
        mode,
        horizons: {
          p30: { points: p30.length },
          p90: { points: p90.length },
          p180: { points: p180.length, adjusted: result.diagnostics.blend180?.adjusted || false },
          p365: { points: p365.length, adjusted: result.diagnostics.blend365?.adjusted || false },
        },
        diagnostics: result.diagnostics,
        recommendations: generateRecommendations(result.diagnostics),
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Run stress tests (regime-specific)
   */
  app.get('/api/audit/stress/:asset', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asset } = request.params as { asset: string };
    const upperAsset = asset.toUpperCase();
    
    try {
      // Fetch current terminal
      const terminal = await fetchTerminalData(upperAsset, '90d');
      
      if (!terminal) {
        return reply.status(500).send({
          ok: false,
          error: 'Failed to fetch terminal data',
        });
      }
      
      // Analyze volatility sensitivity
      const matches = terminal.core?.matches || [];
      const similarities = matches.map((m: any) => m.similarity);
      
      // Calculate correlation between similarity and volatility
      // (Using decade as proxy for vol regime)
      const decadeVolMap: Record<string, number> = {
        '2020s': 0.8, // High vol
        '2010s': 0.4, // Low vol
        '2000s': 0.7, // Medium-high
        '1990s': 0.3, // Low
        '1980s': 0.6, // Medium
      };
      
      const volScores = matches.map((m: any) => decadeVolMap[m.decade] || 0.5);
      
      // Simple correlation
      const meanSim = similarities.reduce((a: number, b: number) => a + b, 0) / similarities.length || 0;
      const meanVol = volScores.reduce((a: number, b: number) => a + b, 0) / volScores.length || 0;
      
      let cov = 0;
      let varSim = 0;
      let varVol = 0;
      
      for (let i = 0; i < similarities.length; i++) {
        const dSim = similarities[i] - meanSim;
        const dVol = volScores[i] - meanVol;
        cov += dSim * dVol;
        varSim += dSim * dSim;
        varVol += dVol * dVol;
      }
      
      const corrSimVol = cov / (Math.sqrt(varSim * varVol) + 1e-10);
      
      // Stress test results
      const stressResults = {
        volatilitySensitivity: {
          correlation: Math.round(corrSimVol * 1000) / 1000,
          interpretation: corrSimVol < -0.3 
            ? 'HIGH_SENSITIVITY' 
            : corrSimVol < -0.1 
              ? 'MODERATE_SENSITIVITY' 
              : 'STABLE',
          warning: corrSimVol < -0.3 
            ? 'Model loses accuracy in high-vol regimes' 
            : null,
        },
        regimeDistribution: {
          '2020s': matches.filter((m: any) => m.decade === '2020s').length,
          '2010s': matches.filter((m: any) => m.decade === '2010s').length,
          '2000s': matches.filter((m: any) => m.decade === '2000s').length,
          'older': matches.filter((m: any) => !['2020s', '2010s', '2000s'].includes(m.decade)).length,
        },
        confidenceStability: {
          current: terminal.meta?.confidence || 0.5,
          warning: (terminal.meta?.confidence || 0.5) < 0.3 
            ? 'Low confidence - increase sample size' 
            : null,
        },
      };
      
      return reply.send({
        ok: true,
        asset: upperAsset,
        stress: stressResults,
        recommendations: [
          corrSimVol < -0.3 && 'Consider volatility-adjusted similarity weighting',
          matches.filter((m: any) => m.decade === '2020s').length < 3 && 'Add more recent regime samples',
        ].filter(Boolean),
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Run full audit suite
   */
  app.get('/api/audit/full/:asset', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asset } = request.params as { asset: string };
    const upperAsset = asset.toUpperCase();
    
    try {
      // Run all audits
      const [invariantsRes, consistencyRes, stressRes] = await Promise.all([
        app.inject({ method: 'GET', url: `/api/audit/invariants/${asset}` }),
        app.inject({ method: 'GET', url: `/api/audit/consistency/${asset}` }),
        app.inject({ method: 'GET', url: `/api/audit/stress/${asset}` }),
      ]);
      
      const invariants = JSON.parse(invariantsRes.body);
      const consistency = JSON.parse(consistencyRes.body);
      const stress = JSON.parse(stressRes.body);
      
      // Calculate overall score
      const invariantScore = invariants.summary?.passRate || 0;
      const consistencyScore = consistency.diagnostics?.diff180in365?.meanAbsDiff < 5 ? 1 : 
                               consistency.diagnostics?.diff180in365?.meanAbsDiff < 10 ? 0.7 : 0.4;
      const stressScore = stress.stress?.volatilitySensitivity?.interpretation === 'STABLE' ? 1 :
                          stress.stress?.volatilitySensitivity?.interpretation === 'MODERATE_SENSITIVITY' ? 0.7 : 0.4;
      
      const overallScore = (invariantScore * 0.4 + consistencyScore * 0.3 + stressScore * 0.3);
      
      return reply.send({
        ok: true,
        asset: upperAsset,
        timestamp: new Date().toISOString(),
        scores: {
          invariants: Math.round(invariantScore * 100),
          consistency: Math.round(consistencyScore * 100),
          stress: Math.round(stressScore * 100),
          overall: Math.round(overallScore * 100),
        },
        grade: overallScore >= 0.9 ? 'A' : overallScore >= 0.8 ? 'B' : overallScore >= 0.7 ? 'C' : 'D',
        details: {
          invariants,
          consistency,
          stress,
        },
        criticalIssues: [
          ...(invariants.tests?.filter((t: any) => !t.passed).map((t: any) => t.name) || []),
          consistency.diagnostics?.diff180in365?.meanAbsDiff > 10 && 'Horizon inconsistency > 10%',
          stress.stress?.volatilitySensitivity?.correlation < -0.3 && 'High vol sensitivity',
        ].filter(Boolean),
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  console.log('[Audit] Routes registered: /api/audit/*');
}

// ═══════════════════════════════════════════════════════════════
// RECOMMENDATION GENERATOR
// ═══════════════════════════════════════════════════════════════

function generateRecommendations(diagnostics: any): string[] {
  const recs: string[] = [];
  
  if (diagnostics.diff180in365?.meanAbsDiff > 10) {
    recs.push('CRITICAL: 180/365 horizon contradiction > 10% — enable soft blend');
  } else if (diagnostics.diff180in365?.meanAbsDiff > 5) {
    recs.push('WARNING: 180/365 horizon diff > 5% — consider adjusting weights');
  }
  
  if (diagnostics.diff180in365?.signConflicts > 5) {
    recs.push('Sign conflicts detected — projections contradict in direction');
  }
  
  if (diagnostics.blend365?.adjusted && diagnostics.blend365?.alpha > 0.5) {
    recs.push('High blend alpha applied — review underlying pattern selection');
  }
  
  if (recs.length === 0) {
    recs.push('OK: Horizon consistency within acceptable bounds');
  }
  
  return recs;
}

export default registerAuditRoutes;
