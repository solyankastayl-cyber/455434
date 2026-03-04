/**
 * INDEX ORCHESTRATOR SERVICE — V2
 * 
 * Unified orchestrator for DXY/SPX/BTC indices.
 * Assembles packs and returns IndexPackV2.
 */

import { 
  IndexPackV2, 
  IndexPackRequest,
  IndexSymbol,
  HorizonDays,
  DataStatus,
  MacroPackV2,
  MacroDriver,
  RegimeType,
} from '../contracts/index_pack.contract.js';
import { getMarkovEngine } from './macro_layer/macro_markov.service.js';
import { computeAllHorizonImpacts, getMacroApplication } from './macro_layer/macro_impact.service.js';

// ═══════════════════════════════════════════════════════════════
// INDEX ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

export async function orchestrateIndexPack(
  request: IndexPackRequest
): Promise<IndexPackV2> {
  const startTime = Date.now();
  
  const symbol = request.symbol;
  const horizonDays = request.horizon || 30;
  const view = request.view || 'full';
  
  // Initialize response
  const pack: IndexPackV2 = {
    symbol,
    asOf: request.asOf || new Date().toISOString(),
    horizonDays,
    dataStatus: {
      replay: 'MISSING',
      synthetic: 'MISSING',
      hybrid: 'MISSING',
      macro: 'MISSING',
      analytics: 'MISSING',
    },
    processingTimeMs: 0,
    version: '2.0',
  };
  
  try {
    // Route to appropriate index module
    if (symbol === 'DXY') {
      await orchestrateDXY(pack, horizonDays, view);
    } else if (symbol === 'SPX') {
      await orchestrateSPX(pack, horizonDays, view);
    } else if (symbol === 'BTC') {
      await orchestrateBTC(pack, horizonDays, view);
    }
    
  } catch (error: any) {
    console.error(`[Index Orchestrator] Error for ${symbol}:`, error.message);
  }
  
  pack.processingTimeMs = Date.now() - startTime;
  return pack;
}

// ═══════════════════════════════════════════════════════════════
// DXY ORCHESTRATION
// ═══════════════════════════════════════════════════════════════

async function orchestrateDXY(
  pack: IndexPackV2,
  horizonDays: HorizonDays,
  view: string
): Promise<void> {
  // Import DXY-specific services
  const { buildDxyTerminalPack } = await import('../../dxy/services/dxy_terminal.service.js');
  const { computeMacroScore } = await import('../../dxy-macro-core/services/macro_score.service.js');
  
  // Get terminal pack (contains replay, synthetic, hybrid, macro)
  const focusParam = `${horizonDays}d` as any;
  
  try {
    const terminalPack = await buildDxyTerminalPack({ focus: focusParam });
    
    if (terminalPack) {
      // Top matches
      if (terminalPack.matches?.length > 0) {
        pack.topMatches = terminalPack.matches.slice(0, 10).map((m: any) => ({
          matchId: m.matchId || m.startDate,
          startDate: m.startDate,
          endDate: m.endDate,
          similarity: m.similarity,
          forwardReturn: m.forwardReturn || 0,
          decade: m.decade || getDecade(m.startDate),
        }));
        pack.dataStatus.replay = 'OK';
      }
      
      // Synthetic from core
      if (terminalPack.core) {
        pack.synthetic = {
          k: terminalPack.core.matchCount || 10,
          anchorPrice: terminalPack.core.anchorPrice,
          meanPath: terminalPack.synthetic?.meanPath || [],
          bands: terminalPack.synthetic?.bands || { p10: [], p50: [], p90: [] },
          validation: {
            bandWidth: 0,
            isValid: true,
          },
        };
        pack.dataStatus.synthetic = 'OK';
      }
      
      // Hybrid
      if (terminalPack.hybrid) {
        pack.hybrid = {
          anchorPrice: terminalPack.hybrid.anchorPrice || terminalPack.core?.anchorPrice || 0,
          path: terminalPack.hybrid.path || [],
          weights: {
            wReplay: terminalPack.hybrid.weights?.wReplay || 0.5,
            wSynthetic: terminalPack.hybrid.weights?.wSynthetic || 0.5,
            method: 'SIMILARITY_ENTROPY',
          },
          divergence: {
            replayVsSynthetic: 0,
            isAnomalous: false,
            divergenceGuard: false,
          },
          breakdown: {
            replayPath: terminalPack.hybrid.breakdown?.replayPath || [],
            syntheticMean: terminalPack.hybrid.breakdown?.syntheticMean || [],
          },
          validation: { isValid: true },
        };
        pack.dataStatus.hybrid = 'OK';
      }
    }
  } catch (e) {
    console.log('[DXY Orchestrator] Terminal pack error:', (e as any).message);
  }
  
  // Macro V2
  if (view === 'full' || view === 'macro') {
    try {
      const macroScore = await computeMacroScore();
      pack.macro = buildMacroPackV2(macroScore, horizonDays);
      pack.dataStatus.macro = 'OK';
    } catch (e) {
      console.log('[DXY Orchestrator] Macro error:', (e as any).message);
      pack.dataStatus.macro = 'PARTIAL';
    }
  }
  
  // Analytics V2
  if (view === 'full' || view === 'analytics') {
    pack.analytics = buildAnalyticsPackV2(pack, null);
    pack.dataStatus.analytics = pack.analytics.validation.hasOutcomes ? 'OK' : 'PARTIAL';
  }
}

// ═══════════════════════════════════════════════════════════════
// SPX ORCHESTRATION (placeholder - frozen)
// ═══════════════════════════════════════════════════════════════

