/**
 * MACRO SCORE V3 — ROUTES
 * 
 * API endpoints for MacroScore v3:
 * - GET /api/macro-score/v3/compute
 * - GET /api/macro-score/v3/audit/full
 * - POST /api/macro-score/v3/stress/run
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  DEFAULT_CONFIG,
  SERIES_CONFIG,
  STRESS_SCENARIOS,
} from './macro_score.contract.js';
import {
  computeMacroScoreV3,
  SeriesData,
} from './macro_score.service.js';
import {
  runFullAuditSuite,
  runStressTest,
  generateAllMockSeries,
} from './macro_score.audit.js';
import { TimeSeriesPoint } from './macro_score.normalizer.js';
import { runFullSensitivityAudit } from './audit/macro_score.sensitivity.audit.js';
import { runOverlayAudit } from './audit/overlay_energy.audit.js';
import { runCascadeAudit, CascadeTestInputs } from '../cascade/cascade.audit.js';
import { getMacroDataProvider, DataMode } from './data/macro_data_provider.js';
import { MongoClient, Db } from 'mongodb';
import {
  analyzeContributions,
  getAllFrequencyFactors,
  ContributionReport,
} from './frequency_normalization.js';

// ═══════════════════════════════════════════════════════════════
// MONGODB CONNECTION
// ═══════════════════════════════════════════════════════════════

let _db: Db | null = null;

async function getDb(): Promise<Db | null> {
  if (_db) return _db;
  
  try {
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'fractal_db';
    
    const client = new MongoClient(mongoUrl);
    await client.connect();
    _db = client.db(dbName);
    
    return _db;
  } catch (e) {
    console.warn('[MacroScore] MongoDB connection failed, using mock data');
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// DATA FETCHER (MongoDB or Mock)
// ═══════════════════════════════════════════════════════════════

async function fetchMacroSeriesFromDB(
  asOf: string,
  dataMode?: DataMode
): Promise<SeriesData[]> {
  const db = await getDb();
  const provider = getMacroDataProvider(db || undefined);
  
  const mode = dataMode || (process.env.MACRO_DATA_MODE as DataMode) || 'mock';
  const { seriesData, meta } = await provider.getData(asOf, { dataMode: mode });
  
  console.log(`[MacroScore] Data fetched: mode=${meta.dataMode}, coverage=${(meta.coveragePct * 100).toFixed(1)}%, missing=${meta.missingSeries.length}`);
  
  return seriesData;
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerMacroScoreV3Routes(app: FastifyInstance): Promise<void> {
  
  /**
   * Compute MacroScore v3
   */
  app.get('/api/macro-score/v3/compute', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asOf, asset = 'DXY', horizon = '90', dataMode } = request.query as {
      asOf?: string;
      asset?: string;
      horizon?: string;
      dataMode?: DataMode;
    };
    
    const targetAsOf = asOf || new Date().toISOString().slice(0, 10);
    const targetHorizon = parseInt(horizon) || 90;
    
    try {
      const seriesData = await fetchMacroSeriesFromDB(targetAsOf, dataMode);
      const result = await computeMacroScoreV3(
        seriesData,
        targetAsOf,
        asset.toUpperCase(),
        targetHorizon,
        DEFAULT_CONFIG
      );
      
      return reply.send({
        ...result,
        dataMode: dataMode || process.env.MACRO_DATA_MODE || 'mock',
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
  app.get('/api/macro-score/v3/audit/full', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asOf, asset = 'DXY' } = request.query as {
      asOf?: string;
      asset?: string;
    };
    
    const targetAsOf = asOf || new Date().toISOString().slice(0, 10);
    
    try {
      const seriesData = await fetchMacroSeriesFromDB(targetAsOf);
      const result = await runFullAuditSuite(seriesData, targetAsOf, asset.toUpperCase());
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Run single stress test
   */
  app.post('/api/macro-score/v3/stress/run', async (request: FastifyRequest, reply: FastifyReply) => {
    const { scenario, asOf } = request.body as {
      scenario?: string;
      asOf?: string;
    };
    
    const targetAsOf = asOf || new Date().toISOString().slice(0, 10);
    const stressConfig = STRESS_SCENARIOS.find(s => s.scenario === scenario);
    
    if (!stressConfig) {
      return reply.status(400).send({
        ok: false,
        error: `Unknown scenario: ${scenario}`,
        available: STRESS_SCENARIOS.map(s => s.scenario),
      });
    }
    
    try {
      const seriesData = await fetchMacroSeriesFromDB(targetAsOf);
      const result = await runStressTest(stressConfig, seriesData, targetAsOf);
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  /**
   * Get available stress scenarios
   */
  app.get('/api/macro-score/v3/stress/scenarios', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      scenarios: STRESS_SCENARIOS.map(s => ({
        id: s.scenario,
        perturbations: s.perturbations,
        missingSeries: s.missingSeries || [],
      })),
    });
  });
  
  /**
   * Get series configuration
   */
  app.get('/api/macro-score/v3/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    const frequencyFactors = getAllFrequencyFactors();
    
    return reply.send({
      ok: true,
      version: 'v3.1.0',
      config: DEFAULT_CONFIG,
      frequencyFactors,
      series: SERIES_CONFIG.map(s => ({
        key: s.key,
        name: s.name,
        direction: s.direction,
        transform: s.transform,
        weight: s.defaultWeight,
        frequencyFactor: frequencyFactors[s.key] || 1.0,
      })),
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // CONTRIBUTION REPORT (Frequency Calibration)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get contribution breakdown report
   * Shows how each series contributes to the final score
   * Helps diagnose T10Y2Y dominance and frequency imbalance
   */
  app.get('/api/macro-score/v3/contribution-report', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asOf, dataMode } = request.query as { asOf?: string; dataMode?: DataMode };
    const targetAsOf = asOf || new Date().toISOString().slice(0, 10);
    
    try {
      const seriesData = await fetchMacroSeriesFromDB(targetAsOf, dataMode);
      
      // Compute score to get signals and weights
      const result = await computeMacroScoreV3(
        seriesData,
        targetAsOf,
        'DXY',
        90,
        { ...DEFAULT_CONFIG, useFrequencyNormalization: false } // Raw for comparison
      );
      
      // Build contribution data
      const contributionData = result.drivers.map(d => ({
        key: d.name,
        signal: d.signal,
        z: d.z,
        weight: d.weight,
      }));
      
      // Add non-driver series
      for (const s of SERIES_CONFIG) {
        if (!contributionData.find(c => c.key === s.key)) {
          const diag = result.diagnostics;
          contributionData.push({
            key: s.key,
            signal: diag.signals[s.key] || 0,
            z: diag.zScores[s.key] || 0,
            weight: s.defaultWeight,
          });
        }
      }
      
      const report = analyzeContributions(contributionData);
      
      // Also compute with frequency normalization for comparison
      const normalizedResult = await computeMacroScoreV3(
        seriesData,
        targetAsOf,
        'DXY',
        90,
        { ...DEFAULT_CONFIG, useFrequencyNormalization: true }
      );
      
      return reply.send({
        ok: true,
        asOf: targetAsOf,
        rawScore: result.score,
        normalizedScore: normalizedResult.score,
        scoreDelta: Math.round((normalizedResult.score - result.score) * 10000) / 10000,
        report,
        comparison: {
          withoutFreqNorm: {
            score: result.score,
            topDriver: result.drivers[0]?.name,
            topDriverShare: report.dominantShare,
          },
          withFreqNorm: {
            score: normalizedResult.score,
            topDriver: normalizedResult.drivers[0]?.name,
            topDriverShare: report.adjustedDominantShare,
          },
        },
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // L4 AUDIT: SENSITIVITY ANALYSIS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Run sensitivity audit (S-1, S-2, S-3)
   * Tests window stability, k-parameter sensitivity, transform consistency
   */
  app.get('/api/macro-score/v3/audit/sensitivity', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asOf } = request.query as { asOf?: string };
    const targetAsOf = asOf || new Date().toISOString().slice(0, 10);
    
    try {
      const seriesData = await fetchMacroSeriesFromDB(targetAsOf);
      const result = await runFullSensitivityAudit(seriesData, targetAsOf);
      
      return reply.send({
        ok: true,
        ...result,
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // L4 AUDIT: OVERLAY ENERGY
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Run overlay energy audit (U-1, U-2)
   * Checks overlay impact ratio and beta plausibility
   */
  app.get('/api/cross-asset/audit/overlay-energy', async (request: FastifyRequest, reply: FastifyReply) => {
    const { asset = 'SPX', windowSize = '90' } = request.query as { 
      asset?: string;
      windowSize?: string;
    };
    
    try {
      // Generate mock data for overlay analysis
      // In production: fetch real returns from MongoDB
      const size = parseInt(windowSize) || 90;
      
      // Mock base returns (asset's own returns)
      const baseReturns: number[] = [];
      for (let i = 0; i < size; i++) {
        baseReturns.push((Math.random() - 0.5) * 0.04); // [-2%, +2%]
      }
      
      // Mock overlay components (g * w * beta * R_ref)
      const overlayComponents: number[] = [];
      for (let i = 0; i < size; i++) {
        overlayComponents.push(baseReturns[i] * 0.15 * (Math.random() * 0.5 + 0.5)); // 7.5-15% of base
      }
      
      // Mock rolling betas
      const rollingBetas: number[] = [];
      for (let i = 0; i < 20; i++) {
        rollingBetas.push(0.3 + Math.random() * 0.4); // [0.3, 0.7]
      }
      
      const result = runOverlayAudit(baseReturns, overlayComponents, rollingBetas);
      
      return reply.send({
        ok: true,
        asset: asset.toUpperCase(),
        windowSize: size,
        ...result,
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // L4 AUDIT: CASCADE ARCHITECTURE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Run cascade architecture audit
   * Verifies: Macro → DXY → SPX → BTC unidirectional flow
   */
  app.get('/api/cascade/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    const { macroEnabled = 'true' } = request.query as { macroEnabled?: string };
    
    try {
      // Mock inputs for cascade test
      // In production: fetch actual values from respective terminals
      const inputs: CascadeTestInputs = {
        macroScore: macroEnabled === 'true' ? 0.15 : 0,
        macroEnabled: macroEnabled === 'true',
        dxyHybrid: 0.25,
        dxyAdj: macroEnabled === 'true' ? 0.27 : 0.25, // Macro adds ~0.02
        spxHybrid: -0.10,
        spxAdj: -0.08, // DXY influence adjusts
        spxBeta: 0.35,
        btcHybrid: 0.45,
        btcAdj: 0.42, // SPX cross-asset influence
        btcGamma: 0.20,
      };
      
      const result = runCascadeAudit(inputs);
      
      return reply.send({
        ok: true,
        inputs,
        ...result,
      });
    } catch (e: any) {
      return reply.status(500).send({
        ok: false,
        error: e.message,
      });
    }
  });
  
  console.log('[MacroScore V3] Routes registered at /api/macro-score/v3/*');
  console.log('[MacroScore V3] L4 Audit: sensitivity, overlay-energy, cascade');
  console.log('[MacroScore V3] v3.1.0: Frequency Normalization Layer enabled');
}

export default registerMacroScoreV3Routes;
