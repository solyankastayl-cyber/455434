/**
 * Fractal API Routes - PRODUCTION
 * V1 + V2 endpoints
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { FractalEngine } from '../engine/fractal.engine.js';
import { FractalBootstrapService } from '../bootstrap/fractal.bootstrap.service.js';
import { StateStore } from '../data/state.store.js';
import { CanonicalStore } from '../data/canonical.store.js';
import { KrakenCsvProvider } from '../data/providers/kraken-csv.provider.js';
import { LegacyProvider } from '../data/providers/legacy.provider.js';
import { FractalMatchRequest, FractalHealthResponse } from '../contracts/fractal.contracts.js';
import { FRACTAL_SYMBOL, FRACTAL_TIMEFRAME, SOURCE_PRIORITY, ONE_DAY_MS } from '../domain/constants.js';

// V2 Imports
import { FractalEngineV2, FractalMatchRequestV2 } from '../engine/fractal.engine.v2.js';
import { V1_CERTIFICATION, FRACTAL_PRESETS, validatePresetOverrides } from '../config/fractal.presets.js';

const STATE_KEY = `${FRACTAL_SYMBOL}:${FRACTAL_TIMEFRAME}`;

// Singleton instances
const engine = new FractalEngine();
const engineV2 = new FractalEngineV2();  // V2 engine
const stateStore = new StateStore();
const canonicalStore = new CanonicalStore();
const bootstrap = new FractalBootstrapService();
const modernProvider = new KrakenCsvProvider();
const legacyProvider = new LegacyProvider();

function getYesterdayUTC(): Date {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcMidnight - ONE_DAY_MS);
}

export async function fractalRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Health Check
   * GET /api/fractal/health
   */
  fastify.get('/api/fractal/health', async (): Promise<FractalHealthResponse & { 
    bootstrapFileExists?: boolean; 
    bootstrapFilePath?: string;
    legacyFileExists?: boolean;
  }> => {
    const enabled = process.env.FRACTAL_ENABLED !== 'false';
    const state = await stateStore.get(STATE_KEY);
    const candleCount = await canonicalStore.count(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME);
    const latest = await canonicalStore.getLatestTs(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME);
    const earliest = await canonicalStore.getEarliestTs(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME);
    const yesterday = getYesterdayUTC();

    // Check if bootstrap CSVs exist
    const bootstrapFileExists = modernProvider.hasBootstrapFile();
    const bootstrapFilePath = modernProvider.getExpectedPath();
    const legacyFileExists = legacyProvider.hasLegacyFile();

    const lagDays = latest
      ? Math.max(0, Math.round((yesterday.getTime() - latest.getTime()) / ONE_DAY_MS))
      : null;

    let dataIntegrity: 'OK' | 'GAPS_DETECTED' | 'BOOTSTRAP_NEEDED' = 'BOOTSTRAP_NEEDED';
    if (state?.bootstrap?.done) {
      dataIntegrity = (state.gaps?.count || 0) > 0 ? 'GAPS_DETECTED' : 'OK';
    }

    return {
      ok: true,
      enabled,
      bootstrapDone: state?.bootstrap?.done || false,
      bootstrapFileExists,
      bootstrapFilePath,
      legacyFileExists,
      lastCanonicalTs: latest || state?.lastCanonicalTs || null,
      candleCount,
      gaps: state?.gaps?.count || 0,
      dataIntegrity,
      lagDays,
      sources: {
        primary: SOURCE_PRIORITY[0],
        fallback: SOURCE_PRIORITY.slice(1)
      }
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 36.0: V2 ENDPOINTS (Age Decay + Regime Conditioning)
  // ═══════════════════════════════════════════════════════════════

  /**
   * V2 Pattern Match - with age decay and regime conditioning
   * POST /api/fractal/v2/match
   */
  fastify.post('/api/fractal/v2/match', async (
    request: FastifyRequest<{ Body: FractalMatchRequestV2 }>
  ) => {
    try {
      const result = await engineV2.matchV2({
        ...request.body,
        version: 2,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * V2 Pattern Match (GET for testing)
   * GET /api/fractal/v2/match?ageDecay=true&regimeConditioned=true
   */
  fastify.get('/api/fractal/v2/match', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        windowLen?: string;
        topK?: string;
        forwardHorizon?: string;
        asOf?: string;
        ageDecay?: string;
        ageDecayLambda?: string;
        regimeConditioned?: string;
      }
    }>
  ) => {
    try {
      const { 
        symbol, windowLen, topK, forwardHorizon, asOf,
        ageDecay, ageDecayLambda, regimeConditioned 
      } = request.query;
      
      const result = await engineV2.matchV2({
        symbol,
        windowLen: windowLen ? parseInt(windowLen) as 30 | 60 | 90 : 60,
        topK: topK ? parseInt(topK) : undefined,
        forwardHorizon: forwardHorizon ? parseInt(forwardHorizon) : undefined,
        asOf: asOf ? new Date(asOf) : undefined,
        version: 2,
        ageDecayEnabled: ageDecay === 'true',
        ageDecayLambda: ageDecayLambda ? parseFloat(ageDecayLambda) : undefined,
        regimeConditioned: regimeConditioned === 'true',
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * V1 Certification Status
   * GET /api/fractal/v1/certification
   */
  fastify.get('/api/fractal/v1/certification', async () => {
    return {
      ok: true,
      ...V1_CERTIFICATION,
      presets: Object.keys(FRACTAL_PRESETS),
    };
  });

  /**
   * Get preset config
   * GET /api/fractal/presets/:key
   */
  fastify.get('/api/fractal/presets/:key', async (
    request: FastifyRequest<{ Params: { key: string } }>
  ) => {
    try {
      const key = request.params.key as keyof typeof FRACTAL_PRESETS;
      if (!FRACTAL_PRESETS[key]) {
        return { ok: false, error: `Unknown preset: ${key}` };
      }
      return {
        ok: true,
        preset: key,
        config: FRACTAL_PRESETS[key],
        immutable: key === 'v1_final' ? ['windowLen'] : [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] V2 endpoints registered (BLOCK 36.0-36.2: Age Decay + Regime Conditioning)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 37.1-37.3: INSTITUTIONAL CORE (Multi-Rep + Two-Stage + Phase)
  // ═══════════════════════════════════════════════════════════════

  /**
   * BLOCK 37.1: Multi-Representation Match
   * GET /api/fractal/v2.1/match?multiRep=true
   * Returns matches scored with ensemble representations (ret + vol + dd)
   */
  fastify.get('/api/fractal/v2.1/match', async (request) => {
    try {
      const query = (request.query || {}) as any;
      
      // Import new engines
      const { buildMultiRepVectors, multiRepSimilarity, buildSingleRepVector } = 
        await import('../engine/similarity.engine.v2.js');
      const { stage1SelectByReturns } = await import('../engine/retrieval.stage1.js');
      const { twoStageRetrieve, analyzeStageCorrelation } = await import('../engine/retrieval.two_stage.js');
      const { enforcePhaseDiversity, analyzePhaseDistribution } = await import('../engine/match-filters.phase.js');
      const { classifyPhaseDetailed } = await import('../engine/phase.classifier.js');
      const { V2_INSTITUTIONAL_CORE_CONFIG } = await import('../config/fractal.presets.js');
      
      const symbol = query.symbol ?? 'BTC';
      const windowLen = parseInt(query.windowLen ?? '60');
      const topK = parseInt(query.topK ?? '25');
      const asOf = query.asOf ? new Date(query.asOf) : undefined;
      
      // Feature flags
      const useMultiRep = query.multiRep !== 'false';
      const useTwoStage = query.twoStage !== 'false';
      const usePhaseDiversity = query.phaseDiversity !== 'false';
      
      // Get base match data using existing engine
      const baseResult = await engineV2.matchV2({
        symbol,
        windowLen: windowLen as 30 | 60 | 90,
        topK: useTwoStage ? 600 : topK, // get more candidates for two-stage
        asOf,
        version: 2,
        ageDecayEnabled: true,
        regimeConditioned: true,
      });
      
      // If multi-rep not enabled, return base result
      if (!useMultiRep || !baseResult.ok) {
        return baseResult;
      }
      
      // Get closes data for current window
      const data = await canonicalStore.getAll(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME);
      if (data.length < windowLen + 200) {
        return { ok: false, error: 'Insufficient data', debug: { dataLength: data.length } };
      }
      
      const asOfTs = asOf?.getTime() ?? Date.now();
      let filtered = data;
      if (asOf) {
        filtered = data.filter(d => d.ts.getTime() <= asOfTs);
      }
      
      const closes = filtered.map(d => d.ohlcv.c);
      const timestamps = filtered.map(d => d.ts);
      
      // Current window closes
      const curCloses = closes.slice(-windowLen - 1);
      
      // Get current phase
      const curPhaseInfo = classifyPhaseDetailed(closes.slice(-300), V2_INSTITUTIONAL_CORE_CONFIG.phaseClassifier);
      
      // Build candidates with closes
      const candidates = baseResult.matches.map((m, idx) => {
        const endIdx = timestamps.findIndex(t => t.getTime() === new Date(m.endTs).getTime());
        const startIdx = endIdx - windowLen;
        return {
          endIdx,
          endTs: new Date(m.endTs),
          startTs: new Date(m.startTs),
          closes: closes.slice(startIdx, endIdx + 1),
          originalRank: idx + 1,
          originalScore: m.score,
        };
      }).filter(c => c.closes.length === windowLen + 1);
      
      let finalMatches = candidates;
      let twoStageStats = null;
      let stageCorrelation = null;
      let phaseDiversityStats = null;
      let phaseDistribution = null;
      
      // Two-stage retrieval
      if (useTwoStage && candidates.length > 0) {
        const stage1 = stage1SelectByReturns(curCloses, candidates, {
          enabled: true,
          stage1Mode: 'ret_fast',
          stage1TopK: 600,
          stage1MinSim: 0.10,
          stage2TopN: 120,
          stage2MinSim: 0.35,
        });
        
        const { ranked, stats } = twoStageRetrieve(
          curCloses,
          stage1,
          V2_INSTITUTIONAL_CORE_CONFIG.twoStage,
          V2_INSTITUTIONAL_CORE_CONFIG.multiRep
        );
        
        twoStageStats = stats;
        stageCorrelation = analyzeStageCorrelation(ranked);
        
        finalMatches = ranked.map(r => ({
          ...r.cand,
          sim: r.sim,
          byRep: r.byRep,
          s1: r.s1,
        }));
      }
      
      // Phase diversity
      if (usePhaseDiversity && finalMatches.length > 0) {
        const { filtered: phaseFiltered, stats } = enforcePhaseDiversity(
          finalMatches.map(m => ({ ...m, sim: (m as any).sim ?? (m as any).originalScore ?? 0.5 })),
          closes.slice(-300),
          V2_INSTITUTIONAL_CORE_CONFIG.phaseClassifier,
          V2_INSTITUTIONAL_CORE_CONFIG.phaseDiversity
        );
        
        phaseDiversityStats = stats;
        finalMatches = phaseFiltered.slice(0, topK);
        
        phaseDistribution = analyzePhaseDistribution(
          finalMatches,
          V2_INSTITUTIONAL_CORE_CONFIG.phaseClassifier
        );
      }
      
      // Take final top-K
      finalMatches = finalMatches.slice(0, topK);
      
      return {
        ok: true,
        version: '2.1',
        asOf: asOf ?? timestamps[timestamps.length - 1],
        features: {
          multiRep: useMultiRep,
          twoStage: useTwoStage,
          phaseDiversity: usePhaseDiversity,
        },
        currentPhase: curPhaseInfo,
        matches: finalMatches.map((m, idx) => ({
          startTs: m.startTs,
          endTs: m.endTs,
          score: (m as any).sim ?? (m as any).originalScore ?? 0,
          rank: idx + 1,
          byRep: (m as any).byRep,
          phase: (m as any).meta?.phase,
        })),
        v21: {
          twoStageStats,
          stageCorrelation,
          phaseDiversityStats,
          phaseDistribution,
          config: {
            multiRep: V2_INSTITUTIONAL_CORE_CONFIG.multiRep,
            twoStage: V2_INSTITUTIONAL_CORE_CONFIG.twoStage,
            phaseDiversity: V2_INSTITUTIONAL_CORE_CONFIG.phaseDiversity,
          },
        },
        // Include base v2 data
        forwardStats: baseResult.forwardStats,
        confidence: baseResult.confidence,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[V2.1 Match Error]', error);
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 37.3: Phase Classification
   * GET /api/fractal/v2.1/phase?asOf=...
   * Get current market phase classification with diagnostics
   */
  fastify.get('/api/fractal/v2.1/phase', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const symbol = query.symbol ?? 'BTC';
      const asOf = query.asOf ? new Date(query.asOf) : undefined;
      
      const { classifyPhaseDetailed } = await import('../engine/phase.classifier.js');
      const { DEFAULT_PHASE_CLASSIFIER_CONFIG } = await import('../contracts/phase.contracts.js');
      
      // Get closes data using FRACTAL constants
      const data = await canonicalStore.getAll(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME);
      
      if (data.length < 300) {
        return { 
          ok: false, 
          error: 'Insufficient data for phase classification',
          debug: { 
            symbol: FRACTAL_SYMBOL, 
            timeframe: FRACTAL_TIMEFRAME,
            dataLength: data.length 
          }
        };
      }
      
      let filtered = data;
      if (asOf) {
        const asOfTs = asOf.getTime();
        filtered = data.filter(d => d.ts.getTime() <= asOfTs);
      }
      
      const closes = filtered.map(d => d.ohlcv.c);
      const result = classifyPhaseDetailed(closes.slice(-300), DEFAULT_PHASE_CLASSIFIER_CONFIG);
      
      return {
        ok: true,
        symbol,
        asOf: asOf ?? filtered[filtered.length - 1]?.ts,
        ...result,
        config: DEFAULT_PHASE_CLASSIFIER_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 37.x: V2.1 Presets Info
   * GET /api/fractal/v2.1/info
   */
  fastify.get('/api/fractal/v2.1/info', async () => {
    try {
      const { V2_INSTITUTIONAL_CORE_CONFIG, FRACTAL_PRESETS } = await import('../config/fractal.presets.js');
      
      return {
        ok: true,
        version: '2.1',
        description: 'Fractal V2.1 - Full Institutional Grade Module',
        blocks: {
          // Phase 1: Match Quality Core
          '37.1': 'Multi-Representation Similarity (ret + vol + dd)',
          '37.2': 'Two-Stage Retrieval (fast candidates → precise rerank)',
          '37.3': 'Phase-Aware Diversity (market phase classification)',
          '37.4': 'Pattern Stability Score (PSS) - perturbation robustness',
          // Phase 2: Anti-Overfit
          '38.1': 'Internal Reliability Signal (drift + calibration + rolling + MC)',
          '38.2': 'Pattern Confidence Decay (age + health + stability + similarity)',
          '38.3': 'Confidence V2 (evidence + calibrated + reliability-adjusted)',
          '38.4': 'Calibration Quality Metrics (ECE + Brier + reliability curve)',
          '38.5': 'Reliability Policy (DEGRADE/RAISE_THRESHOLDS/FREEZE)',
          '38.6': 'Bayesian Calibration (Beta-Binomial per bucket)',
          '38.7': 'Confidence Floor by effectiveN',
          // Phase 3: Institutional Multi-Horizon
          '39.1': 'Horizon Budget + Anti-Dominance',
          '39.2': 'Smooth Exposure Mapping',
          '39.3': 'Tail-Aware Weight Objective',
          '39.4': 'Institutional Score (Module Self-Rating)',
          '39.5': 'Phase-Sensitive Risk Multiplier',
          // Phase 4: Explainability
          '40.1': 'Structured Explainability Payload',
          '40.2': 'TopMatches + Why This Match Breakdown',
          '40.3': 'Counterfactual Scenarios',
          '40.4': 'Influence Attribution + No-Trade Reasons',
          '40.5': 'Institutional Badge Explainer',
        },
        presets: Object.keys(FRACTAL_PRESETS),
        endpoints: {
          // Core
          match: 'GET /api/fractal/v2.1/match',
          phase: 'GET /api/fractal/v2.1/phase',
          // Anti-Overfit
          reliability: 'GET /api/fractal/v2.1/reliability',
          reliabilityState: 'GET /api/fractal/v2.1/reliability/state',
          stability: 'GET /api/fractal/v2.1/stability',
          decay: 'GET /api/fractal/v2.1/decay',
          // Confidence Pipeline
          confidence: 'GET /api/fractal/v2.1/confidence',
          calibrationQuality: 'GET /api/fractal/v2.1/calibration/quality',
          calibration: 'GET /api/fractal/v2.1/calibration',
          calibrationFull: 'GET /api/fractal/v2.1/calibration/full',
          // Institutional
          institutionalInfo: 'GET /api/fractal/v2.1/institutional/info',
          institutionalBudget: 'GET /api/fractal/v2.1/institutional/budget',
          institutionalExposure: 'GET /api/fractal/v2.1/institutional/exposure',
          institutionalScore: 'GET /api/fractal/v2.1/institutional/score',
          institutionalPhaseRisk: 'GET /api/fractal/v2.1/institutional/phase-risk',
          institutionalSignal: 'GET /api/fractal/v2.1/institutional/signal',
          // Explainability (40.x)
          explain: 'GET /api/fractal/v2.1/explain',
          explainNoTrade: 'GET /api/fractal/v2.1/explain/no-trade',
          explainInstitutional: 'GET /api/fractal/v2.1/explain/institutional',
          explainInfluence: 'GET /api/fractal/v2.1/explain/influence',
          info: 'GET /api/fractal/v2.1/info',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] V2.1 endpoints registered (BLOCK 37.1-37.3: Multi-Rep + Two-Stage + Phase)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 37.4 + 38.1 + 38.2: PSS + Reliability + Pattern Decay
  // ═══════════════════════════════════════════════════════════════

  /**
   * BLOCK 38.1: Reliability Check
   * GET /api/fractal/v2.1/reliability
   * Returns current reliability score and badge
   */
  fastify.get('/api/fractal/v2.1/reliability', async () => {
    try {
      const { computeReliability, quickReliabilityCheck } = await import('../engine/reliability.service.js');
      const { DEFAULT_RELIABILITY_CONFIG } = await import('../contracts/reliability.contracts.js');
      
      // Try to get real metrics from existing systems
      let driftLevel: 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL' = 'OK';
      let mcP95MaxDD: number | undefined;
      let mcP10Sharpe: number | undefined;
      let rollingPassRate: number | undefined;
      let calibrationEce: number | undefined;
      let calibrationN: number | undefined;
      
      // Get drift from drift store if available
      try {
        const driftStore = (await import('../data/drift.store.js')).driftStore;
        const driftSnapshot = await driftStore.getLatest();
        if (driftSnapshot?.status) {
          driftLevel = driftSnapshot.status as any;
        }
      } catch { /* use default */ }
      
      // Get MC metrics if available
      try {
        const mcStore = (await import('../data/mc.store.js')).mcStore;
        const mcLatest = await mcStore.getLatest();
        if (mcLatest) {
          mcP95MaxDD = mcLatest.percentiles?.p95?.maxDrawdown;
          mcP10Sharpe = mcLatest.percentiles?.p10?.sharpe;
        }
      } catch { /* use default */ }
      
      // Get rolling metrics if available
      try {
        const rollingStore = (await import('../data/rolling.store.js')).rollingStore;
        const rollingLatest = await rollingStore.getLatest();
        if (rollingLatest) {
          rollingPassRate = rollingLatest.passRate ?? rollingLatest.summary?.passRate;
        }
      } catch { /* use default */ }
      
      // Get calibration metrics if available
      try {
        const calibrationStore = (await import('../data/calibration.store.js')).calibrationStore;
        const calLatest = await calibrationStore.getLatest();
        if (calLatest) {
          calibrationEce = calLatest.ece;
          calibrationN = calLatest.n;
        }
      } catch { /* use default */ }
      
      const inputs = {
        driftLevel,
        mcP95MaxDD,
        mcP10Sharpe,
        rollingPassRate,
        rollingWorstSharpe: undefined, // optional
        calibrationEce,
        calibrationN,
      };
      
      const result = computeReliability(inputs, DEFAULT_RELIABILITY_CONFIG);
      
      return {
        ok: true,
        ...result,
        config: DEFAULT_RELIABILITY_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 37.4: Pattern Stability Score
   * GET /api/fractal/v2.1/stability?asOf=...
   * Returns PSS for current signal
   */
  fastify.get('/api/fractal/v2.1/stability', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const windowLen = parseInt(query.windowLen ?? '60');
      const asOf = query.asOf ? new Date(query.asOf) : undefined;
      
      const { computePss } = await import('../engine/pattern-stability.service.js');
      const { DEFAULT_PSS_CONFIG } = await import('../contracts/pss.contracts.js');
      
      // Mock runMatch function using existing engine
      const runMatch = async (req: any) => {
        const result = await engineV2.matchV2({
          symbol: FRACTAL_SYMBOL,
          windowLen: req.windowLen ?? windowLen,
          topK: 25,
          asOf: req.asOf ?? asOf,
          version: 2,
          ageDecayEnabled: true,
          regimeConditioned: true,
        });
        
        return {
          matches: result.matches.map(m => ({
            key: `${m.startTs}-${m.endTs}`,
            sim: m.score ?? m.similarity,
            mu: m.forwardReturn,
          })),
          side: (result.signal === 'UP' ? 'LONG' : result.signal === 'DOWN' ? 'SHORT' : 'NEUTRAL') as any,
          mu: result.forwardStats?.mu ?? 0,
          excess: result.forwardStats?.excess ?? 0,
        };
      };
      
      const baseReq = {
        windowLen,
        minSimilarity: 0.35,
        repWeights: { ret: 0.5, vol: 0.3, dd: 0.2 },
        asOf,
      };
      
      const pss = await computePss({ runMatch }, baseReq, DEFAULT_PSS_CONFIG);
      
      return {
        ok: true,
        asOf: asOf ?? new Date(),
        windowLen,
        ...pss,
        config: DEFAULT_PSS_CONFIG,
        interpretation: {
          stable: pss.pss >= 0.7,
          fragile: pss.pss < 0.4,
          recommendation: pss.pss < 0.4 ? 'REDUCE_EXPOSURE' : pss.pss < 0.6 ? 'CAUTIOUS' : 'NORMAL',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 38.2: Pattern Decay Demo
   * GET /api/fractal/v2.1/decay?reliability=0.7
   * Shows how pattern decay affects match weights
   */
  fastify.get('/api/fractal/v2.1/decay', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const reliability = parseFloat(query.reliability ?? '0.7');
      const topK = parseInt(query.topK ?? '10');
      
      const { applyPatternDecay, computeWeightedStats } = await import('../engine/pattern-decay.service.js');
      const { DEFAULT_PATTERN_DECAY_CONFIG } = await import('../contracts/pattern-decay.contracts.js');
      
      // Get base matches
      const baseResult = await engineV2.matchV2({
        symbol: FRACTAL_SYMBOL,
        windowLen: 60,
        topK,
        version: 2,
        ageDecayEnabled: true,
      });
      
      // Prepare matches with required fields
      const matchesWithData = baseResult.matches.map((m, idx) => ({
        ...m,
        ageWeight: m.ageWeight ?? (1 - idx * 0.02), // mock age weights
        similarity: m.score ?? m.similarity ?? 0.5,
        stabilityScore: 0.7 + Math.random() * 0.2, // mock stability for demo
        mu: m.forwardReturn ?? 0,
        excess: (m.forwardReturn ?? 0) - 0.005, // mock excess
      }));
      
      // Apply pattern decay
      const weighted = applyPatternDecay(matchesWithData, reliability, DEFAULT_PATTERN_DECAY_CONFIG);
      
      // Compute stats
      const stats = computeWeightedStats(weighted, reliability, 0.5);
      
      return {
        ok: true,
        reliability,
        matches: weighted.slice(0, topK).map((w, idx) => ({
          rank: idx + 1,
          startTs: w.match.startTs,
          endTs: w.match.endTs,
          similarity: w.match.similarity,
          mu: w.match.mu,
          stabilityScore: w.match.stabilityScore,
          weights: w.weight,
        })),
        stats,
        config: DEFAULT_PATTERN_DECAY_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 38.3-38.7: Confidence Calibration Pipeline
  // ═══════════════════════════════════════════════════════════════

  /**
   * BLOCK 38.3: Full Confidence V2
   * GET /api/fractal/v2.1/confidence
   * Returns evidence + calibrated + reliability-adjusted confidence
   */
  fastify.get('/api/fractal/v2.1/confidence', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const windowLen = parseInt(query.windowLen ?? '60');
      const topK = parseInt(query.topK ?? '25');
      
      const { computeConfidenceV2, calculateConsensus } = await import('../engine/confidence-v2.service.js');
      const { DEFAULT_CONFIDENCE_V2_CONFIG } = await import('../contracts/confidence-v2.contracts.js');
      const { applyPatternDecay, computeWeightedStats, effectiveN } = await import('../engine/pattern-decay.service.js');
      const { computeReliability } = await import('../engine/reliability.service.js');
      
      // Get base matches
      const baseResult = await engineV2.matchV2({
        symbol: FRACTAL_SYMBOL,
        windowLen: windowLen as 30 | 60 | 90,
        topK,
        version: 2,
        ageDecayEnabled: true,
      });
      
      // Prepare matches with weights
      const matchesWithData = baseResult.matches.map((m, idx) => ({
        ...m,
        ageWeight: m.ageWeight ?? (1 - idx * 0.02),
        similarity: m.score ?? m.similarity ?? 0.5,
        stabilityScore: 0.7 + Math.random() * 0.2,
        mu: m.forwardReturn ?? 0,
        weight: m.ageWeight ?? (1 - idx * 0.02),
      }));
      
      // Compute reliability
      const relResult = computeReliability({ driftLevel: 'OK' });
      
      // Apply decay
      const weighted = applyPatternDecay(matchesWithData, relResult.reliability);
      const weights = weighted.map(w => w.weight.final);
      const mus = weighted.map(w => w.match.mu);
      
      // Compute stats
      const effN = effectiveN(weights);
      const dispersion = weights.length > 1 
        ? Math.sqrt(mus.reduce((s, m) => s + (m - mus.reduce((a,b)=>a+b,0)/mus.length)**2, 0) / mus.length)
        : 0;
      
      // Consensus
      const { consensus, direction } = calculateConsensus(
        matchesWithData.map(m => ({ mu: m.mu, weight: m.ageWeight ?? 1 }))
      );
      
      // Full confidence computation
      const confResult = computeConfidenceV2({
        signal: direction,
        effectiveN: effN,
        dispersion,
        consensus,
        reliability: relResult.reliability,
      }, DEFAULT_CONFIDENCE_V2_CONFIG);
      
      return {
        ok: true,
        ...confResult,
        meta: {
          matchCount: matchesWithData.length,
          windowLen,
          reliabilityBadge: relResult.badge,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 38.4: Calibration Quality
   * GET /api/fractal/v2.1/calibration/quality
   * Returns ECE, Brier score, and reliability curve bins
   */
  fastify.get('/api/fractal/v2.1/calibration/quality', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const mode = (query.mode === 'quantile' ? 'quantile' : 'fixed') as 'fixed' | 'quantile';
      const mockN = parseInt(query.mockN ?? '100');
      
      const { computeCalibrationQuality, generateMockCalibrationPoints, calibrationHealthScore } = 
        await import('../engine/calibration-quality.service.js');
      const { DEFAULT_CALIBRATION_QUALITY_CONFIG } = await import('../contracts/calibration-quality.contracts.js');
      
      // Generate mock points for demo (in production, use real feedback data)
      const quality = (query.quality ?? 'medium') as 'good' | 'medium' | 'bad';
      const points = generateMockCalibrationPoints(mockN, quality);
      
      const report = computeCalibrationQuality(points, mode, DEFAULT_CALIBRATION_QUALITY_CONFIG);
      const healthScore = calibrationHealthScore(report);
      
      return {
        ok: true,
        ...report,
        healthScore: Math.round(healthScore * 1000) / 1000,
        config: DEFAULT_CALIBRATION_QUALITY_CONFIG,
        note: 'Using mock data for demo. In production, use real feedback events.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 38.5: Reliability State with Policy
   * GET /api/fractal/v2.1/reliability/state
   * Returns full reliability state with policy actions
   */
  fastify.get('/api/fractal/v2.1/reliability/state', async (request) => {
    try {
      const { computeReliability } = await import('../engine/reliability.service.js');
      const { buildReliabilityState } = await import('../engine/reliability-policy.service.js');
      const { DEFAULT_RELIABILITY_POLICY_CONFIG } = await import('../contracts/reliability-policy.contracts.js');
      
      // Get reliability inputs (simplified - in production gather from stores)
      const relResult = computeReliability({ driftLevel: 'OK' });
      
      // Build full state with policy
      const state = buildReliabilityState(relResult, null, DEFAULT_RELIABILITY_POLICY_CONFIG);
      
      return {
        ok: true,
        ...state,
        policyConfig: DEFAULT_RELIABILITY_POLICY_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 38.6: Calibration V2 (Bayesian)
   * GET /api/fractal/v2.1/calibration
   * Returns calibration snapshot with buckets
   */
  fastify.get('/api/fractal/v2.1/calibration', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const symbol = query.symbol ?? 'BTC';
      const horizonDays = parseInt(query.horizonDays ?? '30');
      
      const { calibrationV2Service } = await import('../engine/calibration-v2.service.js');
      
      const snapshot = calibrationV2Service.getSnapshot(symbol, horizonDays);
      
      return {
        ok: true,
        ...snapshot,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 38.6: Seed calibration with mock data
   * POST /api/fractal/v2.1/calibration/seed
   */
  fastify.post('/api/fractal/v2.1/calibration/seed', async (request) => {
    try {
      const body = (request.body || {}) as any;
      const symbol = body.symbol ?? 'BTC';
      const horizonDays = parseInt(body.horizonDays ?? '30');
      const count = parseInt(body.count ?? '100');
      const quality = (body.quality ?? 'medium') as 'good' | 'medium' | 'bad';
      
      const { calibrationV2Service } = await import('../engine/calibration-v2.service.js');
      
      calibrationV2Service.bulkUpdateMock(symbol, horizonDays, count, quality);
      const snapshot = calibrationV2Service.getSnapshot(symbol, horizonDays);
      
      return {
        ok: true,
        message: `Seeded ${count} ${quality} calibration points`,
        snapshot,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 38.7: Full calibration with effectiveN floor
   * GET /api/fractal/v2.1/calibration/full
   * Shows raw -> calibrated -> effectiveN-capped pipeline
   */
  fastify.get('/api/fractal/v2.1/calibration/full', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const rawConf = parseFloat(query.rawConf ?? '0.7');
      const effectiveN = parseFloat(query.effectiveN ?? '10');
      const symbol = query.symbol ?? 'BTC';
      const horizonDays = parseInt(query.horizonDays ?? '30');
      
      const { calibrationV2Service } = await import('../engine/calibration-v2.service.js');
      const { DEFAULT_CONFIDENCE_FLOOR_CONFIG } = await import('../contracts/calibration-v2.contracts.js');
      
      const result = calibrationV2Service.calibrate(rawConf, effectiveN, symbol, horizonDays);
      
      return {
        ok: true,
        input: { rawConf, effectiveN, symbol, horizonDays },
        ...result,
        floorConfig: DEFAULT_CONFIDENCE_FLOOR_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] V2.1 confidence pipeline registered (BLOCK 38.3-38.7: Evidence + Calibration + Floor)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 39.1-39.5: Institutional Multi-Horizon
  // ═══════════════════════════════════════════════════════════════

  /**
   * BLOCK 39.x: Institutional Summary
   * GET /api/fractal/v2.1/institutional/info
   */
  fastify.get('/api/fractal/v2.1/institutional/info', async () => {
    try {
      const { getInstitutionalSummary } = await import('../engine/institutional.service.js');
      return {
        ok: true,
        ...getInstitutionalSummary(),
        blocks: {
          '39.1': 'Horizon Budget + Anti-Dominance',
          '39.2': 'Smooth Exposure Mapping',
          '39.3': 'Tail-Aware Weight Objective',
          '39.4': 'Institutional Score (Self-Rating)',
          '39.5': 'Phase-Sensitive Risk Multiplier',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 39.1: Horizon Budget Demo
   * GET /api/fractal/v2.1/institutional/budget
   */
  fastify.get('/api/fractal/v2.1/institutional/budget', async (request) => {
    try {
      const query = (request.query || {}) as any;
      
      const { assembleWithBudget } = await import('../engine/horizon-budget.service.js');
      const { DEFAULT_HORIZON_BUDGET_CONFIG } = await import('../contracts/institutional.contracts.js');
      
      // Mock horizon scores (in production, get from multi-horizon engine)
      const scores = [
        { horizon: 7 as const, score: parseFloat(query.score7 ?? '0.05'), weight: 0.15 },
        { horizon: 14 as const, score: parseFloat(query.score14 ?? '0.12'), weight: 0.25 },
        { horizon: 30 as const, score: parseFloat(query.score30 ?? '0.08'), weight: 0.30 },
        { horizon: 60 as const, score: parseFloat(query.score60 ?? '0.06'), weight: 0.30 },
      ];
      
      const result = assembleWithBudget(scores, DEFAULT_HORIZON_BUDGET_CONFIG);
      
      return {
        ok: true,
        input: { scores },
        ...result,
        config: DEFAULT_HORIZON_BUDGET_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 39.2: Smooth Exposure Demo
   * GET /api/fractal/v2.1/institutional/exposure
   */
  fastify.get('/api/fractal/v2.1/institutional/exposure', async (request) => {
    try {
      const query = (request.query || {}) as any;
      
      const { computeFinalExposure } = await import('../engine/exposure-map.service.js');
      const { DEFAULT_EXPOSURE_MAP_CONFIG } = await import('../contracts/institutional.contracts.js');
      
      const result = computeFinalExposure({
        absScore: parseFloat(query.absScore ?? '0.15'),
        entropyScale: parseFloat(query.entropyScale ?? '0.8'),
        reliabilityModifier: parseFloat(query.reliability ?? '0.75'),
        phaseMultiplier: parseFloat(query.phaseMultiplier ?? '1.0'),
        direction: (query.direction ?? 'LONG') as 'LONG' | 'SHORT' | 'NEUTRAL',
      }, DEFAULT_EXPOSURE_MAP_CONFIG);
      
      return {
        ok: true,
        ...result,
        config: DEFAULT_EXPOSURE_MAP_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 39.4: Institutional Score
   * GET /api/fractal/v2.1/institutional/score
   */
  fastify.get('/api/fractal/v2.1/institutional/score', async (request) => {
    try {
      const query = (request.query || {}) as any;
      
      const { computeInstitutionalScore } = await import('../engine/institutional-score.service.js');
      const { DEFAULT_INSTITUTIONAL_SCORE_CONFIG } = await import('../contracts/institutional.contracts.js');
      
      const result = computeInstitutionalScore({
        reliability: parseFloat(query.reliability ?? '0.74'),
        stability: parseFloat(query.stability ?? '0.70'),
        rollingPassRate: parseFloat(query.rollingPassRate ?? '0.65'),
        calibrationQuality: parseFloat(query.calibrationQuality ?? '0.60'),
        tailRiskHealth: parseFloat(query.tailRiskHealth ?? '0.55'),
      }, DEFAULT_INSTITUTIONAL_SCORE_CONFIG);
      
      return {
        ok: true,
        ...result,
        config: DEFAULT_INSTITUTIONAL_SCORE_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 39.5: Phase Risk
   * GET /api/fractal/v2.1/institutional/phase-risk
   */
  fastify.get('/api/fractal/v2.1/institutional/phase-risk', async (request) => {
    try {
      const query = (request.query || {}) as any;
      
      const { applyPhaseAdjustment, getPhaseHorizonPolicy } = await import('../engine/phase-risk.service.js');
      const { DEFAULT_PHASE_RISK_CONFIG } = await import('../contracts/institutional.contracts.js');
      
      const phase = (query.phase ?? 'MARKUP') as any;
      const exposure = parseFloat(query.exposure ?? '0.8');
      const reliability = parseFloat(query.reliability ?? '0.75');
      
      const adjustment = applyPhaseAdjustment(exposure, phase, reliability, DEFAULT_PHASE_RISK_CONFIG);
      const horizonPolicy = getPhaseHorizonPolicy(phase);
      
      return {
        ok: true,
        adjustment,
        horizonPolicy,
        config: DEFAULT_PHASE_RISK_CONFIG,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 39.x: Full Institutional Signal
   * GET /api/fractal/v2.1/institutional/signal
   */
  fastify.get('/api/fractal/v2.1/institutional/signal', async (request) => {
    try {
      const query = (request.query || {}) as any;
      
      const { computeInstitutionalSignal } = await import('../engine/institutional.service.js');
      const { classifyPhase } = await import('../engine/phase.classifier.js');
      const { DEFAULT_PHASE_CLASSIFIER_CONFIG } = await import('../contracts/phase.contracts.js');
      
      // Get current phase from data
      const data = await canonicalStore.getAll(FRACTAL_SYMBOL, FRACTAL_TIMEFRAME);
      const closes = data.map(d => d.ohlcv.c);
      const phase = classifyPhase(closes.slice(-300), DEFAULT_PHASE_CLASSIFIER_CONFIG);
      
      // Mock horizon scores (in production, from multi-horizon engine)
      const horizonScores = [
        { horizon: 7 as const, score: parseFloat(query.score7 ?? '0.04'), weight: 0.15 },
        { horizon: 14 as const, score: parseFloat(query.score14 ?? '0.10'), weight: 0.25 },
        { horizon: 30 as const, score: parseFloat(query.score30 ?? '0.08'), weight: 0.30 },
        { horizon: 60 as const, score: parseFloat(query.score60 ?? '0.05'), weight: 0.30 },
      ];
      
      const result = computeInstitutionalSignal({
        horizonScores,
        entropyScale: parseFloat(query.entropyScale ?? '0.85'),
        reliability: parseFloat(query.reliability ?? '0.74'),
        phase,
        currentDirection: query.currentDirection as any,
      });
      
      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] V2.1 institutional endpoints registered (BLOCK 39.1-39.5: Budget + Exposure + Score + Phase)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 40.1-40.5: Explainability Layer V2
  // ═══════════════════════════════════════════════════════════════

  /**
   * BLOCK 40.x: Full Explainability Payload
   * GET /api/fractal/v2.1/explain
   * 
   * Returns complete breakdown of signal decision:
   * - 40.1: Structured payload (horizons, pattern, reliability, confidence, risk)
   * - 40.2: Top matches with "why this match" breakdown
   * - 40.3: Counterfactual analysis (what if we disable X?)
   * - 40.4: Influence attribution + no-trade reasons
   * - 40.5: Institutional badge breakdown
   * 
   * Query params:
   * - symbol: string (default: BTC)
   * - asOfTs: timestamp (default: now)
   * - counterfactual: boolean (default: false) - include counterfactual analysis
   * - matches: boolean (default: true) - include top matches
   * - influence: boolean (default: true) - include influence attribution
   * - debug: boolean (default: false) - include raw data
   */
  fastify.get('/api/fractal/v2.1/explain', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const symbol = query.symbol ?? 'BTC';
      const asOfTs = query.asOfTs ? Number(query.asOfTs) : undefined;
      const includeCounterfactual = query.counterfactual === 'true' || query.counterfactual === '1';
      const includeMatches = query.matches !== 'false' && query.matches !== '0';
      const includeInfluence = query.influence !== 'false' && query.influence !== '0';
      const includeDebug = query.debug === 'true' || query.debug === '1';

      const { FractalExplainV21Service, createMockExplainDeps } = 
        await import('../engine/explain.v2_1.service.js');
      const { computeInstitutionalBreakdown } = 
        await import('../engine/explain.influence.service.js');

      // Create explain service with mock deps for now
      // In production, this would connect to the actual multi-horizon pipeline
      const explainService = new FractalExplainV21Service(createMockExplainDeps());

      const payload = await explainService.explain({
        symbol,
        asOfTs,
        includeCounterfactual,
        includeMatches,
        includeInfluence,
        includeDebug,
      });

      // Add institutional breakdown (40.5)
      const mockRes = await createMockExplainDeps().getMultiHorizonSignal({ symbol, asOfTs });
      const institutionalBreakdown = computeInstitutionalBreakdown({
        reliability: mockRes.reliability.score,
        effectiveN: mockRes.pattern.effectiveN,
        stability: mockRes.pattern.stabilityPSS,
        entropy: mockRes.entropy,
        calibrationQuality: mockRes.calibrationQuality ?? 0.5,
        tailRiskScore: mockRes.risk.tailRiskScore,
        consensusScore: mockRes.consensusScore ?? 0.5,
        institutionalScore: mockRes.institutionalScore,
        institutionalLabel: mockRes.institutionalLabel,
      });

      return {
        ok: true,
        version: '2.1',
        blocks: ['40.1', '40.2', '40.3', '40.4', '40.5'],
        ...payload,
        institutionalBreakdown,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[V2.1 Explain Error]', error);
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 40.4: Why NOT Trade?
   * GET /api/fractal/v2.1/explain/no-trade
   * 
   * Returns specific reasons why the system is not trading
   * Critical for institutional audit trails
   */
  fastify.get('/api/fractal/v2.1/explain/no-trade', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const symbol = query.symbol ?? 'BTC';
      
      const { computeNoTradeReasons, DEFAULT_NO_TRADE_THRESHOLDS } = 
        await import('../engine/explain.influence.service.js');
      const { createMockExplainDeps } = 
        await import('../engine/explain.v2_1.service.js');

      // Get current signal data
      const mockRes = await createMockExplainDeps().getMultiHorizonSignal({ symbol });

      const noTrade = computeNoTradeReasons({
        signal: mockRes.finalSide,
        action: mockRes.position.action,
        effectiveN: mockRes.pattern.effectiveN,
        entropy: mockRes.entropy,
        confidence: mockRes.finalConfidence,
        reliability: mockRes.reliability.score,
        calibrationStatus: mockRes.reliability.calibrationStatus,
        driftStatus: mockRes.reliability.driftStatus,
        phase: mockRes.pattern.phase,
        freezeActive: mockRes.freezeActive,
      }, DEFAULT_NO_TRADE_THRESHOLDS);

      return {
        ok: true,
        symbol,
        signal: mockRes.finalSide,
        action: mockRes.position.action,
        ...noTrade,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 40.5: Institutional Badge Breakdown
   * GET /api/fractal/v2.1/explain/institutional
   * 
   * Detailed breakdown of institutional score components
   */
  fastify.get('/api/fractal/v2.1/explain/institutional', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const symbol = query.symbol ?? 'BTC';
      
      const { computeInstitutionalBreakdown } = 
        await import('../engine/explain.influence.service.js');
      const { createMockExplainDeps } = 
        await import('../engine/explain.v2_1.service.js');

      // Get current signal data
      const mockRes = await createMockExplainDeps().getMultiHorizonSignal({ symbol });

      const breakdown = computeInstitutionalBreakdown({
        reliability: mockRes.reliability.score,
        effectiveN: mockRes.pattern.effectiveN,
        stability: mockRes.pattern.stabilityPSS,
        entropy: mockRes.entropy,
        calibrationQuality: mockRes.calibrationQuality ?? 0.5,
        tailRiskScore: mockRes.risk.tailRiskScore,
        consensusScore: mockRes.consensusScore ?? 0.5,
        institutionalScore: mockRes.institutionalScore,
        institutionalLabel: mockRes.institutionalLabel,
      });

      return {
        ok: true,
        symbol,
        ...breakdown,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 40.4: Influence Attribution
   * GET /api/fractal/v2.1/explain/influence
   * 
   * Shows each horizon's contribution to final signal
   */
  fastify.get('/api/fractal/v2.1/explain/influence', async (request) => {
    try {
      const query = (request.query || {}) as any;
      const symbol = query.symbol ?? 'BTC';
      
      const { computeInfluenceAttribution } = 
        await import('../engine/explain.influence.service.js');
      const { createMockExplainDeps } = 
        await import('../engine/explain.v2_1.service.js');

      // Get current signal data
      const mockRes = await createMockExplainDeps().getMultiHorizonSignal({ symbol });

      const influence = computeInfluenceAttribution({
        horizons: mockRes.horizons.map(h => ({
          horizonDays: h.horizonDays,
          rawScore: h.rawScore,
          weight: h.weight,
          contribution: h.rawScore * h.weight,
          side: h.side,
          confidence: h.confidence,
        })),
        finalSide: mockRes.finalSide,
        finalConfidence: mockRes.finalConfidence,
        finalExposure: mockRes.finalExposure,
        entropy: mockRes.entropy,
        reliability: mockRes.reliability.score,
        effectiveN: mockRes.pattern.effectiveN,
        phase: mockRes.pattern.phase,
        calibrationStatus: mockRes.reliability.calibrationStatus,
        driftStatus: mockRes.reliability.driftStatus,
      });

      return {
        ok: true,
        symbol,
        signal: mockRes.finalSide,
        confidence: mockRes.finalConfidence,
        exposure: mockRes.finalExposure,
        ...influence,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] V2.1 explainability endpoints registered (BLOCK 40.1-40.5: Explain + Influence + NoTrade + Institutional)');

  console.log('[Fractal] V2.1 anti-overfit endpoints registered (BLOCK 37.4 + 38.1 + 38.2: PSS + Reliability + Decay)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 36.3-36.4: Dynamic Floor + Dispersion + Rolling Validation
  // ═══════════════════════════════════════════════════════════════

  /**
   * V2 Quick Simulation with 36.3 features
   * POST /api/fractal/v2/sim/quick
   * Test Dynamic Floor + Temporal Dispersion impact
   */
  fastify.post('/api/fractal/v2/sim/quick', async (request) => {
    try {
      const { SimFullService } = await import('../sim/sim.full.service.js');
      const sim = new SimFullService();
      
      const body = (request.body || {}) as any;
      
      // Run simulation with V2 defaults
      const result = await sim.runFull({
        start: body.start ?? '2019-01-01',
        end: body.end ?? '2026-02-15',
        symbol: body.symbol ?? 'BTC',
        stepDays: body.stepDays ?? 7,
        overrides: body.overrides,
      });
      
      return {
        ok: true,
        version: 2,
        features: {
          dynamicFloor: true,
          temporalDispersion: true,
          ageDecay: true,
          regimeConditioned: true,
        },
        metrics: result.metrics,
        yearlyBreakdown: result.yearlyBreakdown,
        verdict: result.verdict,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 36.4: Rolling Validation Harness
   * POST /api/fractal/admin/sim/rolling-validation
   * Industrial-grade backtesting with purged rolling splits
   */
  fastify.post('/api/fractal/admin/sim/rolling-validation', async (request) => {
    try {
      const { SimRollingService } = await import('../sim/sim.rolling.service.js');
      const rolling = new SimRollingService();
      
      const body = (request.body || {}) as any;
      
      const result = await rolling.runRollingValidation({
        trainYears: body.trainYears ?? 5,
        testYears: body.testYears ?? 1,
        stepYears: body.stepYears ?? 1,
        startYear: body.startYear ?? 2014,
        endYear: body.endYear ?? 2026,
        symbol: body.symbol ?? 'BTC',
        stepDays: body.stepDays ?? 7,
        overrides: body.overrides,
      }, body.gateCriteria);
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 36.4: Get Rolling Validation Summary (cached/quick)
   * GET /api/fractal/admin/sim/rolling-summary
   */
  fastify.get('/api/fractal/admin/sim/rolling-summary', async () => {
    try {
      const { SimRollingService, DEFAULT_GATE_CRITERIA } = await import('../sim/sim.rolling.service.js');
      
      return {
        ok: true,
        gateCriteria: DEFAULT_GATE_CRITERIA,
        info: {
          description: 'Run POST /api/fractal/admin/sim/rolling-validation for full results',
          defaultConfig: {
            trainYears: 5,
            testYears: 1,
            stepYears: 1,
            startYear: 2014,
            endYear: 2026,
          },
          v2GateTargets: {
            meanSharpe: '>= 0.55',
            worstSharpe: '>= 0',
            meanMaxDD: '<= 35%',
            passRate: '>= 70%',
            stability: '>= 1.5',
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] V2 endpoints extended (BLOCK 36.3-36.4: Dynamic Floor + Rolling Validation)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 36.5-36.7: MULTI-HORIZON ENGINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * BLOCK 36.5: Multi-Horizon Signal
   * GET /api/fractal/v2/multi-horizon
   * Get signal from all horizon layers (7/14/30/60 days)
   */
  fastify.get('/api/fractal/v2/multi-horizon', async (request) => {
    try {
      const { MultiHorizonEngine } = await import('../engine/multi-horizon.engine.js');
      const engine = new MultiHorizonEngine();
      
      const query = (request.query || {}) as any;
      const asOf = query.asOf ? new Date(query.asOf) : new Date();
      
      const result = await engine.runMultiHorizonMatch(asOf, {
        adaptiveFilterEnabled: query.adaptiveFilter !== 'false',
      });
      
      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 36.5-36.7: Multi-Horizon Full Simulation
   * POST /api/fractal/admin/sim/multi-horizon
   * Run full walk-forward with multi-horizon engine
   */
  fastify.post('/api/fractal/admin/sim/multi-horizon', async (request) => {
    try {
      const { SimMultiHorizonService } = await import('../sim/sim.multi-horizon.service.js');
      const sim = new SimMultiHorizonService();
      
      const body = (request.body || {}) as any;
      
      const result = await sim.runFull({
        start: body.start ?? '2019-01-01',
        end: body.end ?? '2026-02-15',
        symbol: body.symbol ?? 'BTC',
        stepDays: body.stepDays ?? 7,
        horizonConfig: body.horizonConfig,
        overrides: body.overrides,
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 36.5-36.7: Quick Multi-Horizon Info
   * GET /api/fractal/admin/sim/multi-horizon-info
   */
  fastify.get('/api/fractal/admin/sim/multi-horizon-info', async () => {
    try {
      const { DEFAULT_MULTI_HORIZON_CONFIG } = await import('../engine/multi-horizon.engine.js');
      
      return {
        ok: true,
        description: 'Multi-Horizon Engine (BLOCK 36.5-36.7)',
        config: DEFAULT_MULTI_HORIZON_CONFIG,
        features: {
          '36.5': 'Multi-Horizon Parallel Matching (7/14/30/60 days)',
          '36.6': 'Weighted Horizon Assembly (structural > impulse)',
          '36.7': 'Adaptive Horizon Policy (filter by regime)',
        },
        v2Targets: {
          sharpe: '>= 0.75',
          maxDD: '<= 30%',
          worstSharpe: '>= 0',
          passRate: '>= 80%',
          mcP95: '<= 40%',
        },
        usage: 'POST /api/fractal/admin/sim/multi-horizon for full simulation',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] V2 Multi-Horizon endpoints registered (BLOCK 36.5-36.7)');

  /**
   * Pattern Match (POST)
   * POST /api/fractal/match
   */
  fastify.post('/api/fractal/match', async (
    request: FastifyRequest<{ Body: FractalMatchRequest }>
  ) => {
    try {
      const result = await engine.match(request.body || {});
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Pattern Match (GET for easy testing)
   * GET /api/fractal/match?windowLen=30&topK=25&asOf=2021-01-01&similarityMode=raw_returns
   * BLOCK 34.10: Added asOf and similarityMode parameters
   */
  fastify.get('/api/fractal/match', async (
    request: FastifyRequest<{
      Querystring: {
        symbol?: string;
        windowLen?: string;
        topK?: string;
        forwardHorizon?: string;
        asOf?: string;
        similarityMode?: string;
      }
    }>
  ) => {
    try {
      const { symbol, windowLen, topK, forwardHorizon, asOf, similarityMode } = request.query;
      const result = await engine.match({
        symbol,
        windowLen: windowLen ? parseInt(windowLen) as 30 | 60 | 90 : undefined,
        topK: topK ? parseInt(topK) : undefined,
        forwardHorizon: forwardHorizon ? parseInt(forwardHorizon) : undefined,
        asOf: asOf ? new Date(asOf) : undefined,
        similarityMode: (similarityMode === 'zscore') ? 'zscore' : 'raw_returns'
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Human-readable explanation
   * GET /api/fractal/explain?windowLen=30
   */
  fastify.get('/api/fractal/explain', async (
    request: FastifyRequest<{ Querystring: { windowLen?: string } }>
  ) => {
    try {
      const { windowLen } = request.query;
      const explanation = await engine.explain({
        windowLen: windowLen ? parseInt(windowLen) as 30 | 60 | 90 : 30
      });
      return { ok: true, explanation };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Detailed Explainability (Block 13)
   * GET /api/fractal/explain/detailed?windowLen=30&topK=10
   * 
   * Returns full breakdown of WHY matches were selected
   */
  fastify.get('/api/fractal/explain/detailed', async (
    request: FastifyRequest<{
      Querystring: {
        windowLen?: string;
        topK?: string;
        forwardHorizon?: string;
      }
    }>
  ) => {
    try {
      const { windowLen, topK, forwardHorizon } = request.query;
      const result = await engine.explainDetailed({
        windowLen: windowLen ? parseInt(windowLen) as 30 | 60 | 90 : 30,
        topK: topK ? parseInt(topK) : 10,
        forwardHorizon: forwardHorizon ? parseInt(forwardHorizon) : 30
      });
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 14: OVERLAY VISUALIZATION API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Overlay Data for Single-Fractal Visualization
   * GET /api/fractal/overlay?windowLen=60&horizonDays=30
   * 
   * Returns normalized price series:
   * - current: current market window (normalized to 100)
   * - match: best historical match (normalized to 100)
   * - forward: what happened after the match
   */
  fastify.get('/api/fractal/overlay', async (
    request: FastifyRequest<{
      Querystring: {
        windowLen?: string;
        horizonDays?: string;
      }
    }>
  ) => {
    try {
      const windowLen = request.query.windowLen ? parseInt(request.query.windowLen) as 30 | 60 | 90 : 60;
      const horizonDays = request.query.horizonDays ? parseInt(request.query.horizonDays) : 30;

      // Get best match (topK=1)
      const matchResult = await engine.match({
        windowLen,
        topK: 1,
        forwardHorizon: horizonDays
      });

      if (!matchResult.matches?.length) {
        return { ok: false, reason: 'NO_MATCHES' };
      }

      const bestMatch = matchResult.matches[0];

      // Build overlay series
      const overlay = await engine.buildOverlay({
        windowLen,
        horizonDays,
        match: bestMatch
      });

      // Get detailed explanation for the match
      const explainResult = await engine.explainDetailed({
        windowLen,
        topK: 1,
        forwardHorizon: horizonDays
      });

      const matchExplanation = explainResult.matches?.[0] || null;

      return {
        ok: true,
        windowLen,
        horizonDays,
        current: overlay.current,
        match: {
          ...overlay.match,
          period: matchExplanation?.period || null,
          regime: matchExplanation?.regime || null,
          scores: matchExplanation?.scores || null,
          context: matchExplanation?.context || null,
          humanSummary: matchExplanation?.humanSummary || null
        },
        forward: overlay.forward,
        stats: {
          forwardStats: matchResult.forwardStats,
          confidence: matchResult.confidence,
          narrative: explainResult.narrative || null
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Trigger bootstrap
   * POST /api/fractal/admin/bootstrap
   */
  fastify.post('/api/fractal/admin/bootstrap', async () => {
    try {
      // Run in background
      bootstrap.ensureBootstrapped().catch(err => {
        console.error('[Fractal] Bootstrap error:', err);
      });
      return { ok: true, message: 'Bootstrap started in background' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Force incremental update
   * POST /api/fractal/admin/force-update
   */
  fastify.post('/api/fractal/admin/force-update', async () => {
    try {
      await bootstrap.forceUpdate();
      const state = await stateStore.get(STATE_KEY);
      return { ok: true, state };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Scan continuity
   * POST /api/fractal/admin/scan-continuity
   */
  fastify.post('/api/fractal/admin/scan-continuity', async () => {
    try {
      const gaps = await bootstrap.forceScanContinuity();
      const state = await stateStore.get(STATE_KEY);
      return { ok: true, gaps, state };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Auto-fix gaps
   * POST /api/fractal/admin/auto-fix-gaps
   */
  fastify.post('/api/fractal/admin/auto-fix-gaps', async () => {
    try {
      const remainingGaps = await bootstrap.autoFixGaps();
      return { ok: true, remainingGaps };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Invalidate cache
   * POST /api/fractal/admin/invalidate-cache
   */
  fastify.post('/api/fractal/admin/invalidate-cache', async () => {
    engine.adminClearCache();
    return { ok: true, message: 'Cache invalidated' };
  });

  /**
   * Admin: Rebuild index
   * POST /api/fractal/admin/rebuild-index
   */
  fastify.post('/api/fractal/admin/rebuild-index', async () => {
    try {
      await engine.adminRebuildIndex();
      return { ok: true, message: 'Index rebuilt' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 16-23: ML FEATURE LAYER ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Update labels for windows where horizon has passed
   * POST /api/fractal/admin/update-labels
   */
  fastify.post('/api/fractal/admin/update-labels', async (request) => {
    try {
      const { FractalLabelerService } = await import('../bootstrap/fractal.labeler.service.js');
      const labeler = new FractalLabelerService();
      
      const body = (request.body || {}) as { limit?: number };
      const limit = body.limit ?? 200;
      
      const result = await labeler.updateLabels(limit);
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get ML dataset statistics
   * GET /api/fractal/admin/dataset-stats
   */
  fastify.get('/api/fractal/admin/dataset-stats', async () => {
    try {
      const { WindowStore } = await import('../data/window.store.js');
      const windowStore = new WindowStore();
      
      const stats = await windowStore.getStats();
      return { ok: true, ...stats };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Ingest performance records from labeled windows
   * POST /api/fractal/admin/ingest-performance
   */
  fastify.post('/api/fractal/admin/ingest-performance', async (request) => {
    try {
      const { FractalPerformanceService } = await import('../bootstrap/fractal.performance.service.js');
      const perfService = new FractalPerformanceService();
      
      const body = (request.body || {}) as { limit?: number };
      const limit = body.limit ?? 500;
      
      const result = await perfService.ingestFromLabeledWindows(limit);
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get performance metrics
   * GET /api/fractal/admin/performance-metrics
   */
  fastify.get('/api/fractal/admin/performance-metrics', async () => {
    try {
      const { FractalPerformanceService } = await import('../bootstrap/fractal.performance.service.js');
      const perfService = new FractalPerformanceService();
      
      const metrics = await perfService.getMetrics(500);
      return { ok: true, ...metrics };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Auto-adjust parameters based on performance
   * POST /api/fractal/admin/auto-adjust
   */
  fastify.post('/api/fractal/admin/auto-adjust', async () => {
    try {
      const { FractalAutoTuneService } = await import('../bootstrap/fractal.autotune.service.js');
      const autoTune = new FractalAutoTuneService();
      
      const result = await autoTune.autoAdjust('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get current auto-tune settings
   * GET /api/fractal/admin/settings
   */
  fastify.get('/api/fractal/admin/settings', async () => {
    try {
      const { FractalAutoTuneService } = await import('../bootstrap/fractal.autotune.service.js');
      const autoTune = new FractalAutoTuneService();
      
      const settings = await autoTune.getSettings('BTC');
      return { ok: true, ...settings };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 24: BACKTEST ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run shadow backtest
   * POST /api/fractal/admin/backtest
   */
  fastify.post('/api/fractal/admin/backtest', async (request) => {
    try {
      const { FractalBacktestService } = await import('../backtest/fractal.backtest.service.js');
      const backtest = new FractalBacktestService();
      
      const body = (request.body || {}) as any;
      
      const config = {
        symbol: body.symbol ?? 'BTC',
        timeframe: body.timeframe ?? '1d',
        windowLen: body.windowLen ?? 60,
        horizonDays: body.horizonDays ?? 30,
        minGapDays: body.minGapDays ?? 60,
        topK: body.topK ?? 25,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined
      };
      
      fastify.log.info({ config }, 'Starting backtest');
      
      const result = await backtest.run(config);
      
      fastify.log.info({ trades: result.totalTrades, winRate: result.winRate }, 'Backtest complete');
      
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error({ error: message }, 'Backtest failed');
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 25: CALIBRATION ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Get confidence calibration report
   * GET /api/fractal/admin/calibration
   */
  fastify.get('/api/fractal/admin/calibration', async () => {
    try {
      const { FractalCalibrationService } = await import('../bootstrap/fractal.calibration.service.js');
      const calibration = new FractalCalibrationService();
      
      const result = await calibration.buildCalibration();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Auto-calibrate confidence
   * POST /api/fractal/admin/auto-calibrate
   */
  fastify.post('/api/fractal/admin/auto-calibrate', async () => {
    try {
      const { FractalCalibrationService } = await import('../bootstrap/fractal.calibration.service.js');
      const calibration = new FractalCalibrationService();
      
      const result = await calibration.autoCalibrate('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 26: DATASET EXPORT ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Export ML dataset
   * GET /api/fractal/admin/dataset
   * Query params: symbol, limit, fromDate, toDate
   */
  fastify.get('/api/fractal/admin/dataset', async (request) => {
    try {
      const { FractalDatasetService } = await import('../bootstrap/fractal.dataset.service.js');
      const dataset = new FractalDatasetService();
      
      const q = (request.query || {}) as any;
      const limit = Number(q.limit ?? 50000);
      const symbol = String(q.symbol ?? 'BTC');
      const fromDate = q.fromDate ? String(q.fromDate) : undefined;
      const toDate = q.toDate ? String(q.toDate) : undefined;
      
      const rows = await dataset.fetchLabeled(symbol, limit, fromDate, toDate);
      
      // Return metadata about the date range
      const dates = rows.map(r => r.t).sort();
      const actualFrom = dates[0] || null;
      const actualTo = dates[dates.length - 1] || null;
      
      return { 
        ok: true, 
        count: rows.length, 
        dateRange: {
          requested: { from: fromDate || null, to: toDate || null },
          actual: { from: actualFrom, to: actualTo }
        },
        rows 
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get dataset stats
   * GET /api/fractal/admin/dataset-info
   */
  fastify.get('/api/fractal/admin/dataset-info', async (request) => {
    try {
      const { FractalDatasetService } = await import('../bootstrap/fractal.dataset.service.js');
      const dataset = new FractalDatasetService();
      
      const q = (request.query || {}) as any;
      const symbol = String(q.symbol ?? 'BTC');
      
      const stats = await dataset.getDatasetStats(symbol);
      return { ok: true, ...stats };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 27: ML MODEL ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Save ML model weights
   * POST /api/fractal/admin/ml-model
   */
  fastify.post('/api/fractal/admin/ml-model', async (request) => {
    try {
      const { FractalMLService } = await import('../bootstrap/fractal.ml.service.js');
      const ml = new FractalMLService();
      
      const body = (request.body || {}) as any;
      
      await ml.saveModel(
        body.symbol ?? 'BTC',
        body.weights,
        body.bias,
        body.featureOrder,
        body.trainStats
      );
      
      return { ok: true, message: 'Model saved' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get ML model info
   * GET /api/fractal/admin/ml-model
   */
  fastify.get('/api/fractal/admin/ml-model', async (request) => {
    try {
      const { FractalMLService } = await import('../bootstrap/fractal.ml.service.js');
      const ml = new FractalMLService();
      
      const q = (request.query || {}) as any;
      const symbol = String(q.symbol ?? 'BTC');
      
      const info = await ml.getModelInfo(symbol);
      return { ok: true, ...info };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 28: WEIGHT OPTIMIZATION ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Optimize ensemble weights
   * POST /api/fractal/admin/optimize-weights
   */
  fastify.post('/api/fractal/admin/optimize-weights', async () => {
    try {
      const { FractalWeightOptimizer } = await import('../bootstrap/fractal.weight-optimizer.service.js');
      const optimizer = new FractalWeightOptimizer();
      
      const result = await optimizer.optimize('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get ensemble settings
   * GET /api/fractal/admin/ensemble
   */
  fastify.get('/api/fractal/admin/ensemble', async () => {
    try {
      const { FractalWeightOptimizer } = await import('../bootstrap/fractal.weight-optimizer.service.js');
      const optimizer = new FractalWeightOptimizer();
      
      const settings = await optimizer.getEnsembleSettings('BTC');
      return { ok: true, ...settings };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 27: FINAL SIGNAL ENDPOINT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get ensemble signal (Rule + ML + Regime Gate) + Position Lifecycle (BLOCK 29.20-29.23)
   * GET /api/fractal/signal
   */
  fastify.get('/api/fractal/signal', async (request) => {
    try {
      const q = (request.query || {}) as any;
      const windowLen = (Number(q.windowLen ?? 60) as 30 | 60 | 90);
      
      // BLOCK 29.21: Lazy settle (auto-settle if due)
      const { FractalSettleService } = await import('../bootstrap/fractal.settle.service.js');
      const settle = new FractalSettleService();
      await settle.settleIfDue('BTC', new Date());
      
      // Get rule-based match
      const matchResult = await engine.match({
        windowLen,
        horizonDays: 30,
        topK: 25,
        minGapDays: 60
      });
      
      if (!matchResult.ok) {
        return { ok: false, signal: 'NEUTRAL', reason: 'MATCH_FAILED' };
      }
      
      // Determine rule direction
      const p10 = matchResult.forwardStats?.return?.p10 ?? 0;
      const p50 = matchResult.forwardStats?.return?.p50 ?? 0;
      const p90 = matchResult.forwardStats?.return?.p90 ?? 0;
      
      let ruleDir: 'UP' | 'DOWN' | 'MIXED' = 'MIXED';
      if (p10 > 0 && p90 > 0) ruleDir = 'UP';
      else if (p10 < 0 && p90 < 0) ruleDir = 'DOWN';
      
      // Get ML prediction
      const { FractalMLService } = await import('../bootstrap/fractal.ml.service.js');
      const ml = new FractalMLService();
      
      const mlPred = await ml.predict('BTC', {
        rule_p50: p50,
        rule_p10: p10,
        rule_p90: p90
      });
      
      // Get ensemble settings
      const { FractalWeightOptimizer } = await import('../bootstrap/fractal.weight-optimizer.service.js');
      const optimizer = new FractalWeightOptimizer();
      const ensemble = await optimizer.getEnsembleSettings('BTC');
      
      // Calculate ensemble score
      const ruleNorm = Math.max(-0.5, Math.min(0.5, p50)) * 2;
      const mlBias = mlPred ? (mlPred.probUp - 0.5) * 2 : 0;
      let score = ensemble.w_rule * ruleNorm + ensemble.w_ml * mlBias;
      
      let signal: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
      if (score > ensemble.threshold) signal = 'LONG';
      else if (score < -ensemble.threshold) signal = 'SHORT';
      
      // Check regime gate
      const { FractalSettingsModel } = await import('../data/schemas/fractal-settings.schema.js');
      const settings = await FractalSettingsModel.findOne({ symbol: 'BTC' }).lean() as any;
      
      // Get explain for regime (simplified)
      const explainResult = await engine.explain({
        windowLen,
        horizonDays: 30,
        topK: 25,
        minGapDays: 60
      });
      
      const currentRegime = (explainResult as any)?.currentRegime;
      
      if (settings?.badRegimes?.some((r: any) =>
        r.trend === currentRegime?.trend &&
        r.vol === currentRegime?.volatility
      )) {
        signal = 'NEUTRAL';
      }
      
      // BLOCK 29.23: Apply online calibration
      const { FractalOnlineCalibrationService } = await import('../bootstrap/fractal.online-calibration.service.js');
      const calib = new FractalOnlineCalibrationService();
      let confidence = Math.min(1, Math.abs(score));
      const cal = await calib.score('BTC', confidence);
      confidence = cal.calibratedConfidence;
      
      // BLOCK 29.17-29.19: Risk adjustments
      const { FractalRiskStateService } = await import('../bootstrap/fractal.risk-state.service.js');
      const riskSvc = new FractalRiskStateService();
      const riskState = await riskSvc.getDD('BTC');
      
      // Vol targeting
      const volTarget = Number(settings?.riskModel?.volTargetAnnual ?? 0.6);
      const maxLev = Number(settings?.riskModel?.maxLeverage ?? 2.0);
      const minLev = Number(settings?.riskModel?.minLeverage ?? 0.0);
      // Simplified vol estimate (use 60% as default)
      let lev = Math.max(minLev, Math.min(maxLev, volTarget / 0.6));
      
      // DD taper
      const ddAbs = riskState.ddAbs;
      const softDD = Number(settings?.ddModel?.softDD ?? 0.12);
      const hardDD = Number(settings?.ddModel?.hardDD ?? 0.25);
      const minMult = Number(settings?.ddModel?.minMult ?? 0.15);
      const taperPower = Number(settings?.ddModel?.taperPower ?? 1.5);
      
      let ddMult = 1.0;
      if (ddAbs >= hardDD) ddMult = 0;
      else if (ddAbs > softDD) {
        const x = (ddAbs - softDD) / (hardDD - softDD);
        ddMult = minMult + (1 - minMult) * (1 - Math.pow(x, taperPower));
      }
      
      // Regime multiplier
      let regimeMult = 1.0;
      if (settings?.regimeExposure?.enabled && currentRegime) {
        const override = settings.regimeExposure.overrides?.find((o: any) => 
          o.trend === currentRegime.trend && o.vol === currentRegime.volatility
        );
        if (override?.mult != null) {
          regimeMult = override.mult;
        } else {
          const defaults = settings.regimeExposure.defaults ?? {};
          regimeMult = (defaults[currentRegime.trend] ?? 1) * (defaults[currentRegime.volatility] ?? 1);
        }
      }
      
      const exposure = lev * ddMult * regimeMult;
      
      // Cost model
      const feeBps = Number(settings?.costModel?.feeBps ?? 4);
      const slippageBps = Number(settings?.costModel?.slippageBps ?? 6);
      const spreadBps = Number(settings?.costModel?.spreadBps ?? 2);
      const roundTripCost = 2 * (feeBps + slippageBps + spreadBps) / 10000;
      
      // Get current price
      const currentPrice = await settle.getLatestClose('BTC');
      
      // BLOCK 29.20: Apply position lifecycle
      const { FractalPositionService } = await import('../bootstrap/fractal.position.service.js');
      const pos = new FractalPositionService();
      
      const positionAction = await pos.applySignal({
        symbol: 'BTC',
        ts: new Date(),
        price: currentPrice ?? 0,
        signal,
        confidence,
        exposure,
        rules: settings?.positionModel ?? {},
        roundTripCost,
        entrySnapshot: {
          features: { rule_p50: p50, rule_p10: p10, rule_p90: p90 },
          confidence,
          signal,
          modelVersion: 'ACTIVE',
          regime: { trend: currentRegime?.trend ?? '', volatility: currentRegime?.volatility ?? '' },
          ddAbs
        }
      });
      
      const currentPosition = await pos.get('BTC');
      
      return {
        ok: true,
        signal,
        confidence,
        exposure,
        ruleDirection: ruleDir,
        mlProbUp: mlPred?.probUp ?? null,
        ensemble: { score, ...ensemble },
        regime: currentRegime,
        calibration: {
          bucketAcc: cal.bucketAcc,
          mult: cal.mult,
          n: cal.n,
          idx: cal.idx
        },
        risk: {
          ddAbs,
          ddMult,
          regimeMult,
          leverage: lev,
          finalExposure: exposure
        },
        position: currentPosition,
        positionAction
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message, signal: 'NEUTRAL' };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.8: FRACTAL SIGNAL BUILDER (Pure Pattern Matching)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get signal from Fractal Pattern Matching (pure, no ML/ensemble)
   * GET /api/fractal/signal/fractal
   * Query: symbol?, windowLen?, topK?, minSimilarity?, minMatches?, horizonDays?, neutralBand?, asOf?, similarityMode?
   *        useRelative?, relativeBand?, baselineLookbackDays?
   * BLOCK 34.10: Added similarityMode parameter (raw_returns | zscore)
   * BLOCK 34.11: Added relative signal mode (excess = mu - baseline)
   */
  fastify.get('/api/fractal/signal/fractal', async (request) => {
    try {
      const { FractalSignalBuilder, DEFAULT_SIGNAL_PARAMS } = await import('../engine/fractal.signal.builder.js');
      const signalBuilder = new FractalSignalBuilder(engine);
      
      const q = (request.query || {}) as any;
      
      // BLOCK 34.10: Get similarityMode from query, default to raw_returns for asOf-safe simulation
      const similarityMode = (q.similarityMode === 'zscore') ? 'zscore' : 'raw_returns';
      
      // BLOCK 34.11: Relative mode params
      const useRelative = q.useRelative !== 'false';  // default true
      const relativeBand = q.relativeBand ? Number(q.relativeBand) : DEFAULT_SIGNAL_PARAMS.relativeBand;
      const baselineLookbackDays = q.baselineLookbackDays ? Number(q.baselineLookbackDays) : DEFAULT_SIGNAL_PARAMS.baselineLookbackDays;
      
      const signal = await signalBuilder.build({
        symbol: q.symbol ?? 'BTC',
        timeframe: '1d',
        asOf: q.asOf,
        windowLen: Number(q.windowLen ?? DEFAULT_SIGNAL_PARAMS.windowLen),
        topK: Number(q.topK ?? DEFAULT_SIGNAL_PARAMS.topK),
        minSimilarity: Number(q.minSimilarity ?? DEFAULT_SIGNAL_PARAMS.minSimilarity),
        minMatches: Number(q.minMatches ?? DEFAULT_SIGNAL_PARAMS.minMatches),
        horizonDays: Number(q.horizonDays ?? DEFAULT_SIGNAL_PARAMS.horizonDays),
        minGapDays: Number(q.minGapDays ?? DEFAULT_SIGNAL_PARAMS.minGapDays),
        neutralBand: Number(q.neutralBand ?? DEFAULT_SIGNAL_PARAMS.neutralBand),
        similarityMode,
        useRelative,
        relativeBand,
        baselineLookbackDays
      });
      
      return {
        ok: true,
        signal: signal.action,
        confidence: signal.confidence,
        stats: {
          mu: signal.mu,
          baseline: signal.baseline,   // BLOCK 34.11
          excess: signal.excess,       // BLOCK 34.11
          p10: signal.p10,
          p90: signal.p90,
          dd95: signal.dd95,
          matchCount: signal.matchCount
        },
        config: {
          windowLen: signal.usedWindowLen,
          horizonDays: signal.usedHorizonDays,
          asOf: signal.asOf,
          similarityMode,
          useRelative,          // BLOCK 34.11
          relativeBand          // BLOCK 34.11
        },
        topMatches: signal.topMatches,
        reason: signal.reason
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message, signal: 'NEUTRAL' };
    }
  });


  // ═══════════════════════════════════════════════════════════════
  // BLOCK 29: AUTO-LEARNING LOOP ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run full autolearn cycle (train -> shadow backtest -> promote/discard)
   * POST /api/fractal/admin/autolearn/run
   * Body: { symbol?, fromDate?, toDate? }
   */
  fastify.post('/api/fractal/admin/autolearn/run', async (request) => {
    try {
      const { FractalAutoLearnService } = await import('../bootstrap/fractal.autolearn.service.js');
      const autolearn = new FractalAutoLearnService();
      
      const body = (request.body || {}) as any;
      
      const result = await autolearn.run({
        symbol: body.symbol ?? 'BTC',
        fromDate: body.fromDate,  // YYYY-MM-DD
        toDate: body.toDate       // YYYY-MM-DD
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Check for model degradation and trigger rollback if needed
   * POST /api/fractal/admin/autolearn/monitor
   */
  fastify.post('/api/fractal/admin/autolearn/monitor', async () => {
    try {
      const { FractalAutoLearnMonitor } = await import('../bootstrap/fractal.autolearn.monitor.js');
      const monitor = new FractalAutoLearnMonitor();
      
      const result = await monitor.check('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get autolearn state
   * GET /api/fractal/admin/autolearn/state
   */
  fastify.get('/api/fractal/admin/autolearn/state', async () => {
    try {
      const { FractalAutoLearnService } = await import('../bootstrap/fractal.autolearn.service.js');
      const autolearn = new FractalAutoLearnService();
      
      const state = await autolearn.getState('BTC');
      return { ok: true, ...state };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get model registry (history of all versions)
   * GET /api/fractal/admin/autolearn/registry
   */
  fastify.get('/api/fractal/admin/autolearn/registry', async () => {
    try {
      const { FractalPromotionService } = await import('../bootstrap/fractal.promotion.service.js');
      const promo = new FractalPromotionService();
      
      const history = await promo.getHistory('BTC', 50);
      return { ok: true, count: history.length, models: history };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Manual rollback to last archived version
   * POST /api/fractal/admin/autolearn/rollback
   */
  fastify.post('/api/fractal/admin/autolearn/rollback', async () => {
    try {
      const { FractalPromotionService } = await import('../bootstrap/fractal.promotion.service.js');
      const promo = new FractalPromotionService();
      
      const result = await promo.rollback('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Manual retrain (creates new SHADOW version)
   * POST /api/fractal/admin/autolearn/retrain
   * Body: { symbol?, fromDate?, toDate? }
   */
  fastify.post('/api/fractal/admin/autolearn/retrain', async (request) => {
    try {
      const { FractalRetrainService } = await import('../bootstrap/fractal.retrain.service.js');
      const retrain = new FractalRetrainService();
      
      const body = (request.body || {}) as any;
      
      const result = await retrain.retrain({
        symbol: body.symbol ?? 'BTC',
        fromDate: body.fromDate,  // YYYY-MM-DD
        toDate: body.toDate       // YYYY-MM-DD
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Backfill ML dataset from historical data
   * POST /api/fractal/admin/backfill-dataset
   */
  fastify.post('/api/fractal/admin/backfill-dataset', async (request) => {
    try {
      const { FractalBackfillService } = await import('../bootstrap/fractal.backfill.service.js');
      const backfill = new FractalBackfillService();
      
      const body = (request.body || {}) as any;
      
      const config = {
        symbol: body.symbol ?? 'BTC',
        windowLen: body.windowLen ?? 60,
        horizonDays: body.horizonDays ?? 30,
        topK: body.topK ?? 25,
        minGapDays: body.minGapDays ?? 60,
        stepDays: body.stepDays ?? 7  // sample every 7 days
      };
      
      fastify.log.info({ config }, 'Starting dataset backfill');
      
      const result = await backfill.backfill(config);
      
      fastify.log.info({ result }, 'Backfill complete');
      
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 29.15: WALK-FORWARD TRADING EVALUATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run walk-forward trading evaluation
   * POST /api/fractal/admin/wf-trading-eval
   * Body: { symbol?, mlVersion?, evalStart?, evalEnd?, windowDays?, stepDays? }
   */
  fastify.post('/api/fractal/admin/wf-trading-eval', async (request) => {
    try {
      const { FractalWFTradingEvalService } = await import('../bootstrap/fractal.wf-trading-eval.service.js');
      const wfService = new FractalWFTradingEvalService();
      
      const body = (request.body || {}) as any;
      
      const result = await wfService.evaluate({
        symbol: body.symbol ?? 'BTC',
        mlVersion: body.mlVersion ?? 'ACTIVE',
        evalStart: new Date(body.evalStart ?? '2020-01-01'),
        evalEnd: new Date(body.evalEnd ?? new Date().toISOString().slice(0, 10)),
        windowDays: body.windowDays ?? 180,
        stepDays: body.stepDays ?? 90,
        purgeDays: body.purgeDays ?? 30
      });
      
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 29.18: RISK STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Get current risk state (equity, DD)
   * GET /api/fractal/admin/risk/state
   */
  fastify.get('/api/fractal/admin/risk/state', async () => {
    try {
      const { FractalRiskStateService } = await import('../bootstrap/fractal.risk-state.service.js');
      const riskService = new FractalRiskStateService();
      
      const state = await riskService.getDD('BTC');
      return { ok: true, symbol: 'BTC', ...state };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Reset risk state (equity back to 1)
   * POST /api/fractal/admin/risk/reset
   */
  fastify.post('/api/fractal/admin/risk/reset', async () => {
    try {
      const { FractalRiskStateService } = await import('../bootstrap/fractal.risk-state.service.js');
      const riskService = new FractalRiskStateService();
      
      const result = await riskService.reset('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 29.19: REGIME EXPOSURE TUNING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Tune regime exposure multipliers from backtest
   * POST /api/fractal/admin/tune-regime-exposure
   */
  fastify.post('/api/fractal/admin/tune-regime-exposure', async () => {
    try {
      const { FractalBacktestService } = await import('../backtest/fractal.backtest.service.js');
      const { FractalSettingsModel } = await import('../data/schemas/fractal-settings.schema.js');
      
      const backtest = new FractalBacktestService();
      
      // Run backtest to get regime report
      const result = await backtest.run({
        symbol: 'BTC',
        windowLen: 60,
        horizonDays: 30,
        topK: 25,
        minGapDays: 60,
        mlVersion: 'ACTIVE'
      });
      
      // Derive exposure multipliers from regime report
      const regimeReport = result.regimeReport || [];
      const sharpes = regimeReport.map(r => r.sharpe).sort((a, b) => a - b);
      const baseSharpe = sharpes.length ? sharpes[Math.floor(sharpes.length / 2)] : 1;
      
      const overrides = regimeReport
        .filter(r => r.count >= 20)
        .map(r => {
          let mult = baseSharpe > 0 ? (r.sharpe / baseSharpe) : 1;
          mult = Math.max(0.2, Math.min(1.2, mult));
          return { trend: r.trend, vol: r.vol, mult };
        });
      
      await FractalSettingsModel.updateOne(
        { symbol: 'BTC' },
        { $set: { 'regimeExposure.overrides': overrides, updatedAt: new Date() } },
        { upsert: true }
      );
      
      return { ok: true, overridesCount: overrides.length, overrides };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 29.20-29.24: POSITION LIFECYCLE + FEEDBACK + DRIFT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get current position state
   * GET /api/fractal/position
   */
  fastify.get('/api/fractal/position', async () => {
    try {
      const { FractalPositionService } = await import('../bootstrap/fractal.position.service.js');
      const { FractalSettleService } = await import('../bootstrap/fractal.settle.service.js');
      const { FractalRiskStateService } = await import('../bootstrap/fractal.risk-state.service.js');
      
      const pos = new FractalPositionService();
      const settle = new FractalSettleService();
      const riskSvc = new FractalRiskStateService();

      const position = await pos.get('BTC');
      const currentPrice = await settle.getLatestClose('BTC');

      if (currentPrice) {
        await pos.markToMarket({ symbol: 'BTC', currentPrice });
      }

      const updated = await pos.get('BTC');
      const risk = await riskSvc.getDD('BTC');

      return {
        ok: true,
        position: updated,
        currentPrice,
        risk: {
          equity: risk.equity,
          peakEquity: risk.peakEquity,
          ddAbs: risk.ddAbs
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Reset position state
   * POST /api/fractal/admin/position/reset
   */
  fastify.post('/api/fractal/admin/position/reset', async () => {
    try {
      const { FractalPositionService } = await import('../bootstrap/fractal.position.service.js');
      const pos = new FractalPositionService();
      
      await pos.reset('BTC');
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Settle position if due
   * POST /api/fractal/admin/settle
   */
  fastify.post('/api/fractal/admin/settle', async () => {
    try {
      const { FractalSettleService } = await import('../bootstrap/fractal.settle.service.js');
      const settle = new FractalSettleService();
      
      const res = await settle.settleIfDue('BTC', new Date());
      return res;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get recent feedback events
   * GET /api/fractal/admin/feedback/recent
   */
  fastify.get('/api/fractal/admin/feedback/recent', async (request) => {
    try {
      const { FractalFeedbackModel } = await import('../data/schemas/fractal-feedback.schema.js');
      
      const q = (request.query || {}) as any;
      const limit = Number(q.limit ?? 50);
      
      const rows = await FractalFeedbackModel.find({ symbol: 'BTC' })
        .sort({ settleTs: -1 })
        .limit(Math.min(200, limit))
        .lean();
      
      return { ok: true, count: rows.length, rows };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get online calibration buckets
   * GET /api/fractal/admin/online-calibration
   */
  fastify.get('/api/fractal/admin/online-calibration', async () => {
    try {
      const { FractalOnlineCalibrationService } = await import('../bootstrap/fractal.online-calibration.service.js');
      const calib = new FractalOnlineCalibrationService();
      
      const result = await calib.getCalibration('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get dataset from feedback (self-learning dataset)
   * GET /api/fractal/admin/dataset/feedback
   */
  fastify.get('/api/fractal/admin/dataset/feedback', async (request) => {
    try {
      const { FractalFeedbackModel } = await import('../data/schemas/fractal-feedback.schema.js');
      
      const q = (request.query || {}) as any;
      const limit = Number(q.limit ?? 2000);
      
      const rows = await FractalFeedbackModel.find({ symbol: 'BTC' })
        .sort({ settleTs: -1 })
        .limit(Math.min(20000, limit))
        .lean();

      return {
        ok: true,
        count: rows.length,
        rows: rows.map(r => ({
          t: (r.openTs as Date).toISOString().slice(0, 10),
          ...(r.features as any || {}),
          y_up: (r.label as any)?.y_up ?? 0,
          y_return: (r.label as any)?.y_return ?? 0
        }))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Check for drift
   * POST /api/fractal/admin/drift/check
   */
  fastify.post('/api/fractal/admin/drift/check', async (request) => {
    try {
      const { FractalDriftService } = await import('../bootstrap/fractal.drift.service.js');
      const drift = new FractalDriftService();
      
      const body = (request.body || {}) as any;
      
      const res = await drift.compute('BTC', {
        recentN: body.recentN,
        baselineN: body.baselineN,
        highConfLo: body.highConfLo
      });
      
      return { ok: true, report: res };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get drift history
   * GET /api/fractal/admin/drift/history
   */
  fastify.get('/api/fractal/admin/drift/history', async (request) => {
    try {
      const { FractalDriftService } = await import('../bootstrap/fractal.drift.service.js');
      const drift = new FractalDriftService();
      
      const q = (request.query || {}) as any;
      const limit = Number(q.limit ?? 20);
      
      const history = await drift.getHistory('BTC', limit);
      return { ok: true, count: history.length, history };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Full monitor with drift integration
   * POST /api/fractal/admin/autolearn/monitor-drift
   */
  fastify.post('/api/fractal/admin/autolearn/monitor-drift', async () => {
    try {
      const { FractalDriftService } = await import('../bootstrap/fractal.drift.service.js');
      const { FractalAutoLearnService } = await import('../bootstrap/fractal.autolearn.service.js');
      const { FractalPromotionService } = await import('../bootstrap/fractal.promotion.service.js');
      const { FractalSettingsModel } = await import('../data/schemas/fractal-settings.schema.js');
      
      const drift = new FractalDriftService();
      const autolearn = new FractalAutoLearnService();
      const promo = new FractalPromotionService();
      
      const driftReport = await drift.compute('BTC', { recentN: 120, baselineN: 720, highConfLo: 0.65 });

      if (driftReport.drift.level === 'CRITICAL') {
        await promo.rollback('BTC');
        await FractalSettingsModel.updateOne(
          { symbol: 'BTC' },
          { $set: { promotionFrozenUntil: new Date(Date.now() + 14 * 86400000) } }
        );
        return { ok: true, action: 'ROLLBACK', drift: driftReport };
      }

      if (driftReport.drift.level === 'DEGRADED') {
        const retrainResult = await autolearn.run({ symbol: 'BTC', reason: 'DRIFT_DEGRADED' });
        return { ok: true, action: 'RETRAIN', drift: driftReport, retrain: retrainResult };
      }

      if (driftReport.drift.level === 'WARN') {
        await FractalSettingsModel.updateOne(
          { symbol: 'BTC' },
          { $set: { promotionFrozenUntil: new Date(Date.now() + 7 * 86400000) } }
        );
        return { ok: true, action: 'FREEZE_PROMOTION', drift: driftReport };
      }

      return { ok: true, action: 'NONE', drift: driftReport };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 29.25-29.32: AUTO-WINDOW + AUTOPILOT + ENSEMBLE + HORIZON
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Auto-select best training window
   * POST /api/fractal/admin/autolearn/auto-window
   */
  fastify.post('/api/fractal/admin/autolearn/auto-window', async () => {
    try {
      const { FractalAutopilotService } = await import('../bootstrap/fractal.autopilot.service.js');
      const autopilot = new FractalAutopilotService();
      
      const result = await autopilot.autoSelectTrainWindow('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Run full autopilot cycle
   * POST /api/fractal/admin/autopilot/run
   */
  fastify.post('/api/fractal/admin/autopilot/run', async () => {
    try {
      const { FractalAutopilotService } = await import('../bootstrap/fractal.autopilot.service.js');
      const autopilot = new FractalAutopilotService();
      
      const result = await autopilot.run('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get autopilot run history
   * GET /api/fractal/admin/autopilot/runs
   */
  fastify.get('/api/fractal/admin/autopilot/runs', async (request) => {
    try {
      const { FractalAutopilotService } = await import('../bootstrap/fractal.autopilot.service.js');
      const autopilot = new FractalAutopilotService();
      
      const q = (request.query || {}) as any;
      const limit = Number(q.limit ?? 20);
      
      const history = await autopilot.getHistory('BTC', limit);
      return { ok: true, count: history.length, runs: history };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Build ensemble from trained windows
   * POST /api/fractal/admin/ensemble/build
   */
  fastify.post('/api/fractal/admin/ensemble/build', async () => {
    try {
      const { FractalEnsembleService } = await import('../bootstrap/fractal.ensemble.service.js');
      const ensemble = new FractalEnsembleService();
      
      const groupId = `ENS_${new Date().toISOString()}`;
      const result = await ensemble.buildEnsemble('BTC', groupId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get active ensemble
   * GET /api/fractal/admin/ensemble/active
   */
  fastify.get('/api/fractal/admin/ensemble/active', async () => {
    try {
      const { FractalEnsembleService } = await import('../bootstrap/fractal.ensemble.service.js');
      const ensemble = new FractalEnsembleService();
      
      const result = await ensemble.getActiveEnsemble('BTC');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Disable ensemble mode
   * POST /api/fractal/admin/ensemble/disable
   */
  fastify.post('/api/fractal/admin/ensemble/disable', async () => {
    try {
      const { FractalEnsembleService } = await import('../bootstrap/fractal.ensemble.service.js');
      const ensemble = new FractalEnsembleService();
      
      await ensemble.disableEnsemble('BTC');
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get training window candidates
   * GET /api/fractal/admin/window-candidates
   */
  fastify.get('/api/fractal/admin/window-candidates', async () => {
    try {
      const { FractalAutoWindowService } = await import('../bootstrap/fractal.auto-window.service.js');
      const autoWindow = new FractalAutoWindowService();
      
      const result = await autoWindow.buildCandidates('BTC');
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get model explain (feature importances)
   * GET /api/fractal/admin/model/explain
   */
  fastify.get('/api/fractal/admin/model/explain', async () => {
    try {
      const { FractalModelRegistryModel } = await import('../data/schemas/fractal-model-registry.schema.js');
      
      const active = await FractalModelRegistryModel.findOne({ symbol: 'BTC', status: 'ACTIVE' }).lean() as any;
      
      if (!active) {
        return { ok: false, reason: 'NO_ACTIVE_MODEL' };
      }
      
      return {
        ok: true,
        version: active.version,
        features: active.mlExplain ?? { featureNames: [], importances: [] }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Score a specific model version
   * GET /api/fractal/admin/model/score?version=xxx
   */
  fastify.get('/api/fractal/admin/model/score', async (request) => {
    try {
      const { FractalWindowEvalService } = await import('../bootstrap/fractal.window-eval.service.js');
      const windowEval = new FractalWindowEvalService();
      
      const q = (request.query || {}) as any;
      const version = q.version;
      
      if (!version) {
        const result = await windowEval.scoreActive('BTC');
        return { ok: true, version: 'ACTIVE', ...result };
      }
      
      const result = await windowEval.scoreWindow('BTC', version);
      return { ok: true, version, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get Bayesian calibration with credible intervals
   * GET /api/fractal/admin/calibration/bayesian?modelKey=BTC:30
   */
  fastify.get('/api/fractal/admin/calibration/bayesian', async (request) => {
    try {
      const { FractalOnlineCalibrationService } = await import('../bootstrap/fractal.online-calibration.service.js');
      const calib = new FractalOnlineCalibrationService();
      
      const q = (request.query || {}) as any;
      const modelKey = q.modelKey || 'BTC';
      
      const result = await calib.getCalibration(modelKey);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get adaptive horizon settings
   * GET /api/fractal/admin/adaptive-horizon
   */
  fastify.get('/api/fractal/admin/adaptive-horizon', async () => {
    try {
      const settings = await FractalSettingsModel.findOne({ symbol: 'BTC' }).lean() as any;
      
      return {
        ok: true,
        adaptiveHorizon: settings?.adaptiveHorizon ?? {
          enabled: true,
          horizons: [14, 30, 60],
          policy: 'STABILITY',
          fixed: 30,
          minSamplesPerHorizon: 80,
          minStability: 0.15
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Update adaptive horizon settings
   * POST /api/fractal/admin/adaptive-horizon
   */
  fastify.post('/api/fractal/admin/adaptive-horizon', async (request) => {
    try {
      const body = (request.body || {}) as any;
      
      await FractalSettingsModel.updateOne(
        { symbol: 'BTC' },
        { $set: { adaptiveHorizon: body, updatedAt: new Date() } },
        { upsert: true }
      );
      
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Run autolearn for all horizons
   * POST /api/fractal/admin/autolearn/run-all-horizons
   */
  fastify.post('/api/fractal/admin/autolearn/run-all-horizons', async () => {
    try {
      const { FractalSettingsModel } = await import('../data/schemas/fractal-settings.schema.js');
      const settings = await FractalSettingsModel.findOne({ symbol: 'BTC' }).lean() as any;
      const horizons = settings?.adaptiveHorizon?.horizons ?? [14, 30, 60];
      
      const results: any[] = [];
      
      for (const h of horizons) {
        // In full implementation, this would call retrain service per horizon
        results.push({
          horizon: h,
          modelKey: `BTC:${h}`,
          status: 'QUEUED',
          message: `Training for horizon ${h} days would be triggered here`
        });
      }
      
      return { ok: true, horizons: results };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Check drift for specific horizon
   * POST /api/fractal/admin/drift/check-horizon
   */
  fastify.post('/api/fractal/admin/drift/check-horizon', async (request) => {
    try {
      const { FractalDriftService } = await import('../bootstrap/fractal.drift.service.js');
      const drift = new FractalDriftService();
      
      const body = (request.body || {}) as any;
      const horizonDays = Number(body.horizonDays ?? 30);
      const modelKey = `BTC:${horizonDays}`;
      
      // For per-horizon drift, we'd filter feedback by modelKey
      // For now, use standard compute
      const result = await drift.compute('BTC', {
        recentN: body.recentN,
        baselineN: body.baselineN,
        highConfLo: body.highConfLo
      });
      
      return { ok: true, modelKey, horizonDays, report: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Check drift for all horizons
   * POST /api/fractal/admin/drift/check-all-horizons
   */
  fastify.post('/api/fractal/admin/drift/check-all-horizons', async () => {
    try {
      const { FractalDriftService } = await import('../bootstrap/fractal.drift.service.js');
      const { FractalSettingsModel } = await import('../data/schemas/fractal-settings.schema.js');
      const drift = new FractalDriftService();
      
      const settings = await FractalSettingsModel.findOne({ symbol: 'BTC' }).lean() as any;
      const horizons = settings?.adaptiveHorizon?.horizons ?? [14, 30, 60];
      
      const reports: any[] = [];
      
      for (const h of horizons) {
        const report = await drift.compute('BTC', { recentN: 120, baselineN: 720, highConfLo: 0.65 });
        reports.push({
          horizonDays: h,
          modelKey: `BTC:${h}`,
          drift: report.drift,
          action: report.action
        });
      }
      
      // Find worst level
      const levels = ['OK', 'WARN', 'DEGRADED', 'CRITICAL'];
      const worstIdx = Math.max(...reports.map(r => levels.indexOf(r.drift?.level ?? 'OK')));
      const systemLevel = levels[worstIdx];
      
      return { ok: true, systemLevel, reports };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] Routes registered (FULL ML Pipeline: Blocks 16-29.32)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34: TIME-TRAVEL SIMULATION ENGINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run time-travel simulation with experiment support
   * POST /api/fractal/admin/sim/run
   * Body: { from, to, stepDays, mode, experiment, costs }
   * Experiments: E0, R1, R2, R3, D1, D2, D3, H1, H2, H3, D3_R3_H3, etc.
   */
  fastify.post('/api/fractal/admin/sim/run', async (request) => {
    try {
      const { FractalSimulationRunner } = await import('../sim/sim.runner.js');
      const sim = new FractalSimulationRunner();
      
      const body = (request.body || {}) as any;
      
      const result = await sim.run({
        symbol: body.symbol || 'BTC',
        from: body.from || '2017-01-01',
        to: body.to || '2026-01-01',
        stepDays: body.stepDays ?? 7,
        mode: body.mode || 'FROZEN',
        horizons: body.horizons,
        costs: body.costs,
        experiment: body.experiment || 'E0'
      });
      
      // Return full telemetry response
      return {
        ok: result.ok,
        experiment: result.experiment,
        experimentDescription: result.experimentDescription,
        overrides: result.overrides,
        summary: result.summary,
        telemetry: result.telemetry,
        yearlyBreakdown: result.yearlyBreakdown,
        regimeBreakdown: result.regimeBreakdown,
        horizonBreakdown: result.horizonBreakdown,
        ddAttribution: result.ddAttribution,
        warnings: result.warnings,
        error: result.error,
        equityCurveLength: result.equityCurve.length,
        // Sample every 10th point for overview
        equityCurveSample: result.equityCurve.filter((_, i) => i % 10 === 0).map(p => ({
          ts: p.ts,
          equity: Math.round(p.equity * 10000) / 10000,
          price: p.price ? Math.round(p.price) : null,
          position: p.position
        })),
        // Include recent events (last 100)
        recentEvents: result.events.slice(-100)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Run quick simulation (last 2 years)
   * GET /api/fractal/admin/sim/quick?experiment=E0
   */
  fastify.get('/api/fractal/admin/sim/quick', async (request) => {
    try {
      const { FractalSimulationRunner } = await import('../sim/sim.runner.js');
      const sim = new FractalSimulationRunner();
      
      const q = (request.query || {}) as any;
      const experiment = q.experiment || 'E0';
      
      const now = new Date();
      const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 86400000);
      
      const result = await sim.run({
        symbol: 'BTC',
        from: twoYearsAgo.toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
        stepDays: 7,
        mode: 'FROZEN',
        experiment
      });
      
      return {
        ok: result.ok,
        experiment: result.experiment,
        experimentDescription: result.experimentDescription,
        summary: result.summary,
        telemetry: result.telemetry,
        yearlyBreakdown: result.yearlyBreakdown,
        ddAttribution: result.ddAttribution,
        warnings: result.warnings,
        error: result.error
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: List available experiments
   * GET /api/fractal/admin/sim/experiments
   */
  fastify.get('/api/fractal/admin/sim/experiments', async () => {
    try {
      const { getExperimentDescription } = await import('../sim/sim.experiments.js');
      
      const experiments = [
        'E0', 'R1', 'R2', 'R3',
        'D1', 'D2', 'D3',
        'A1', 'A2', 'A3',
        'H1', 'H2', 'H3',
        'D3_R3', 'D3_H3', 'R3_H3', 'D3_R3_H3'
      ];
      
      return {
        ok: true,
        experiments: experiments.map(e => ({
          id: e,
          description: getExperimentDescription(e as any)
        }))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Run batch experiments (multiple experiments in one call)
   * POST /api/fractal/admin/sim/batch
   * Body: { from, to, experiments: ['E0', 'D3', 'R3'] }
   */
  fastify.post('/api/fractal/admin/sim/batch', async (request) => {
    try {
      const { FractalSimulationRunner } = await import('../sim/sim.runner.js');
      const sim = new FractalSimulationRunner();
      
      const body = (request.body || {}) as any;
      const experiments = body.experiments || ['E0'];
      
      const results: any[] = [];
      
      for (const exp of experiments) {
        const result = await sim.run({
          symbol: body.symbol || 'BTC',
          from: body.from || '2017-01-01',
          to: body.to || '2026-01-01',
          stepDays: body.stepDays ?? 7,
          mode: body.mode || 'AUTOPILOT',
          experiment: exp
        });
        
        results.push({
          experiment: exp,
          experimentDescription: result.experimentDescription,
          ok: result.ok,
          summary: {
            sharpe: Math.round(result.summary.sharpe * 1000) / 1000,
            maxDD: Math.round(result.summary.maxDD * 10000) / 10000,
            cagr: Math.round(result.summary.cagr * 10000) / 10000,
            tradesOpened: result.summary.tradesOpened,
            retrainCount: result.summary.retrainCount,
            rollbackCount: result.summary.rollbackCount
          },
          telemetry: {
            hardKills: result.telemetry.hardKills,
            softKills: result.telemetry.softKills,
            horizonChanges: result.telemetry.horizonChanges,
            driftChanges: result.telemetry.driftChanges
          },
          ddAttribution: result.ddAttribution?.maxDDPeriod
        });
      }
      
      // Sort by Sharpe desc
      results.sort((a, b) => (b.summary?.sharpe || 0) - (a.summary?.sharpe || 0));
      
      return {
        ok: true,
        count: results.length,
        results,
        bestExperiment: results[0]?.experiment || null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.2: RISK SURFACE SWEEP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run risk parameter sweep (grid search)
   * POST /api/fractal/admin/sim/risk-sweep
   * Body: { from, to, soft: [0.06, 0.08...], hard: [0.15, 0.18...], taper: [0.7, 1.0], maxRuns: 60 }
   */
  fastify.post('/api/fractal/admin/sim/risk-sweep', async (request) => {
    try {
      const { SimSweepService } = await import('../sim/sim.sweep.service.js');
      const sweep = new SimSweepService();
      
      const body = (request.body || {}) as any;
      
      const result = await sweep.riskSweep({
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2019-01-01',
        to: body.to ?? new Date().toISOString().slice(0, 10),
        soft: body.soft ?? [0.06, 0.08, 0.10, 0.12],
        hard: body.hard ?? [0.15, 0.18, 0.20, 0.22, 0.25],
        taper: body.taper ?? [0.7, 0.85, 1.0],
        maxRuns: body.maxRuns ?? 60,
        mode: body.mode ?? 'AUTOPILOT',
        stepDays: body.stepDays ?? 7
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Run quick risk sweep (5 years, coarse grid)
   * GET /api/fractal/admin/sim/risk-sweep/quick
   */
  fastify.get('/api/fractal/admin/sim/risk-sweep/quick', async () => {
    try {
      const { SimSweepService } = await import('../sim/sim.sweep.service.js');
      const sweep = new SimSweepService();
      
      const result = await sweep.quickSweep({});
      
      return {
        ok: result.ok,
        runs: result.runs,
        duration: result.duration,
        bestConfig: result.bestConfig,
        top10: result.top10,
        heatmap: result.heatmap
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Run full risk sweep (2017-present, fine grid)
   * POST /api/fractal/admin/sim/risk-sweep/full
   */
  fastify.post('/api/fractal/admin/sim/risk-sweep/full', async (request) => {
    try {
      const { SimSweepService } = await import('../sim/sim.sweep.service.js');
      const sweep = new SimSweepService();
      
      const body = (request.body || {}) as any;
      
      const result = await sweep.fullSweep({
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2017-01-01',
        to: body.to ?? new Date().toISOString().slice(0, 10)
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.3: DD ATTRIBUTION ENGINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run simulation with DD Attribution
   * POST /api/fractal/admin/sim/attribution
   * Body: { from, to, experiment }
   * Returns detailed breakdown of WHERE drawdowns originate
   */
  fastify.post('/api/fractal/admin/sim/attribution', async (request) => {
    try {
      const { FractalSimulationRunner } = await import('../sim/sim.runner.js');
      const sim = new FractalSimulationRunner();
      
      const body = (request.body || {}) as any;
      
      const result = await sim.run({
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2017-01-01',
        to: body.to ?? new Date().toISOString().slice(0, 10),
        stepDays: body.stepDays ?? 7,
        mode: body.mode ?? 'AUTOPILOT',
        experiment: body.experiment ?? 'E0',
        attribution: true  // Enable DD attribution
      });
      
      return {
        ok: result.ok,
        experiment: result.experiment,
        summary: {
          sharpe: Math.round(result.summary.sharpe * 1000) / 1000,
          maxDD: Math.round(result.summary.maxDD * 10000) / 10000,
          cagr: Math.round(result.summary.cagr * 10000) / 10000,
          trades: result.summary.tradesOpened
        },
        fullDDAttribution: result.fullDDAttribution,
        warnings: result.warnings,
        error: result.error
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Quick DD Attribution (last 5 years, E0)
   * GET /api/fractal/admin/sim/attribution/quick
   */
  fastify.get('/api/fractal/admin/sim/attribution/quick', async () => {
    try {
      const { FractalSimulationRunner } = await import('../sim/sim.runner.js');
      const sim = new FractalSimulationRunner();
      
      const now = new Date();
      const fiveYearsAgo = new Date(now.getTime() - 5 * 365 * 86400000);
      
      const result = await sim.run({
        symbol: 'BTC',
        from: fiveYearsAgo.toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
        stepDays: 7,
        mode: 'AUTOPILOT',
        experiment: 'E0',
        attribution: true
      });
      
      // Return focused attribution data
      const attr = result.fullDDAttribution;
      
      return {
        ok: result.ok,
        summary: {
          sharpe: Math.round(result.summary.sharpe * 1000) / 1000,
          maxDD: Math.round(result.summary.maxDD * 10000) / 10000,
          trades: result.summary.tradesOpened
        },
        attribution: attr ? {
          totalSegments: attr.totalSegments,
          peakDD: attr.peakDD,
          avgDD: attr.avgDD,
          byYear: attr.byYear,
          byRegime: attr.byRegime,
          byHorizon: attr.byHorizon,
          bySide: attr.bySide,
          byConfidenceBucket: attr.byConfidenceBucket,
          dominantPattern: attr.dominantPattern,
          insights: attr.insights,
          worstSegments: attr.worstSegments?.slice(0, 5)
        } : null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.4: CONFIDENCE GATING SWEEP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run confidence gate parameter sweep
   * POST /api/fractal/admin/sim/gate-sweep
   * Body: { from, to, enter: [0.25, 0.30, 0.35], full: [0.60, 0.65, 0.70], flip: [0.45, 0.55] }
   */
  fastify.post('/api/fractal/admin/sim/gate-sweep', async (request) => {
    try {
      const { GateSweepService } = await import('../sim/sim.gate-sweep.service.js');
      const sweep = new GateSweepService();
      
      const body = (request.body || {}) as any;
      
      const result = await sweep.gateSweep({
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2017-01-01',
        to: body.to ?? new Date().toISOString().slice(0, 10),
        enter: body.enter ?? [0.25, 0.30, 0.35],
        full: body.full ?? [0.60, 0.65, 0.70],
        flip: body.flip ?? [0.45, 0.55],
        softGate: body.softGate ?? true,
        maxRuns: body.maxRuns ?? 30,
        mode: body.mode ?? 'AUTOPILOT'
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Quick gate sweep (5 years, default grid)
   * GET /api/fractal/admin/sim/gate-sweep/quick
   */
  fastify.get('/api/fractal/admin/sim/gate-sweep/quick', async () => {
    try {
      const { GateSweepService } = await import('../sim/sim.gate-sweep.service.js');
      const sweep = new GateSweepService();
      
      const result = await sweep.quickGateSweep({});
      
      return {
        ok: result.ok,
        runs: result.runs,
        duration: result.duration,
        bestConfig: result.bestConfig,
        baselineComparison: result.baselineComparison,
        top10: result.top10
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Run simulation with specific gate config
   * POST /api/fractal/admin/sim/gated
   * Body: { from, to, gateConfig: { minEnterConfidence, minFullSizeConfidence, minFlipConfidence, softGate } }
   */
  fastify.post('/api/fractal/admin/sim/gated', async (request) => {
    try {
      const { FractalSimulationRunner } = await import('../sim/sim.runner.js');
      const sim = new FractalSimulationRunner();
      
      const body = (request.body || {}) as any;
      
      const result = await sim.run({
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2017-01-01',
        to: body.to ?? new Date().toISOString().slice(0, 10),
        stepDays: body.stepDays ?? 7,
        mode: body.mode ?? 'AUTOPILOT',
        experiment: body.experiment ?? 'E0',
        gateConfig: body.gateConfig ? {
          enabled: true,
          minEnterConfidence: body.gateConfig.minEnter ?? 0.35,
          minFullSizeConfidence: body.gateConfig.minFull ?? 0.65,
          minFlipConfidence: body.gateConfig.minFlip ?? 0.45,
          softGate: body.gateConfig.softGate ?? true
        } : undefined
      });
      
      // Extract gate telemetry
      const events = result.events || [];
      const gateBlockEnter = events.filter(e => e.type === 'GATE_BLOCK_ENTER').length;
      const gateBlockFlip = events.filter(e => e.type === 'GATE_BLOCK_FLIP').length;
      const confScaleEvents = events.filter(e => e.type === 'CONF_SCALE');
      const avgConfScale = confScaleEvents.length > 0
        ? confScaleEvents.reduce((a, e) => a + (e.meta?.scale ?? 1), 0) / confScaleEvents.length
        : 1;
      
      return {
        ok: result.ok,
        summary: {
          sharpe: Math.round(result.summary.sharpe * 1000) / 1000,
          maxDD: Math.round(result.summary.maxDD * 10000) / 10000,
          cagr: Math.round(result.summary.cagr * 10000) / 10000,
          trades: result.summary.tradesOpened,
          finalEquity: Math.round(result.summary.finalEquity * 10000) / 10000
        },
        gateTelemetry: {
          gateBlockEnter,
          gateBlockFlip,
          avgConfScale: Math.round(avgConfScale * 1000) / 1000,
          softKills: result.telemetry?.softKills ?? 0,
          hardKills: result.telemetry?.hardKills ?? 0
        },
        warnings: result.warnings,
        error: result.error
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.5: GATE × RISK COMBO SWEEP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run Gate × Risk combo sweep
   * POST /api/fractal/admin/sim/combo-sweep
   * Body: { from, to, gateConfig: {...}, soft: [...], hard: [...], taper: [...] }
   */
  fastify.post('/api/fractal/admin/sim/combo-sweep', async (request) => {
    try {
      const { SimSweepService } = await import('../sim/sim.sweep.service.js');
      const sweep = new SimSweepService();
      
      const body = (request.body || {}) as any;
      
      // Default gate config (best from 34.4)
      const gateConfig = {
        enabled: true,
        minEnterConfidence: body.gateConfig?.minEnter ?? 0.25,
        minFullSizeConfidence: body.gateConfig?.minFull ?? 0.70,
        minFlipConfidence: body.gateConfig?.minFlip ?? 0.40,
        softGate: body.gateConfig?.softGate ?? true
      };
      
      const result = await sweep.gateRiskSweep({
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2017-01-01',
        to: body.to ?? new Date().toISOString().slice(0, 10),
        gateConfig,
        soft: body.soft ?? [0.08, 0.10, 0.12],
        hard: body.hard ?? [0.18, 0.20, 0.22],
        taper: body.taper ?? [0.85, 0.90, 1.00],
        maxRuns: body.maxRuns ?? 30,
        mode: body.mode ?? 'AUTOPILOT'
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Quick combo sweep with optimal gate + risk grid
   * GET /api/fractal/admin/sim/combo-sweep/quick
   */
  fastify.get('/api/fractal/admin/sim/combo-sweep/quick', async () => {
    try {
      const { SimSweepService } = await import('../sim/sim.sweep.service.js');
      const sweep = new SimSweepService();
      
      const now = new Date();
      const fiveYearsAgo = new Date(now.getTime() - 5 * 365 * 86400000);
      
      const result = await sweep.gateRiskSweep({
        symbol: 'BTC',
        from: fiveYearsAgo.toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
        gateConfig: {
          enabled: true,
          minEnterConfidence: 0.25,
          minFullSizeConfidence: 0.70,
          minFlipConfidence: 0.40,
          softGate: true
        },
        soft: [0.10, 0.12],
        hard: [0.18, 0.20],
        taper: [0.85, 1.0],
        maxRuns: 10,
        mode: 'AUTOPILOT'
      });
      
      return {
        ok: result.ok,
        runs: result.runs,
        duration: result.duration,
        gateConfig: result.gateConfig,
        bestConfig: result.bestConfig,
        top5: result.top10?.slice(0, 5)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.6: OUT-OF-SAMPLE (OOS) VALIDATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run OOS Validation with fixed config
   * POST /api/fractal/admin/sim/oos
   * Body: { symbol?, mode?, fixed?, stepDays? }
   * 
   * Tests the FIXED config across 3 independent time windows:
   * - OOS_2019_2022: Train 2014-2018, Test 2019-2022
   * - OOS_2021_2023: Train 2014-2020, Test 2021-2023
   * - OOS_2023_2026: Train 2014-2022, Test 2023-2026
   * 
   * Pass criteria: Sharpe ≥ 0.45, DD ≤ 35%, Trades ≥ 15
   * Overall pass: At least 2 out of 3 splits must pass
   */
  fastify.post('/api/fractal/admin/sim/oos', async (request) => {
    try {
      const { SimOosService } = await import('../sim/sim.oos.service.js');
      const oosService = new SimOosService();
      
      const body = (request.body || {}) as any;
      
      const result = await oosService.runOos({
        symbol: body.symbol ?? 'BTC',
        mode: body.mode ?? 'FROZEN',
        fixed: body.fixed,
        stepDays: body.stepDays ?? 7
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get OOS splits info (without running)
   * GET /api/fractal/admin/sim/oos/info
   */
  fastify.get('/api/fractal/admin/sim/oos/info', async () => {
    try {
      const { OOS_SPLITS, FIXED_CONFIG, OOS_THRESHOLDS } = await import('../sim/sim.oos.splits.js');
      
      return {
        ok: true,
        description: 'BLOCK 34.6 — Out-of-Sample Validation Harness',
        purpose: 'Validates that found config is not overfit by testing on 3 independent time windows',
        fixedConfig: FIXED_CONFIG,
        thresholds: OOS_THRESHOLDS,
        splits: OOS_SPLITS.map(s => ({
          name: s.name,
          trainFrom: s.train[0],
          trainTo: s.train[1],
          testFrom: s.test[0],
          testTo: s.test[1]
        })),
        passRule: 'At least 2 out of 3 splits must pass all thresholds'
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.17: FULL UNIFIED WALK-FORWARD TEST
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run Full Unified Walk-Forward Test (2014-2026)
   * POST /api/fractal/admin/sim/full
   * Body: { start?, end?, symbol?, stepDays? }
   * 
   * Single continuous run with all guards:
   * - Bull SHORT Block (34.16A)
   * - Crash Guard (34.14)
   * - Bubble Guard (34.15)
   * - Relative Signal Mode (34.11)
   * - Risk Layer
   */
  fastify.post('/api/fractal/admin/sim/full', async (request) => {
    try {
      const { SimFullService } = await import('../sim/sim.full.service.js');
      const fullService = new SimFullService();
      
      const body = (request.body || {}) as any;
      
      const result = await fullService.runFull({
        start: body.start ?? '2014-01-01',
        end: body.end ?? '2026-02-15',
        symbol: body.symbol ?? 'BTC',
        stepDays: body.stepDays ?? 7
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Run Monte Carlo Trade Reshuffle (BLOCK 35.1 + 35.3)
   * POST /api/fractal/admin/sim/montecarlo
   * Body: { iterations?, seed?, mode?, blockSize?, start?, end?, symbol?, stepDays? }
   * 
   * mode: 'permute' (default) - full random shuffle
   *       'block' - block bootstrap (preserves local regime structure)
   * blockSize: 3-5 (default 3, only for block mode)
   * 
   * Validates system robustness by reshuffling trade order.
   * Pass criteria:
   * - sharpe.p05 >= 0.30
   * - maxDD.p95 <= 0.45
   */
  fastify.post('/api/fractal/admin/sim/montecarlo', async (request) => {
    try {
      const { SimFullService } = await import('../sim/sim.full.service.js');
      const { runMonteCarlo } = await import('../sim/sim.montecarlo.js');
      
      const body = (request.body || {}) as any;
      const iterations = Number(body.iterations ?? 1000);
      const seed = body.seed != null ? Number(body.seed) : undefined;
      const mode = (body.mode === 'block' ? 'block' : 'permute') as 'permute' | 'block';
      const blockSize = Number(body.blockSize ?? 3);
      
      // Run full simulation to get trades
      const fullService = new SimFullService();
      const sim = await fullService.runFull({
        start: body.start ?? '2014-01-01',
        end: body.end ?? '2026-02-15',
        symbol: body.symbol ?? 'BTC',
        stepDays: body.stepDays ?? 7
      });
      
      // Run Monte Carlo on trades
      const mc = runMonteCarlo({
        trades: sim.trades.map(t => ({ netReturn: t.netReturn })),
        iterations,
        seed,
        initialEquity: 1.0,
        mode,
        blockSize
      });
      
      return {
        ok: true,
        simSummary: {
          sharpe: sim.metrics.sharpe,
          maxDD: sim.metrics.maxDD,
          totalTrades: sim.metrics.totalTrades,
          finalEquity: sim.metrics.finalEquity
        },
        monteCarlo: mc
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.7: SIGNAL SURFACE SWEEP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run Signal Surface Sweep
   * POST /api/fractal/admin/sim/signal-sweep
   * Body: { testWindow: { from, to }, momentum?, similarity?, minMatches?, stepDays? }
   * 
   * Sweeps signal generation parameters to find sweet spot:
   * - momentum threshold: [0.01, 0.015, 0.02, 0.025, 0.03]
   * - similarity threshold: [0.60, 0.65, 0.70, 0.75]
   * - minMatches: [5, 10, 15]
   * 
   * Risk/Gate are FROZEN. Only Signal Layer is explored.
   */
  fastify.post('/api/fractal/admin/sim/signal-sweep', async (request) => {
    try {
      const { SignalSweepService } = await import('../sim/sim.signal-sweep.service.js');
      const sweepService = new SignalSweepService();
      
      const body = (request.body || {}) as any;
      
      // Default to 2019-2022 (the split with best potential)
      const testWindow = body.testWindow ?? {
        from: '2019-01-01',
        to: '2022-12-31'
      };
      
      const result = await sweepService.sweep({
        testWindow,
        momentum: body.momentum,
        similarity: body.similarity,
        minMatches: body.minMatches,
        stepDays: body.stepDays ?? 7
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Quick Signal Sweep (fewer configs, faster)
   * GET /api/fractal/admin/sim/signal-sweep/quick
   */
  fastify.get('/api/fractal/admin/sim/signal-sweep/quick', async () => {
    try {
      const { SignalSweepService } = await import('../sim/sim.signal-sweep.service.js');
      const sweepService = new SignalSweepService();
      
      // Quick sweep with reduced grid
      const result = await sweepService.sweep({
        testWindow: { from: '2019-01-01', to: '2022-12-31' },
        momentum: [0.01, 0.02, 0.03],       // 3 values
        similarity: [0.65, 0.70],            // 2 values
        minMatches: [10],                    // 1 value
        stepDays: 7
      });
      
      return {
        ok: result.ok,
        totalConfigs: result.totalConfigs,
        passedConfigs: result.passedConfigs,
        bestConfig: result.bestConfig,
        top5: result.top5,
        surfaceAnalysis: result.surfaceAnalysis
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get Signal Sweep info
   * GET /api/fractal/admin/sim/signal-sweep/info
   */
  fastify.get('/api/fractal/admin/sim/signal-sweep/info', async () => {
    try {
      const { DEFAULT_SWEEP_PARAMS, SIGNAL_THRESHOLDS } = await import('../sim/sim.signal-sweep.service.js');
      const { FIXED_CONFIG } = await import('../sim/sim.oos.splits.js');
      
      return {
        ok: true,
        description: 'BLOCK 34.7 — Signal Surface Sweep',
        purpose: 'Find optimal signal generation parameters while keeping risk/gate frozen',
        frozenConfig: {
          risk: FIXED_CONFIG.risk,
          gate: FIXED_CONFIG.gate
        },
        sweepParams: DEFAULT_SWEEP_PARAMS,
        thresholds: SIGNAL_THRESHOLDS,
        totalConfigs: DEFAULT_SWEEP_PARAMS.momentum.length * 
                      DEFAULT_SWEEP_PARAMS.similarity.length * 
                      DEFAULT_SWEEP_PARAMS.minMatches.length,
        whatWeLookFor: {
          trades: '≥ 20 on 3-year window',
          sharpe: '≥ 0.45',
          maxDD: '≤ 35%',
          winRate: '≥ 52%'
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 34.9: FRACTAL SIGNAL SWEEP (Pattern-Based)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run Fractal Signal Sweep (uses FractalSignalBuilder)
   * POST /api/fractal/admin/sim/fractal-sweep
   * Body: { testWindow: { from, to }, windowLen?, minSimilarity?, minMatches?, neutralBand?, horizonDays?, stepDays? }
   */
  fastify.post('/api/fractal/admin/sim/fractal-sweep', async (request) => {
    try {
      const { FractalSignalSweepService } = await import('../sim/sim.fractal-sweep.service.js');
      const sweepService = new FractalSignalSweepService();

      const body = (request.body || {}) as any;

      const testWindow = body.testWindow ?? {
        from: '2019-01-01',
        to: '2024-12-31'
      };

      const result = await sweepService.sweep({
        testWindow,
        windowLen: body.windowLen,
        minSimilarity: body.minSimilarity,
        minMatches: body.minMatches,
        neutralBand: body.neutralBand,
        horizonDays: body.horizonDays ?? 30,
        stepDays: body.stepDays ?? 7
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Quick Fractal Sweep
   * GET /api/fractal/admin/sim/fractal-sweep/quick
   */
  fastify.get('/api/fractal/admin/sim/fractal-sweep/quick', async () => {
    try {
      const { FractalSignalSweepService } = await import('../sim/sim.fractal-sweep.service.js');
      const sweepService = new FractalSignalSweepService();

      const result = await sweepService.sweep({
        testWindow: { from: '2020-01-01', to: '2024-12-31' },
        windowLen: [60],
        minSimilarity: [0.60, 0.65, 0.70],
        minMatches: [6, 8],
        neutralBand: [0.001, 0.002],
        stepDays: 7
      });

      return {
        ok: result.ok,
        totalConfigs: result.totalConfigs,
        passedConfigs: result.passedConfigs,
        bestConfig: result.bestConfig,
        top5: result.top5,
        surfaceAnalysis: result.surfaceAnalysis
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 35.4: SLIPPAGE STRESS TEST
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run slippage stress test with multiple cost multipliers
   * POST /api/fractal/admin/sim/slippage-stress
   * Body: { start?, end?, symbol?, multipliers?: [1, 1.5, 2, 3] }
   * 
   * Pass criteria:
   * - ×2.0: Sharpe ≥ 0.50, MaxDD ≤ 40%
   * - ×3.0: Sharpe ≥ 0.35 (survival mode)
   */
  fastify.post('/api/fractal/admin/sim/slippage-stress', async (request) => {
    try {
      const { runSlippageStress } = await import('../sim/sim.slippage-stress.service.js');
      
      const body = (request.body || {}) as any;
      
      const result = await runSlippageStress({
        start: body.start ?? '2014-01-01',
        end: body.end ?? '2026-02-15',
        symbol: body.symbol ?? 'BTC',
        multipliers: body.multipliers ?? [1, 1.5, 2, 3]
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 35.5: PARAMETER PERTURBATION (ROBUSTNESS TEST)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run parameter perturbation sweep
   * POST /api/fractal/admin/sim/param-perturbation
   * Body: { start?, end?, symbol?, mode?: 'one-at-a-time' | 'full' }
   * 
   * Pass criteria:
   * - Sharpe P05 ≥ 0.45
   * - MaxDD P95 ≤ 40%
   * - Trades ≥ 45 for all configs
   * - No config with Sharpe < 0
   */
  fastify.post('/api/fractal/admin/sim/param-perturbation', async (request) => {
    try {
      const { runParameterPerturbationV2 } = await import('../sim/sim.param-perturbation.service.js');
      
      const body = (request.body || {}) as any;
      
      const result = await runParameterPerturbationV2({
        start: body.start ?? '2014-01-01',
        end: body.end ?? '2026-02-15',
        symbol: body.symbol ?? 'BTC',
        mode: body.mode ?? 'one-at-a-time'
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] Simulation endpoints registered (BLOCK 34 + 34.1-34.9 Fractal Signal Sweep + BLOCK 35.4 Slippage Stress + BLOCK 35.5 Param Perturbation)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 36.8: V2 MONTE CARLO BLOCK BOOTSTRAP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Run Monte Carlo block bootstrap on V2 multi-horizon strategy
   * POST /api/fractal/admin/sim/monte-carlo-v2
   * Body: { start?, end?, symbol?, iterations?: 3000, blockSizes?: [5, 7, 10], seed? }
   * 
   * Tests decision SEQUENCE robustness (not just returns).
   * Uses ONLY block bootstrap (no permutation - preserves regime structure).
   * 
   * Acceptance criteria:
   * - P95 MaxDD ≤ 35%
   * - Worst MaxDD ≤ 50%
   * - Worst Sharpe ≥ 0
   * - P05 CAGR ≥ 5%
   */
  fastify.post('/api/fractal/admin/sim/monte-carlo-v2', async (request) => {
    try {
      const { SimMonteCarloV2Service } = await import('../sim/sim.montecarlo-v2.service.js');
      const mcService = new SimMonteCarloV2Service();
      
      const body = (request.body || {}) as any;
      
      const result = await mcService.runFromMultiHorizonSim({
        start: body.start ?? '2019-01-01',
        end: body.end ?? '2026-02-15',
        symbol: body.symbol ?? 'BTC',
        iterations: body.iterations ?? 3000,
        blockSizes: body.blockSizes ?? [5, 7, 10],
        seed: body.seed,
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get V2 MC info and acceptance criteria
   * GET /api/fractal/admin/sim/monte-carlo-v2-info
   */
  fastify.get('/api/fractal/admin/sim/monte-carlo-v2-info', async () => {
    return {
      ok: true,
      description: 'V2 Monte Carlo Block Bootstrap (BLOCK 36.8)',
      purpose: 'Validates V2 multi-horizon strategy robustness by reshuffling decision sequences',
      method: 'Block bootstrap only (no permutation - preserves regime structure)',
      defaultConfig: {
        iterations: 3000,
        blockSizes: [5, 7, 10],
        period: { start: '2019-01-01', end: '2026-02-15' },
      },
      acceptanceCriteria: {
        p95MaxDD: '≤ 35%',
        worstMaxDD: '≤ 50%',
        worstSharpe: '≥ 0',
        p05CAGR: '≥ 5%',
      },
      tailRiskMetrics: [
        'DD > 35%',
        'DD > 45%',
        'DD > 55%',
      ],
      usage: 'POST /api/fractal/admin/sim/monte-carlo-v2 with optional body params',
    };
  });

  console.log('[Fractal] V2 Monte Carlo endpoints registered (BLOCK 36.8)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 36.9: HORIZON WEIGHT OPTIMIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin: Coarse grid search for optimal horizon weights
   * POST /api/fractal/admin/sim/weights-optimize/coarse
   * 
   * Fast grid search over horizon weights (7d/14d/30d/60d) with:
   * - Robust objective (P10Sharpe - P95DD - penalties)
   * - Anti-dominance constraints
   * - Monte Carlo validation per candidate
   * 
   * Body: { symbol?, from?, to?, step?, topK?, minTrades?, iterations?, blockSizes?, constraints? }
   */
  fastify.post('/api/fractal/admin/sim/weights-optimize/coarse', async (request) => {
    try {
      const { optimizeHorizonWeightsCoarse } = await import('../sim/sim.weights-optimize.service.js');
      
      const body = (request.body || {}) as any;
      
      const result = await optimizeHorizonWeightsCoarse({
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2019-01-01',
        to: body.to ?? '2026-02-15',
        step: body.step ?? 0.10,
        topK: body.topK ?? 10,
        minTrades: body.minTrades ?? 20,
        iterations: body.iterations ?? 1500,
        blockSizes: body.blockSizes ?? [5, 10],
        stepDays: body.stepDays ?? 7,
        constraints: body.constraints
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Refine top candidates from coarse search
   * POST /api/fractal/admin/sim/weights-optimize/refine
   * 
   * Local search around top candidates with early stopping.
   * 
   * Body: { candidates: CandidateScore[], symbol?, from?, to?, refineDelta?, refineIterations?, iterations?, blockSizes? }
   */
  fastify.post('/api/fractal/admin/sim/weights-optimize/refine', async (request) => {
    try {
      const { refineHorizonWeights } = await import('../sim/sim.weights-optimize.service.js');
      
      const body = (request.body || {}) as any;
      
      if (!body.candidates || !Array.isArray(body.candidates)) {
        return { ok: false, error: 'candidates array required' };
      }
      
      const result = await refineHorizonWeights({
        candidates: body.candidates,
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2019-01-01',
        to: body.to ?? '2026-02-15',
        refineDelta: body.refineDelta ?? 0.03,
        refineIterations: body.refineIterations ?? 100,
        iterations: body.iterations ?? 2000,
        blockSizes: body.blockSizes ?? [5, 7, 10],
        minTrades: body.minTrades ?? 20
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Certify final weights through rolling + MC validation
   * POST /api/fractal/admin/sim/weights-optimize/certify
   * 
   * Full certification pipeline:
   * 1. Rolling validation (5y train, 1y test)
   * 2. Monte Carlo block bootstrap
   * 
   * Body: { weights: HorizonWeights, symbol?, from?, to? }
   */
  fastify.post('/api/fractal/admin/sim/weights-optimize/certify', async (request) => {
    try {
      const { certifyHorizonWeights } = await import('../sim/sim.weights-optimize.service.js');
      
      const body = (request.body || {}) as any;
      
      if (!body.weights) {
        return { ok: false, error: 'weights object required (w7, w14, w30, w60)' };
      }
      
      const result = await certifyHorizonWeights({
        weights: body.weights,
        symbol: body.symbol ?? 'BTC',
        from: body.from ?? '2019-01-01',
        to: body.to ?? '2026-02-15'
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * Admin: Get weight optimization info
   * GET /api/fractal/admin/sim/weights-optimize-info
   */
  fastify.get('/api/fractal/admin/sim/weights-optimize-info', async () => {
    return {
      ok: true,
      description: 'Horizon Weight Optimization (BLOCK 36.9)',
      purpose: 'Find optimal weights for multi-horizon assembly (7d/14d/30d/60d)',
      workflow: {
        '36.9.1': 'Coarse grid search - fast scan of weight space',
        '36.9.2': 'Refine - local optimization around top candidates',
        '36.9.3': 'Certify - rolling + MC validation for final weights'
      },
      objectiveFunction: {
        formula: 'score = 1.0*P10Sharpe + 0.2*medianCAGR - 0.8*P95DD - 0.3*dominancePenalty - 0.3*lowTradesPenalty',
        description: 'Robust objective optimizing tail risk stability over raw returns'
      },
      defaultConstraints: {
        maxW7: 0.35,
        maxW60: 0.45,
        minW14W30: 0.35,
        minTrades: 20
      },
      acceptanceCriteria: {
        p95MaxDD: '≤ 35%',
        p10Sharpe: '≥ 0',
        p05CAGR: '≥ 0',
        rollingPassRate: '≥ 70%'
      },
      usage: {
        coarse: 'POST /api/fractal/admin/sim/weights-optimize/coarse',
        refine: 'POST /api/fractal/admin/sim/weights-optimize/refine',
        certify: 'POST /api/fractal/admin/sim/weights-optimize/certify'
      }
    };
  });

  console.log('[Fractal] Weight Optimization endpoints registered (BLOCK 36.9)');

  // ═══════════════════════════════════════════════════════════════
  // BLOCK 36.10: ENTROPY GUARD + ADAPTIVE POSITION SCALING
  // ═══════════════════════════════════════════════════════════════

  /**
   * BLOCK 36.10.8: Multi-Horizon Certify (A/B test with Entropy Guard)
   * POST /api/fractal/admin/sim/multi-horizon-certify
   * 
   * Compares strategy with and without Entropy Guard enabled.
   * Returns WF and MC metrics for both configurations.
   */
  fastify.post('/api/fractal/admin/sim/multi-horizon-certify', async (request) => {
    try {
      const { SimMultiHorizonCertifyService } = await import('../sim/sim.multi-horizon.certify.service.js');
      const certify = new SimMultiHorizonCertifyService();
      
      const body = (request.body || {}) as any;
      
      const result = await certify.run({
        from: body.from ?? '2019-01-01',
        to: body.to ?? '2026-02-15',
        iterations: body.iterations ?? 3000,
        blockSizes: body.blockSizes ?? [5, 7, 10],
        presetKey: body.presetKey,
        horizonConfig: body.horizonConfig,
        entropyGuardConfig: body.entropyGuardConfig,
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : '';
      console.error('[CERTIFY 36.10.8] Error:', message, stack);
      return { ok: false, error: message || 'Internal error' };
    }
  });

  /**
   * BLOCK 36.10.10: Entropy Guard Sweep
   * POST /api/fractal/admin/sim/entropy-sweep
   * 
   * Grid search for optimal Entropy Guard parameters.
   * Finds best combination of warn/hard/minScale/emaAlpha.
   */
  fastify.post('/api/fractal/admin/sim/entropy-sweep', async (request) => {
    try {
      const { SimEntropySweepService } = await import('../sim/sim.entropy-sweep.service.js');
      const sweep = new SimEntropySweepService();
      
      const body = (request.body || {}) as any;
      
      const result = await sweep.run({
        from: body.from ?? '2019-01-01',
        to: body.to ?? '2026-02-15',
        iterations: body.iterations ?? 3000,
        blockSizes: body.blockSizes ?? [5, 7, 10],
        warn: body.warn,
        hard: body.hard,
        minScale: body.minScale,
        emaAlpha: body.emaAlpha,
        minTrades: body.minTrades ?? 10,
        minSharpe: body.minSharpe ?? 0.2,
        maxP95DD: body.maxP95DD,
      });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  /**
   * BLOCK 36.10: Entropy Guard Info
   * GET /api/fractal/admin/sim/entropy-guard-info
   */
  fastify.get('/api/fractal/admin/sim/entropy-guard-info', async () => {
    const { DEFAULT_ENTROPY_GUARD_CONFIG } = await import('../engine/v2/entropy.guard.js');
    
    return {
      ok: true,
      description: 'Entropy Guard — Dynamic Position Scaling (BLOCK 36.10)',
      purpose: 'Reduce tail risk (P95 MaxDD) by scaling down exposure when horizons disagree',
      config: DEFAULT_ENTROPY_GUARD_CONFIG,
      parameters: {
        warnEntropy: 'Start scaling when entropy exceeds this (0..1)',
        hardEntropy: 'Full scale down at this entropy level (0..1)',
        minScale: 'Minimum exposure multiplier when entropy is high',
        emaAlpha: 'EMA smoothing factor for entropy (0=slow, 1=fast)',
        dominanceHard: 'Max probability threshold for dominance penalty',
        dominancePenalty: 'Additional scale reduction when one side dominates',
      },
      endpoints: {
        certify: 'POST /api/fractal/admin/sim/multi-horizon-certify',
        sweep: 'POST /api/fractal/admin/sim/entropy-sweep',
        finalize: 'POST /api/fractal/admin/presets/v2_entropy_finalize',
      },
      targets: {
        p95MaxDD: '<= 35%',
        worstMaxDD: '<= 50%',
        worstSharpe: '>= 0',
        p05CAGR: '>= 5%',
      },
    };
  });

  /**
   * BLOCK 36.10.11: Finalize Entropy Guard preset
   * POST /api/fractal/admin/presets/v2_entropy_finalize
   * 
   * Saves the best entropy guard parameters from sweep as the new preset.
   */
  fastify.post('/api/fractal/admin/presets/v2_entropy_finalize', async (request) => {
    try {
      const { FractalSettingsModel } = await import('../data/schemas/fractal-settings.schema.js');
      
      const body = (request.body || {}) as any;
      const presetKey = body.presetKey ?? 'v2_weights_final';
      const bestParams = body.bestParams;
      
      if (!bestParams) {
        return { ok: false, error: 'bestParams required (from entropy-sweep result)' };
      }
      
      // Validate params
      const entropyConfig = {
        enabled: true,
        warnEntropy: bestParams.warn ?? 0.55,
        hardEntropy: bestParams.hard ?? 0.75,
        minScale: bestParams.minScale ?? 0.25,
        emaAlpha: bestParams.emaAlpha ?? 0.25,
        alphaStrength: 0.55,
        alphaConf: 0.45,
        dominancePenaltyEnabled: true,
        dominanceHard: 0.70,
        dominancePenalty: 0.20,
        emaEnabled: true,
      };
      
      // Update settings in MongoDB
      await FractalSettingsModel.updateOne(
        { symbol: 'BTC' },
        { 
          $set: { 
            [`presets.${presetKey}.entropyGuard`]: entropyConfig,
            updatedAt: new Date(),
          } 
        },
        { upsert: true }
      );
      
      return { 
        ok: true, 
        presetKey, 
        entropyGuard: entropyConfig,
        message: `Entropy Guard parameters saved to preset '${presetKey}'`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  });

  console.log('[Fractal] Entropy Guard endpoints registered (BLOCK 36.10)');
}
