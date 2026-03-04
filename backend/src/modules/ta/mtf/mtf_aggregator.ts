/**
 * Phase M: MTF Aggregator
 * 
 * Combines decisions from 1D/4H/1H into unified MTF decision
 */

import { MTFConfig, MTFDecisionPack, MTFInput, MTFScenario } from './mtf_types.js';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, isNaN(x) ? 0.5 : x));
}

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/**
 * Extract bias direction from pack
 */
function biasDirection(pack: any): 'BULL' | 'BEAR' | 'NEUTRAL' {
  const b = pack?.summary?.topBias || pack?.topBias || pack?.top?.[0]?.intent?.bias;
  if (b === 'LONG') return 'BULL';
  if (b === 'SHORT') return 'BEAR';
  return 'NEUTRAL';
}

/**
 * Get direction from scenario
 */
function scenarioDir(sc: any): 'BULL' | 'BEAR' | 'NEUTRAL' {
  const dir = sc?.direction || sc?.intent?.bias;
  if (dir === 'BULL' || dir === 'BULLISH' || dir === 'LONG') return 'BULL';
  if (dir === 'BEAR' || dir === 'BEARISH' || dir === 'SHORT') return 'BEAR';
  return 'NEUTRAL';
}

/**
 * Convert direction to intent
 */
function toIntent(dir: 'BULL' | 'BEAR' | 'NEUTRAL'): 'LONG' | 'SHORT' | 'WAIT' {
  if (dir === 'BULL') return 'LONG';
  if (dir === 'BEAR') return 'SHORT';
  return 'WAIT';
}

/**
 * Get confidence from probability
 */
function confidenceFromP(p: number): 'HIGH' | 'MED' | 'LOW' {
  if (p >= 0.70) return 'HIGH';
  if (p >= 0.58) return 'MED';
  return 'LOW';
}

/**
 * Pick risk pack from trigger or setup
 */
function pickRiskPack(setup: any, trigger: any): any {
  return trigger?.riskPack || setup?.riskPack || null;
}

/**
 * Calculate regime penalty
 */
function regimePenalty(cfg: MTFConfig, biasPack: any): number {
  const r = biasPack?.snapshot?.marketRegime || 
            biasPack?.regime?.marketRegime || 
            biasPack?.meta?.marketRegime ||
            biasPack?.top?.[0]?.regime?.market;
  
  const v = biasPack?.snapshot?.volRegime || 
            biasPack?.regime?.volRegime || 
            biasPack?.meta?.volRegime ||
            biasPack?.top?.[0]?.regime?.volatility;

  let pen = 0;
  if (r === 'TRANSITION') pen += cfg.regimePenalty.transition;
  if (v === 'EXTREME') pen += cfg.regimePenalty.extremeVol;
  return pen;
}

/**
 * Calculate conflict penalty between directions
 */
function conflictPenalty(
  cfg: MTFConfig,
  biasDir: 'BULL' | 'BEAR' | 'NEUTRAL',
  setupDir: 'BULL' | 'BEAR' | 'NEUTRAL',
  trigDir: 'BULL' | 'BEAR' | 'NEUTRAL'
): { pen: number; penalties: string[] } {
  const penalties: string[] = [];
  let pen = 0;

  const disagree = (a: string, b: string) =>
    a !== 'NEUTRAL' && b !== 'NEUTRAL' && a !== b;

  if (disagree(biasDir, setupDir)) {
    pen += 0.18;
    penalties.push('BIAS_SETUP_DISAGREE');
  }
  if (disagree(setupDir, trigDir)) {
    pen += 0.12;
    penalties.push('SETUP_TRIGGER_DISAGREE');
  }

  pen = Math.min(pen, cfg.maxConflictPenalty);
  return { pen, penalties };
}

/**
 * Build MTF decision from single-TF packs
 */
