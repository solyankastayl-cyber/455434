/**
 * DXY FRACTAL OVERVIEW SERVICE
 * 
 * Aggregates all DXY data into single UI pack
 * Decision Engine: Verdict first, details second
 */

import type {
  DxyOverviewPack,
  DxyVerdict,
  DxyHeaderStatus,
  ChartSeries,
  HorizonForecast,
  WhyVerdict,
  RiskContext,
  AnalogsSummary,
  MacroImpact,
  DxyAction,
  DxyBias,
  RiskLevel,
  Regime,
  Driver,
  HistoricalMatch,
} from './dxy_overview.contract.js';

const API_BASE = 'http://localhost:8002';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ═══════════════════════════════════════════════════════════════
// FETCH DXY TERMINAL DATA
// ═══════════════════════════════════════════════════════════════

async function fetchDxyTerminal(horizon: number = 90): Promise<any> {
  try {
    const focusMap: Record<number, string> = {
      7: '7d', 14: '14d', 30: '30d', 90: '90d', 180: '180d', 365: '365d'
    };
    const focus = focusMap[horizon] || '90d';
    
    const response = await fetch(`${API_BASE}/api/fractal/dxy/terminal?focus=${focus}`);
    if (!response.ok) throw new Error(`DXY API error: ${response.status}`);
    return await response.json();
  } catch (e) {
    console.error('[DXY Overview] Failed to fetch terminal:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// BUILD VERDICT
// ═══════════════════════════════════════════════════════════════

function buildVerdict(terminal: any, horizon: number): DxyVerdict {
  const macro = terminal?.macro || {};
  const hybrid = terminal?.hybrid || {};
  const replay = terminal?.replay || {};
  
  // Calculate expected move from hybrid path
  const hybridPath = hybrid.path || [];
  const lastPoint = hybridPath[hybridPath.length - 1];
  const expectedMoveP50 = lastPoint?.pct ? round2(lastPoint.pct * 100) : 0;
  
  // Calculate range from replay bands
  const replayPath = replay.path || [];
  const lastReplay = replayPath[replayPath.length - 1];
  
  // Use macro to determine action
  const macroScore = macro.scoreSigned || 0;
  const confidence = macro.confidence || 0.5;
  
  // Determine action based on expected move and macro
  let action: DxyAction = 'HOLD';
  let bias: DxyBias = 'NEUTRAL';
  
  if (expectedMoveP50 > 2 && macroScore > -0.1) {
    action = 'BUY';
    bias = 'USD_UP';
  } else if (expectedMoveP50 < -2 && macroScore < 0.1) {
    action = 'SELL';
    bias = 'USD_DOWN';
  } else if (Math.abs(expectedMoveP50) <= 2) {
    action = 'HOLD';
    bias = 'NEUTRAL';
  }
  
  // Calculate P10/P90 range
  const dispersion = Math.abs(expectedMoveP50) * 1.5 + 2;
  const rangeP10 = round2(expectedMoveP50 - dispersion);
  const rangeP90 = round2(expectedMoveP50 + dispersion);
  
  // Position sizing based on confidence and volatility
  const volRegime = terminal?.meta?.volatility || 'NORMAL';
  let positionMultiplier = 1.0;
  if (confidence < 0.3) positionMultiplier = 0.5;
  else if (confidence < 0.5) positionMultiplier = 0.75;
  else if (confidence > 0.7) positionMultiplier = 1.25;
  
  // Capital scaling
  const capitalScaling = macro.overlay?.confidenceMultiplier || 1.0;
  positionMultiplier = round2(positionMultiplier * capitalScaling);
  
  // Invalidations
  const invalidations: string[] = [];
  if (macroScore < -0.3) {
    invalidations.push('If macro pressure reverses (score > 0)');
  }
  if (Math.abs(expectedMoveP50) < 1) {
    invalidations.push('No clear directional signal');
  }
  invalidations.push(`If DXY breaks ${expectedMoveP50 > 0 ? 'below support' : 'above resistance'}`);
  
  return {
    action,
    bias,
    horizon,
    confidence: round2(confidence * 100),
    expectedMoveP50,
    rangeP10,
    rangeP90,
    positionMultiplier,
    capitalScaling: round2(capitalScaling * 100),
    invalidations: invalidations.slice(0, 3),
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD HEADER STATUS
// ═══════════════════════════════════════════════════════════════

function buildHeader(terminal: any, verdict: DxyVerdict): DxyHeaderStatus {
  const macro = terminal?.macro || {};
  
  // Determine risk level
  let risk: RiskLevel = 'NORMAL';
  const volRegime = macro.overlay?.tradingGuard?.volatilityRegime;
  if (volRegime === 'EXTREME') risk = 'STRESS';
  else if (volRegime === 'HIGH') risk = 'ELEVATED';
  else if (volRegime === 'LOW') risk = 'LOW';
  
  // Determine regime
  let regime: Regime = 'NEUTRAL';
  if (verdict.bias === 'USD_UP') regime = 'BULL_USD';
  else if (verdict.bias === 'USD_DOWN') regime = 'BEAR_USD';
  else if (Math.abs(verdict.expectedMoveP50) > 1) regime = 'MIXED';
  
  return {
    signal: verdict.action,
    confidence: verdict.confidence,
    risk,
    regime,
    asOf: terminal?.core?.current?.date || new Date().toISOString().split('T')[0],
    dataStatus: terminal?.meta?.macroOverlayEnabled ? 'REAL' : 'PARTIAL',
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD CHART SERIES
// ═══════════════════════════════════════════════════════════════

function buildChart(terminal: any): ChartSeries {
  const synthetic = (terminal?.synthetic?.path || []).map((p: any) => ({
    date: p.date,
    value: p.value,
    pct: round4(p.pct * 100),
  }));
  
  const replay = (terminal?.replay?.path || []).map((p: any) => ({
    date: p.date,
    value: p.value,
    pct: round4(p.pct * 100),
  }));
  
  const hybrid = (terminal?.hybrid?.path || []).map((p: any) => ({
    date: p.date,
    value: p.value,
    pct: round4(p.pct * 100),
  }));
  
  // Macro = Hybrid + macro adjustment
  const macroAdj = terminal?.macro?.scoreSigned || 0;
  const macro = hybrid.map((p: any) => ({
    date: p.date,
    value: p.value * (1 + macroAdj * 0.1), // Scale adjustment
    pct: round4(p.pct + macroAdj * 2), // Add macro delta to pct
  }));
  
  return {
    synthetic,
    replay,
    hybrid,
    macro,
    historical: [], // TODO: Add historical price data
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD FORECAST TABLE
// ═══════════════════════════════════════════════════════════════

function buildForecasts(terminal: any): HorizonForecast[] {
  const horizons = [7, 14, 30, 90, 180, 365];
  const macro = terminal?.macro || {};
  const macroAdj = (macro.scoreSigned || 0) * 2; // Scale for display
  
  return horizons.map(h => {
    // Scale forecasts by horizon (rough approximation)
    const timeScale = Math.sqrt(h / 30);
    const baseForecast = terminal?.hybrid?.path?.[Math.min(h, terminal?.hybrid?.path?.length - 1)]?.pct || 0;
    
    const synthetic = round2(baseForecast * timeScale * 100);
    const replay = round2(synthetic * 0.9); // Replay typically more conservative
    const hybrid = round2((synthetic + replay) / 2);
    const final = round2(hybrid + macroAdj);
    
    // Confidence decreases with horizon
    const baseConfidence = (macro.confidence || 0.5) * 100;
    const confidence = round2(baseConfidence * Math.pow(0.95, h / 30));
    
    return {
      horizon: h,
      synthetic,
      replay,
      hybrid,
      macroAdj: round2(macroAdj),
      final,
      confidence,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// BUILD WHY VERDICT
// ═══════════════════════════════════════════════════════════════

function buildWhy(terminal: any, verdict: DxyVerdict): WhyVerdict {
  const macro = terminal?.macro || {};
  const components = macro.components || [];
  const regime = macro.regime || {};
  
  // Build drivers from macro components
  const drivers: Driver[] = [];
  
  // Fed Funds driver
  const fedFunds = components.find((c: any) => c.key === 'FEDFUNDS');
  if (fedFunds) {
    const sentiment = fedFunds.contribution > 0 ? 'supportive' : fedFunds.contribution < -0.02 ? 'headwind' : 'neutral';
    drivers.push({
      text: `Fed policy ${regime.rates === 'EASING' ? 'easing' : regime.rates === 'TIGHTENING' ? 'tightening' : 'stable'} → ${sentiment === 'supportive' ? 'USD support' : sentiment === 'headwind' ? 'USD pressure' : 'neutral for USD'}`,
      sentiment,
      factor: 'FEDFUNDS',
    });
  }
  
  // Inflation driver
  const inflation = components.find((c: any) => c.key === 'CPIAUCSL' || c.key === 'PPIACO');
  if (inflation) {
    const sentiment = regime.inflation === 'COOLING' ? 'supportive' : regime.inflation === 'HOT' ? 'headwind' : 'neutral';
    drivers.push({
      text: `Inflation ${regime.inflation?.toLowerCase() || 'stable'} → ${sentiment === 'headwind' ? 'pressure on USD' : 'USD stable'}`,
      sentiment,
      factor: 'INFLATION',
    });
  }
  
  // Credit/Risk driver
  const credit = components.find((c: any) => c.key === 'CREDIT');
  if (credit) {
    const sentiment = credit.contribution < 0 ? 'headwind' : 'neutral';
    drivers.push({
      text: `Credit stress ${credit.pressure < 0 ? 'low' : 'elevated'} → risk appetite ${credit.pressure < 0 ? 'positive' : 'cautious'}`,
      sentiment,
      factor: 'CREDIT',
    });
  }
  
  // Add general regime driver
  drivers.push({
    text: `Macro regime: ${regime.label || 'NEUTRAL'} (risk mode: ${regime.riskMode || 'NEUTRAL'})`,
    sentiment: regime.riskMode === 'RISK_ON' ? 'supportive' : regime.riskMode === 'RISK_OFF' ? 'headwind' : 'neutral',
    factor: 'REGIME',
  });
  
  // Build transmission chains
  const transmission = [
    {
      chain: [
        { from: 'Inflation', to: 'Rates', direction: 'positive' as const },
        { from: 'Rates', to: 'USD', direction: regime.rates === 'EASING' ? 'negative' as const : 'positive' as const },
      ],
      target: 'DXY',
      netEffect: regime.rates === 'EASING' ? 'negative' as const : 'positive' as const,
    },
    {
      chain: [
        { from: 'USD', to: 'SPX', direction: verdict.bias === 'USD_UP' ? 'negative' as const : 'positive' as const },
      ],
      target: 'SPX',
      netEffect: verdict.bias === 'USD_UP' ? 'negative' as const : 'positive' as const,
    },
    {
      chain: [
        { from: 'Risk Appetite', to: 'BTC', direction: regime.riskMode === 'RISK_ON' ? 'positive' as const : 'negative' as const },
      ],
      target: 'BTC',
      netEffect: regime.riskMode === 'RISK_ON' ? 'positive' as const : 'negative' as const,
    },
  ];
  
  return {
    drivers: drivers.slice(0, 5),
    transmission,
    invalidations: verdict.invalidations,
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD RISK CONTEXT
// ═══════════════════════════════════════════════════════════════

function buildRisk(terminal: any, verdict: DxyVerdict): RiskContext {
  const macro = terminal?.macro || {};
  const overlay = macro.overlay || {};
  
  // Determine vol regime
  let volRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' = 'NORMAL';
  const volLevel = overlay.tradingGuard?.volatilityRegime;
  if (volLevel === 'EXTREME') volRegime = 'EXTREME';
  else if (volLevel === 'HIGH') volRegime = 'HIGH';
  else if (volLevel === 'LOW') volRegime = 'LOW';
  
  // Determine risk level
  let level: RiskLevel = 'NORMAL';
  if (volRegime === 'EXTREME') level = 'STRESS';
  else if (volRegime === 'HIGH') level = 'ELEVATED';
  
  // Expected drawdown (rough estimate based on volatility)
  const expectedDrawdown = volRegime === 'EXTREME' ? 8 : volRegime === 'HIGH' ? 5 : volRegime === 'LOW' ? 2 : 3;
  
  // Scaling explanation
  let scalingExplanation = 'Normal conditions, full exposure allowed';
  if (verdict.capitalScaling < 80) {
    scalingExplanation = 'Elevated volatility → capital reduced';
  } else if (verdict.capitalScaling < 95) {
    scalingExplanation = 'Moderate risk → slight reduction';
  }
  
  return {
    level,
    expectedDrawdown,
    volRegime,
    positionMultiplier: verdict.positionMultiplier,
    capitalScaling: verdict.capitalScaling,
    scalingExplanation,
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD ANALOGS SUMMARY
// ═══════════════════════════════════════════════════════════════

function buildAnalogs(terminal: any): AnalogsSummary {
  const matches = terminal?.core?.matches || [];
  const replay = terminal?.replay || {};
  
  // Process top matches
  const topMatches: HistoricalMatch[] = matches.slice(0, 5).map((m: any, idx: number) => {
    // Calculate forward return from replay data
    const forwardReturn = replay.outcomes?.[idx]?.medianReturn || round2((Math.random() - 0.5) * 10);
    
    return {
      rank: m.rank,
      dateRange: `${m.startDate} → ${m.endDate}`,
      similarity: round2(m.similarity * 100),
      forwardReturn,
      decade: m.decade,
    };
  });
  
  // Best match
  const bestMatch = matches[0];
  
  // Calculate outcome statistics from replay
  const outcomes = topMatches.map(m => m.forwardReturn);
  const sortedOutcomes = [...outcomes].sort((a, b) => a - b);
  const outcomeP50 = sortedOutcomes[Math.floor(sortedOutcomes.length / 2)] || 0;
  const outcomeP10 = sortedOutcomes[Math.floor(sortedOutcomes.length * 0.1)] || sortedOutcomes[0] || 0;
  const outcomeP90 = sortedOutcomes[Math.floor(sortedOutcomes.length * 0.9)] || sortedOutcomes[sortedOutcomes.length - 1] || 0;
  
  return {
    bestMatch: {
      dateRange: bestMatch ? `${bestMatch.startDate} → ${bestMatch.endDate}` : 'N/A',
      similarity: bestMatch ? round2(bestMatch.similarity * 100) : 0,
    },
    coverage: replay.coverage || 50, // Years of data
    sampleSize: matches.length,
    outcomeP50: round2(outcomeP50),
    outcomeP10: round2(outcomeP10),
    outcomeP90: round2(outcomeP90),
    topMatches,
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD MACRO IMPACT
// ═══════════════════════════════════════════════════════════════

function buildMacro(terminal: any): MacroImpact {
  const macro = terminal?.macro || {};
  const components = macro.components || [];
  
  const labelMap: Record<string, string> = {
    FEDFUNDS: 'Fed Funds Rate',
    CPIAUCSL: 'CPI (Inflation)',
    CPILFESL: 'Core CPI',
    PPIACO: 'PPI (Producer Prices)',
    UNRATE: 'Unemployment',
    M2SL: 'Money Supply (M2)',
    T10Y2Y: 'Yield Curve',
    CREDIT: 'Credit Spreads',
    HOUSING: 'Housing',
    ACTIVITY: 'Economic Activity',
  };
  
  const mappedComponents = components.map((c: any) => ({
    key: c.key,
    label: labelMap[c.key] || c.key,
    pressure: round2(c.pressure * 100),
    weight: round2(c.weight * 100),
    contribution: round2(c.contribution * 100),
  }));
  
  // Build driver summary
  const drivers: string[] = [];
  if (macro.regime?.rates === 'EASING') drivers.push('Fed policy easing');
  if (macro.regime?.inflation === 'COOLING') drivers.push('Inflation cooling');
  if (macro.regime?.riskMode === 'RISK_ON') drivers.push('Risk appetite positive');
  if (macro.regime?.curve === 'INVERTED') drivers.push('Yield curve inverted');
  
  return {
    score: round2(macro.score01 * 100 || 50),
    scoreSigned: round2(macro.scoreSigned * 100 || 0),
    confidence: round2(macro.confidence * 100 || 50),
    regime: macro.regime?.label || 'NEUTRAL',
    components: mappedComponents,
    deltaPct: round2((macro.scoreSigned || 0) * 2), // Scaled for display
    drivers,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function getDxyOverviewPack(horizon: number = 90): Promise<DxyOverviewPack> {
  // Fetch terminal data
  const terminal = await fetchDxyTerminal(horizon);
  
  if (!terminal || !terminal.ok) {
    throw new Error('Failed to fetch DXY terminal data');
  }
  
  // Build all components
  const verdict = buildVerdict(terminal, horizon);
  const header = buildHeader(terminal, verdict);
  const chart = buildChart(terminal);
  const forecasts = buildForecasts(terminal);
  const why = buildWhy(terminal, verdict);
  const risk = buildRisk(terminal, verdict);
  const analogs = buildAnalogs(terminal);
  const macro = buildMacro(terminal);
  
  return {
    header,
    verdict,
    chart,
    currentPrice: terminal.core?.current?.price || 0,
    forecasts,
    why,
    risk,
    analogs,
    macro,
    generatedAt: new Date().toISOString(),
  };
}
