/**
 * DXY RESEARCH TERMINAL SERVICE — B3 + B4.1 (Housing)
 * 
 * Aggregates:
 * - Fractal Terminal (A4)
 * - Macro Core (B1)
 * - Macro Overlay (B2)
 * - Housing Context (B4.1)
 * - Research Summary (human-readable insights)
 * 
 * CRITICAL: This service does NOT recalculate anything.
 * It only aggregates existing services and formats research block.
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import {
  DxyResearchPack,
  DxyResearchParams,
  ResearchBlock,
  ResearchDriver,
  DataFreshness,
  MacroCorePack,
  ResearchDebugPack,
} from '../contracts/dxy_research_terminal.contract.js';
import { buildDxyTerminalPack } from './dxy_terminal.service.js';
import { computeMacroScore } from '../../dxy-macro-core/services/macro_score.service.js';
import { buildMacroContext, buildAllMacroContexts } from '../../dxy-macro-core/services/macro_context.service.js';
import { buildHousingContext } from '../../dxy-macro-core/services/housing_context.service.js';
import { getAllSeriesMeta } from '../../dxy-macro-core/ingest/macro.ingest.service.js';
import type { MacroContext, MacroScore, MacroSeriesMeta } from '../../dxy-macro-core/contracts/macro.contracts.js';
import type { TerminalMacroPack } from '../contracts/dxy_terminal.contract.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// B4.1-B4.3: Series tracking
const CORE_SERIES = ['FEDFUNDS', 'CPILFESL', 'T10Y2Y', 'UNRATE', 'M2SL', 'CPIAUCSL', 'PPIACO'];
const HOUSING_SERIES = ['MORTGAGE30US', 'HOUST', 'PERMIT', 'CSUSHPISA'];
const ACTIVITY_SERIES = ['MANEMP', 'INDPRO', 'TCU'];
const CREDIT_SERIES = ['BAA10Y', 'TEDRATE', 'VIXCLS'];

const FIXED_LIMITS = [
  'Macro overlay does NOT change signal direction (LONG/SHORT)',
  'Macro data is lagged (1-4 weeks depending on series)',
  'System does NOT provide financial advice',
  'Past performance does not guarantee future results',
  'Confidence multiplier affects position sizing only',
];

// Stale threshold in days
const STALE_THRESHOLD_DAYS = 30;
const OLD_THRESHOLD_DAYS = 60;

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate lag days
// ═══════════════════════════════════════════════════════════════

function calcLagDays(lastDate: string | null): number {
  if (!lastDate) return 999;
  const last = new Date(lastDate);
  const now = new Date();
  return Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
}

function getFreshnessStatus(lagDays: number): 'FRESH' | 'STALE' | 'OLD' {
  if (lagDays <= STALE_THRESHOLD_DAYS) return 'FRESH';
  if (lagDays <= OLD_THRESHOLD_DAYS) return 'STALE';
  return 'OLD';
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build headline
// ═══════════════════════════════════════════════════════════════

function buildHeadline(
  action: string,
  confidence: number,
  macroAdjustedConfidence: number | undefined,
  agreement: string | undefined,
  tradingEnabled: boolean,
  focus: string
): string {
  const confDisplay = macroAdjustedConfidence ?? confidence;
  const agreementLabel = agreement || 'UNKNOWN';
  
  if (!tradingEnabled) {
    return `DXY ${focus}: REGIME mode (no trading). Bias: ${action}. Macro: ${agreementLabel}.`;
  }
  
  const arrow = action === 'LONG' ? '↑' : action === 'SHORT' ? '↓' : '—';
  
  return `DXY: ${action} ${arrow} (${confDisplay}/100). Macro: ${agreementLabel}.`;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build drivers from macro components
// ═══════════════════════════════════════════════════════════════

function buildDrivers(macroScore: MacroScore): ResearchDriver[] {
  const sorted = [...macroScore.components]
    .sort((a, b) => Math.abs(b.normalizedPressure) - Math.abs(a.normalizedPressure))
    .slice(0, 3);
  
  return sorted.map(c => {
    const direction = c.rawPressure > 0 ? 'USD strength' : c.rawPressure < 0 ? 'USD weakness' : 'neutral';
    const magnitude = Math.abs(c.rawPressure) > 0.5 ? 'strong' : Math.abs(c.rawPressure) > 0.2 ? 'moderate' : 'mild';
    
    let note: string;
    switch (c.role) {
      case 'rates':
        note = c.regime === 'TIGHTENING' 
          ? `Fed tightening → ${magnitude} ${direction}`
          : c.regime === 'EASING'
            ? `Fed easing → ${magnitude} ${direction}`
            : `Fed on pause → ${direction}`;
        break;
      case 'inflation':
        note = c.regime === 'REHEATING'
          ? `Inflation reheating → ${magnitude} hawkish pressure`
          : c.regime === 'COOLING'
            ? `Inflation cooling → ${magnitude} dovish pressure`
            : `Inflation stable → ${direction}`;
        break;
      case 'labor':
        note = c.regime === 'STRESS'
          ? `Labor stress → risk-off signal`
          : c.regime === 'LOW'
            ? `Tight labor → hawkish pressure`
            : `Labor market normal`;
        break;
      case 'curve':
        note = c.regime === 'INVERTED'
          ? `Yield curve inverted → recession warning`
          : c.regime === 'STEEP'
            ? `Curve steep → growth expectations`
            : `Curve normal`;
        break;
      case 'liquidity':
        note = c.regime === 'CONTRACTION'
          ? `Liquidity contraction → risk-off`
          : c.regime === 'EXPANSION'
            ? `Liquidity expansion → risk-on`
            : `Liquidity stable`;
        break;
      // B4.1: Housing
      case 'housing':
        note = c.regime === 'TIGHT'
          ? `Tight mortgage + weak construction → USD supportive`
          : c.regime === 'LOOSE'
            ? `Easing housing cycle → USD pressure`
            : `Housing conditions neutral`;
        break;
      // B4.2: Activity / B4.3: Credit (composite components)
      case 'growth':
        if (c.seriesId === 'ACTIVITY') {
          note = c.regime === 'EXPANSION'
            ? `Economic activity expanding → USD tailwind from growth`
            : c.regime === 'CONTRACTION'
              ? `Economic activity contracting → USD headwind`
              : `Economic activity neutral`;
        } else {
          note = `${c.displayName}: ${direction}`;
        }
        break;
      case 'credit':
        if (c.seriesId === 'CREDIT') {
          note = c.regime === 'STRESS'
            ? `Rising spreads / financial stress → USD safe-haven bid`
            : c.regime === 'CALM'
              ? `Compressed spreads / low stress → USD tailwind reduced`
              : `Credit conditions neutral`;
        } else {
          note = `${c.displayName}: ${direction}`;
        }
        break;
      default:
        note = `${c.displayName}: ${direction}`;
    }
    
    return {
      key: c.seriesId,
      label: c.displayName,
      contribution: Math.round(c.normalizedPressure * 1000) / 1000,
      note,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build risks
// ═══════════════════════════════════════════════════════════════

function buildRisks(
  agreement: string | undefined,
  warnings: string[],
  freshness: DataFreshness[],
  tradingEnabled: boolean,
  focus: string
): string[] {
  const risks: string[] = [];
  
  // Agreement conflict
  if (agreement === 'CONFLICT') {
    risks.push('⚠️ Signal conflicts with macro environment');
  }
  
  // Regime mode
  if (!tradingEnabled) {
    risks.push(`⚠️ ${focus} is regime-only horizon (no directional alpha)`);
  }
  
  // Stale data
  const staleSeries = freshness.filter(f => f.status !== 'FRESH');
  if (staleSeries.length > 0) {
    risks.push(`⚠️ Stale data: ${staleSeries.map(s => s.key).join(', ')}`);
  }
  
  // Terminal warnings
  for (const w of warnings) {
    if (w.includes('GUARD')) {
      risks.push(`🛡️ ${w}`);
    } else if (w.includes('FALLBACK') || w.includes('NAN')) {
      risks.push(`⚠️ ${w}`);
    }
  }
  
  // Guard triggered
  if (warnings.some(w => w.includes('MACRO_GUARD'))) {
    risks.push('🛡️ Macro guard active: trading blocked');
  }
  
  return risks;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build takeaways
// ═══════════════════════════════════════════════════════════════

function buildTakeaways(
  action: string,
  forecastReturn: number,
  macroScore: MacroScore,
  overlay: TerminalMacroPack | null,
  tradingEnabled: boolean,
  focus: string
): string[] {
  const takeaways: string[] = [];
  
  // Direction takeaway
  if (tradingEnabled) {
    const returnPct = (forecastReturn * 100).toFixed(2);
    takeaways.push(`Fractal signal: ${action} with ${returnPct}% expected move over ${focus}`);
  } else {
    takeaways.push(`${focus} horizon is for regime bias only, not directional trading`);
  }
  
  // Macro regime
  if (macroScore.summary.dominantRegime !== 'UNKNOWN') {
    takeaways.push(`Macro regime: ${macroScore.summary.dominantRegime}`);
  }
  
  // Confidence adjustment
  if (overlay) {
    const mult = overlay.overlay.confidenceMultiplier;
    if (mult > 1.0) {
      takeaways.push(`Macro ALIGNED → confidence scaled UP (×${mult.toFixed(2)})`);
    } else if (mult < 1.0) {
      takeaways.push(`Macro adjustment → confidence scaled DOWN (×${mult.toFixed(2)})`);
    }
  }
  
  // Risk mode
  if (overlay?.regime.riskMode === 'RISK_OFF') {
    takeaways.push('Environment: RISK-OFF — reduced exposure recommended');
  } else if (overlay?.regime.riskMode === 'RISK_ON') {
    takeaways.push('Environment: RISK-ON — conditions support signal');
  }
  
  // Key drivers
  if (macroScore.summary.keyDrivers.length > 0) {
    takeaways.push(`Key drivers: ${macroScore.summary.keyDrivers.slice(0, 2).join(', ')}`);
  }
  
  // Confidence
  takeaways.push(`Data confidence: ${macroScore.confidence}`);
  
  return takeaways.slice(0, 6);  // Max 6 takeaways
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build data freshness
// ═══════════════════════════════════════════════════════════════

function buildDataFreshness(seriesMeta: MacroSeriesMeta[]): DataFreshness[] {
  // B4.1-B4.3: Include all extended series
  const allSeries = [...CORE_SERIES, ...HOUSING_SERIES, ...ACTIVITY_SERIES, ...CREDIT_SERIES];
  
  return allSeries.map(key => {
    const meta = seriesMeta.find(m => m.seriesId === key);
    const lagDays = calcLagDays(meta?.lastDate ?? null);
    
    return {
      key,
      label: meta?.displayName ?? key,
      lastDate: meta?.lastDate ?? 'N/A',
      lagDays,
      status: getFreshnessStatus(lagDays),
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Build DXY Research Pack
// ═══════════════════════════════════════════════════════════════

export async function buildDxyResearchPack(
  params: DxyResearchParams
): Promise<DxyResearchPack> {
  const start = Date.now();
  const { focus, rank = 1 } = params;
  
  // 1) Get terminal pack (includes macro overlay)
  const terminalStart = Date.now();
  const terminal = await buildDxyTerminalPack({ focus, rank });
  const terminalMs = Date.now() - terminalStart;
  
  // 2) Get macro core data
  const macroStart = Date.now();
  const macroScore = await computeMacroScore();
  const contexts = await buildAllMacroContexts();
  const seriesMeta = await getAllSeriesMeta();
  const macroMs = Date.now() - macroStart;
  
  // Build contexts map
  const contextsMap: Record<string, MacroContext> = {};
  for (const ctx of contexts) {
    contextsMap[ctx.seriesId] = ctx;
  }
  
  const macroCore: MacroCorePack = {
    score: macroScore,
    contexts: contextsMap,
    seriesMeta,
  };
  
  // 3) Extract overlay
  const overlay = terminal.macro ?? null;
  
  // 4) Build research block
  const researchStart = Date.now();
  
  const decision = terminal.core.decision;
  const agreement = overlay?.regime.agreementWithSignal;
  const tradingEnabled = terminal.meta.tradingEnabled;
  
  const dataFreshness = buildDataFreshness(seriesMeta);
  
  const research: ResearchBlock = {
    headline: buildHeadline(
      decision.action,
      decision.confidence,
      (decision as any).macroAdjustedConfidence,
      agreement,
      tradingEnabled,
      focus
    ),
    takeaways: buildTakeaways(
      decision.action,
      decision.forecastReturn,
      macroScore,
      overlay,
      tradingEnabled,
      focus
    ),
    drivers: buildDrivers(macroScore),
    risks: buildRisks(agreement, terminal.meta.warnings, dataFreshness, tradingEnabled, focus),
    dataFreshness,
    limits: FIXED_LIMITS,
  };
  
  const researchMs = Date.now() - researchStart;
  const totalMs = Date.now() - start;
  
  return {
    ok: true,
    asset: 'DXY',
    focus,
    ts: new Date().toISOString(),
    processingTimeMs: totalMs,
    terminal,
    macroCore,
    overlay,
    research,
  };
}

// ═══════════════════════════════════════════════════════════════
// DEBUG: Get source information
// ═══════════════════════════════════════════════════════════════

export async function buildResearchDebugPack(
  params: DxyResearchParams
): Promise<ResearchDebugPack> {
  const start = Date.now();
  
  // Time terminal
  const terminalStart = Date.now();
  await buildDxyTerminalPack({ focus: params.focus, rank: params.rank ?? 1 });
  const terminalMs = Date.now() - terminalStart;
  
  // Time macro
  const macroStart = Date.now();
  await computeMacroScore();
  const macroMs = Date.now() - macroStart;
  
  // Time research (minimal)
  const researchMs = 5;  // Research formatting is fast
  
  const totalMs = Date.now() - start;
  
  return {
    ok: true,
    sources: {
      terminalEndpoint: '/api/fractal/dxy/terminal',
      macroScoreEndpoint: '/api/dxy-macro-core/score',
      macroSeriesUsed: CORE_SERIES,
      overlayVersion: 'B2.1',
    },
    timing: {
      terminalMs,
      macroMs,
      researchMs,
      totalMs,
    },
  };
}