async function orchestrateSPX(
  pack: IndexPackV2,
  horizonDays: HorizonDays,
  view: string
): Promise<void> {
  // SPX is frozen - return minimal data
  pack.dataStatus.replay = 'MISSING';
  pack.dataStatus.synthetic = 'MISSING';
  pack.dataStatus.hybrid = 'MISSING';
  pack.dataStatus.macro = 'MISSING';
  pack.dataStatus.analytics = 'MISSING';
}

// ═══════════════════════════════════════════════════════════════
// BTC ORCHESTRATION (placeholder - frozen)
// ═══════════════════════════════════════════════════════════════

async function orchestrateBTC(
  pack: IndexPackV2,
  horizonDays: HorizonDays,
  view: string
): Promise<void> {
  // BTC is frozen - return minimal data
  pack.dataStatus.replay = 'MISSING';
  pack.dataStatus.synthetic = 'MISSING';
  pack.dataStatus.hybrid = 'MISSING';
  pack.dataStatus.macro = 'MISSING';
  pack.dataStatus.analytics = 'MISSING';
}

// ═══════════════════════════════════════════════════════════════
// BUILD MACRO PACK V2
// ═══════════════════════════════════════════════════════════════

function buildMacroPackV2(macroScore: any, horizonDays: HorizonDays): MacroPackV2 {
  const markovEngine = getMarkovEngine();
  
  // Build score vector from components
  const scoreVector: Record<string, number> = {};
  if (macroScore.components) {
    for (const comp of macroScore.components) {
      scoreVector[comp.seriesId] = comp.normalizedPressure || 0;
    }
  }
  
  // Get Markov state
  const state = markovEngine.getState(
    scoreVector,
    macroScore.scoreSigned || 0,
    macroScore.confidence === 'HIGH' ? 0.9 : macroScore.confidence === 'LOW' ? 0.4 : 0.7,
    macroScore.summary?.dominantRegime as RegimeType || 'NEUTRAL'
  );
  
  // Build drivers
  const drivers: MacroDriver[] = (macroScore.components || []).map((comp: any) => ({
    key: comp.role || comp.seriesId,
    displayName: comp.displayName || comp.seriesId,
    contribution: comp.normalizedPressure || 0,
    weight: comp.weight || 0.1,
    lagDays: 120, // From correlation analysis
    currentValue: comp.rawPressure || 0,
    zscore: comp.normalizedPressure || 0,
    tooltip: `${comp.displayName}: ${comp.regime} (${((comp.rawPressure || 0) * 100).toFixed(1)}%)`,
  }));
  
  // Compute horizon impacts
  const horizonImpacts = computeAllHorizonImpacts(
    state.scoreSigned,
    state.regime,
    state.confidence
  );
  
  // Get application for current horizon
  const currentImpact = horizonImpacts.find(h => h.horizonDays === horizonDays) || horizonImpacts[2];
  const application = getMacroApplication(currentImpact, state.regime);
  
  return {
    state,
    drivers,
    horizonImpacts,
    application,
    computedAt: new Date().toISOString(),
    dataQuality: {
      freshSeries: macroScore.quality?.freshCount || 0,
      staleSeries: macroScore.quality?.staleCount || 0,
      qualityScore: Math.round((1 - (macroScore.quality?.qualityPenalty || 0)) * 100),
    },
    validation: {
      isValid: true,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD ANALYTICS PACK V2
// ═══════════════════════════════════════════════════════════════

function buildAnalyticsPackV2(pack: IndexPackV2, focusPack: any): any {
  const validation = {
    hasOutcomes: false,
    hasRisk: false,
    hasPhase: false,
    hasForwardEval: false,
  };
  
  const analytics: any = {
    context: {
      matches: pack.topMatches?.length || 0,
      coverageYears: 50,
      quality: 80,
      lastUpdateAt: new Date().toISOString(),
    },
    validation,
  };
  
  // Expected outcomes from top matches
  if (pack.topMatches && pack.topMatches.length >= 5) {
    const returns = pack.topMatches.map(m => m.forwardReturn);
    returns.sort((a, b) => a - b);
    
    analytics.expectedOutcomes = {
      lower: returns[Math.floor(returns.length * 0.1)] || 0,
      base: returns[Math.floor(returns.length * 0.5)] || 0,
      upper: returns[Math.floor(returns.length * 0.9)] || 0,
      samples: returns.length,
      fallbackUsed: false,
    };
    validation.hasOutcomes = true;
  }
  
  // Risk metrics
  if (pack.macro?.state) {
    const regime = pack.macro.state.regime;
    analytics.risk = {
      level: regime === 'STRESS' ? 'HIGH' : regime === 'NEUTRAL' ? 'NORMAL' : 'LOW',
      typicalPullbackPct: regime === 'STRESS' ? 5 : 2,
      worstCasePct: regime === 'STRESS' ? 10 : 5,
      positionSize: regime === 'STRESS' ? 0.5 : 1.0,
      guard: regime === 'STRESS' ? 'HARD' : 'NONE',
    };
    validation.hasRisk = true;
  }
  
  return analytics;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getDecade(dateStr: string): string {
  const year = parseInt(dateStr.slice(0, 4));
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}

function computeBandWidth(bands: any): number {
  if (!bands?.p10?.length || !bands?.p90?.length) return 0;
  const lastP10 = bands.p10[bands.p10.length - 1]?.value || bands.p10[bands.p10.length - 1]?.price || 0;
  const lastP90 = bands.p90[bands.p90.length - 1]?.value || bands.p90[bands.p90.length - 1]?.price || 0;
  return Math.abs(lastP90 - lastP10);
}