export function buildMTFDecision(cfg: MTFConfig, input: MTFInput): MTFDecisionPack {
  const biasDir = biasDirection(input.biasPack);

  // Get top scenario from bias pack
  const biasTop = input.biasPack?.scenarios?.[0] || 
                  input.biasPack?.topScenarios?.[0] ||
                  input.biasPack?.top?.[0];
  
  const biasP = Number(
    biasTop?.probability ?? 
    input.biasPack?.summary?.probability ?? 
    0.5
  );

  // Get setup and trigger scenarios
  const setupList = (
    input.setupPack?.scenarios || 
    input.setupPack?.top || 
    []
  ).slice(0, 3);
  
  const trigList = (
    input.triggerPack?.scenarios || 
    input.triggerPack?.top || 
    []
  ).slice(0, 3);

  const penRegime = regimePenalty(cfg, input.biasPack);

  const candidates: MTFScenario[] = [];

  // Build candidates from setup x trigger combinations
  for (const s of setupList) {
    const pSetup = Number(s.probability ?? 0.5);
    if (pSetup < cfg.minSetupProbability) continue;

    for (const t of trigList) {
      const trigScore = Number(
        t.score ?? t.baseScore ?? t.probability ?? 0.5
      );
      if (trigScore < cfg.minTriggerScore) continue;

      const setupDir = scenarioDir(s);
      const trigDir = scenarioDir(t);

      // Hard gate: if bias agreement required, skip opposing triggers
      if (cfg.requireBiasAgreement && biasDir !== 'NEUTRAL') {
        if (trigDir !== 'NEUTRAL' && trigDir !== biasDir) continue;
      }

      const cpen = conflictPenalty(cfg, biasDir, setupDir, trigDir);

      // Map trigger score to probability
      const trigP = clamp01(0.45 + 0.55 * trigScore);

      // Weighted blend
      let p = cfg.wBias * biasP + cfg.wSetup * pSetup + cfg.wTrigger * trigP;
      p = p - penRegime - cpen.pen;
      p = clamp01(p);

      // Determine final direction
      const dir = biasDir !== 'NEUTRAL' 
        ? biasDir 
        : (setupDir !== 'NEUTRAL' ? setupDir : trigDir);

      const scenario: MTFScenario = {
        id: `mtf_${uid()}`,
        direction: dir,
        probability: p,
        confidence: confidenceFromP(p),
        intent: toIntent(dir),

        bias: {
          p: biasP,
          regime: input.biasPack?.snapshot?.marketRegime ?? 
                  input.biasPack?.regime?.market ?? 'UNKNOWN',
          vol: input.biasPack?.snapshot?.volRegime ?? 
               input.biasPack?.regime?.volatility ?? 'UNKNOWN',
          runId: input.biasPack?.runId,
          scenarioId: biasTop?.id ?? biasTop?.scenarioId,
        },

        setup: {
          p: pSetup,
          runId: input.setupPack?.runId,
          scenarioId: s.id ?? s.scenarioId,
          primaryPattern: s.primaryPattern ?? s.patterns?.[0]?.type ?? s.components?.[0]?.type,
          rr: s.riskPack?.metrics?.rrToT1 ?? s.riskPack?.rrToT1 ?? null,
        },

        trigger: {
          score: trigScore,
          runId: input.triggerPack?.runId,
          scenarioId: t.id ?? t.scenarioId,
          triggerType: t.triggerType ?? t.entryType ?? null,
        },

        riskPack: pickRiskPack(s, t),

        penalties: [...cpen.penalties, ...(penRegime ? ['REGIME_PENALTY'] : [])],
        reasons: [
          `blend=bias(${biasP.toFixed(2)})+setup(${pSetup.toFixed(2)})+trigger(${trigP.toFixed(2)})`,
        ],
      };

      candidates.push(scenario);
    }
  }

  // Sort by probability, select top 3 with diversity
  candidates.sort((a, b) => b.probability - a.probability);

  const top: MTFScenario[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    if (top.length >= 3) break;
    
    // Encourage diversity: don't take same intent 3x
    if (top.length < 2 || !seen.has(c.intent)) {
      top.push(c);
      seen.add(c.intent);
    }
  }

  // Fallback if diversity didn't fill
  while (top.length < 3 && candidates[top.length]) {
    top.push(candidates[top.length]);
  }

  const best = top[0];
  const topBias = best ? best.intent : 'WAIT';

  return {
    asset: input.asset,
    createdAt: Date.now(),
    config: cfg,
    topBias,
    scenarios: top,
    audit: {
      biasRunId: input.biasPack?.runId,
      setupRunId: input.setupPack?.runId,
      triggerRunId: input.triggerPack?.runId,
      mtfRunId: `mtf_run_${uid()}`,
    },
  };
}
