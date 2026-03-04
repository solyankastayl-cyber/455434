/**
 * Phase K: Feature Extractor
 * 
 * Extracts ML features from ta_runs, ta_scenarios, ta_outcomes
 * Must be leakage-safe: only use data available at signal time
 */

import { MLRow, MarketRegimeType, VolRegimeType } from './dataset_types.js';

/**
 * Extract features from a run/scenario/outcome triplet
 */
export function extractFeatures(params: {
  run: any;
  scenario: any;
  outcome: any;
}): MLRow {
  const { run, scenario, outcome } = params;

  // Extract features from run snapshot
  const snapshot = run.snapshot || run.contextSnapshot || {};
  const features = run.features || run.featurePack || {};

  // Regime extraction with fallbacks
  const marketRegime = (
    snapshot.marketRegime ||
    run.marketRegime ||
    'TRANSITION'
  ) as MarketRegimeType;

  const volRegime = (
    snapshot.volRegime ||
    run.volRegime ||
    'NORMAL'
  ) as VolRegimeType;

  // Pattern extraction
  const components = scenario.components || [];
  const patterns = scenario.patterns || components;

  // Risk pack extraction
  const riskPack = scenario.riskPack || {};
  const metrics = riskPack.metrics || {};

  // MA alignment conversion
  let maAlignment = 0;
  const maAlignmentRaw = features.maAlignment || snapshot.maAlignment || 'MIXED';
  if (maAlignmentRaw === 'BULL' || maAlignmentRaw === 'BULLISH') maAlignment = 1;
  else if (maAlignmentRaw === 'BEAR' || maAlignmentRaw === 'BEARISH') maAlignment = -1;

  // Trend alignment from structure
  let trendAlignment = 0;
  const direction = scenario.direction || 'NEUTRAL';
  const structureTrend = snapshot.trend || features.trend || 'SIDEWAYS';
  
  if (direction === 'BULL' || direction === 'BULLISH') {
    if (structureTrend === 'UPTREND') trendAlignment = 1;
    else if (structureTrend === 'DOWNTREND') trendAlignment = -1;
  } else if (direction === 'BEAR' || direction === 'BEARISH') {
    if (structureTrend === 'DOWNTREND') trendAlignment = 1;
    else if (structureTrend === 'UPTREND') trendAlignment = -1;
  }

  // Build ML row
  const row: MLRow = {
    // Identifiers
    runId: run.runId,
    scenarioId: scenario.scenarioId || scenario.id,
    asset: run.asset,
    timeframe: run.timeframe || '1D',
    createdAt: new Date(run.createdAt || run.ts).getTime(),

    // Target
    outcome: outcome.result === 'WIN' || outcome.status === 'WIN' ? 1 : 0,

    // Baseline prediction
    score: scenario.score || 0,
    calibratedProbability: scenario.probability || scenario.intent?.probability || 0,

    // Regime
    marketRegime,
    volRegime,

    // Pattern composition
    patternCount: patterns.length,
    primaryPattern: patterns[0]?.type || 'UNKNOWN',

    // Confluence
    confluenceScore: scenario.confluence?.score || scenario.confluenceScore || 0,
    confluenceFactors: scenario.confluence?.factors?.length || 0,

    // Structure
    trendAlignment,

    // MA features
    ma20Slope: features.maSlope20 || snapshot.maSlope20 || 0,
    ma50Slope: features.maSlope50 || snapshot.maSlope50 || 0,
    maAlignment,

    // Volatility
    atrPercentile: features.atrPercentile || snapshot.atrPercentile || 0.5,

    // Geometry
    compression: features.compression || snapshot.compression || 0,

    // Risk pack metrics
    rrToT1: metrics.rrToT1 || riskPack.rrToT1 || 0,
    rrToT2: metrics.rrToT2 || riskPack.rrToT2 || 0,
    riskPct: metrics.riskPct || riskPack.riskPct || 0,
    rewardPct: metrics.rewardPct || riskPack.rewardPct || 0,
  };

  return row;
}

/**
 * Validate that a row has required features
 */
export function isValidRow(row: MLRow): boolean {
  // Must have identifiers
  if (!row.runId || !row.scenarioId) return false;
  
  // Must have valid score
  if (typeof row.score !== 'number' || isNaN(row.score)) return false;
  
  // Must have valid outcome
  if (row.outcome !== 0 && row.outcome !== 1) return false;
  
  return true;
}

/**
 * Sanitize row values (clamp, handle NaN)
 */
export function sanitizeRow(row: MLRow): MLRow {
  const clamp = (v: number, min: number, max: number) => 
    Math.max(min, Math.min(max, isNaN(v) ? 0 : v));

  return {
    ...row,
    score: clamp(row.score, 0, 1),
    calibratedProbability: clamp(row.calibratedProbability, 0, 1),
    confluenceScore: clamp(row.confluenceScore, 0, 1),
    trendAlignment: clamp(row.trendAlignment, -1, 1),
    ma20Slope: isNaN(row.ma20Slope) ? 0 : row.ma20Slope,
    ma50Slope: isNaN(row.ma50Slope) ? 0 : row.ma50Slope,
    maAlignment: clamp(row.maAlignment, -1, 1),
    atrPercentile: clamp(row.atrPercentile, 0, 1),
    compression: clamp(row.compression, 0, 1),
    rrToT1: isNaN(row.rrToT1) ? 0 : row.rrToT1,
    rrToT2: isNaN(row.rrToT2) ? 0 : row.rrToT2,
    riskPct: isNaN(row.riskPct) ? 0 : row.riskPct,
    rewardPct: isNaN(row.rewardPct) ? 0 : row.rewardPct,
  };
}
