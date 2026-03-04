/**
 * PHASE 2.3 — Confidence Decay Service
 * ======================================
 * 
 * Service layer for computing and storing confidence decay.
 */

import { ConfidenceRecordModel } from './confidence.model.js';
import { DatasetRowModel } from '../dataset/dataset.model.js';
import { 
  computeDecayFactor, 
  applyDecay,
  computeDecayByVerdict,
} from './confidence.engine.js';
import {
  ConfidenceRecord,
  DecayConfig,
  DEFAULT_DECAY_CONFIG,
  DecayResponse,
  DecayStatsResponse,
} from './confidence.types.js';

// ═══════════════════════════════════════════════════════════════
// COMPUTE DECAY
// ═══════════════════════════════════════════════════════════════

function generateRecordId(): string {
  return `decay_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Compute and store decay for a symbol
 */
export async function computeConfidenceDecay(
  symbol: string,
  rawConfidence: number,
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'ALL' = 'ALL',
  config: DecayConfig = DEFAULT_DECAY_CONFIG
): Promise<DecayResponse> {
  const normalizedSymbol = symbol.toUpperCase();

  // Get historical stats from dataset
  const matchQuery: any = { symbol: normalizedSymbol };
  if (verdict !== 'ALL') {
    // Map verdict to exchange verdict encoding
    const verdictMap: Record<string, number> = {
      'BULLISH': 1,
      'BEARISH': -1,
      'NEUTRAL': 0,
    };
    matchQuery['features.exchangeVerdict'] = verdictMap[verdict];
  }

  const stats = await DatasetRowModel.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        confirmed: {
          $sum: { $cond: ['$target.confirmed', 1, 0] },
        },
        diverged: {
          $sum: { $cond: ['$target.diverged', 1, 0] },
        },
      },
    },
  ]);

  const stat = stats[0] || { total: 0, confirmed: 0, diverged: 0 };

  // Compute decay
  const decayFactor = computeDecayFactor(stat.confirmed, stat.total, config);
  const adjustedConfidence = applyDecay(rawConfidence, decayFactor);
  const confirmationRate = stat.total > 0 ? stat.confirmed / stat.total : 0;

  // Create record
  const record: ConfidenceRecord = {
    recordId: generateRecordId(),
    symbol: normalizedSymbol,
    verdict,
    windowBars: config.windowBars,
    total: stat.total,
    confirmed: stat.confirmed,
    diverged: stat.diverged,
    confirmationRate: Math.round(confirmationRate * 1000) / 1000,
    decayFactor,
    rawConfidence,
    adjustedConfidence,
    calculatedAt: Date.now(),
    version: 'v1',
  };

  // Store record
  await ConfidenceRecordModel.create(record);

  console.log(`[Decay] ${normalizedSymbol}/${verdict}: decay=${decayFactor.toFixed(3)} (${stat.confirmed}/${stat.total})`);

  return {
    ok: true,
    symbol: normalizedSymbol,
    decayFactor,
    adjustedConfidence,
    record,
  };
}

/**
 * Get decay factor without storing (for quick lookups)
 */
export async function getDecayFactor(
  symbol: string,
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'ALL' = 'ALL'
): Promise<number> {
  const normalizedSymbol = symbol.toUpperCase();

  const matchQuery: any = { symbol: normalizedSymbol };
  if (verdict !== 'ALL') {
    const verdictMap: Record<string, number> = {
      'BULLISH': 1,
      'BEARISH': -1,
      'NEUTRAL': 0,
    };
    matchQuery['features.exchangeVerdict'] = verdictMap[verdict];
  }

  const stats = await DatasetRowModel.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        confirmed: {
          $sum: { $cond: ['$target.confirmed', 1, 0] },
        },
      },
    },
  ]);

  const stat = stats[0] || { total: 0, confirmed: 0 };
  return computeDecayFactor(stat.confirmed, stat.total);
}

// ═══════════════════════════════════════════════════════════════
// DECAY STATS
// ═══════════════════════════════════════════════════════════════

/**
 * Get comprehensive decay stats for a symbol
 */
export async function getDecayStats(symbol: string): Promise<DecayStatsResponse> {
  const normalizedSymbol = symbol.toUpperCase();

  // Get overall stats
  const overallStats = await DatasetRowModel.aggregate([
    { $match: { symbol: normalizedSymbol } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        confirmed: {
          $sum: { $cond: ['$target.confirmed', 1, 0] },
        },
        diverged: {
          $sum: { $cond: ['$target.diverged', 1, 0] },
        },
      },
    },
  ]);

  const overall = overallStats[0] || { total: 0, confirmed: 0, diverged: 0 };
  const overallRate = overall.total > 0 ? overall.confirmed / overall.total : 0;
  const overallDecay = computeDecayFactor(overall.confirmed, overall.total);

  // Get by-verdict stats
  const byVerdictStats = await DatasetRowModel.aggregate([
    { $match: { symbol: normalizedSymbol } },
    {
      $group: {
        _id: '$features.exchangeVerdict',
        total: { $sum: 1 },
        confirmed: {
          $sum: { $cond: ['$target.confirmed', 1, 0] },
        },
      },
    },
  ]);

  const verdictMap: Record<number, string> = {
    1: 'BULLISH',
    0: 'NEUTRAL',
    '-1': 'BEARISH',
  };

  const byVerdict = {
    BULLISH: { total: 0, confirmed: 0, decayFactor: 0.5 },
    BEARISH: { total: 0, confirmed: 0, decayFactor: 0.5 },
    NEUTRAL: { total: 0, confirmed: 0, decayFactor: 0.5 },
  };

  for (const stat of byVerdictStats) {
    const verdict = verdictMap[stat._id] as keyof typeof byVerdict;
    if (verdict && byVerdict[verdict]) {
      byVerdict[verdict] = {
        total: stat.total,
        confirmed: stat.confirmed,
        decayFactor: computeDecayFactor(stat.confirmed, stat.total),
      };
    }
  }

  return {
    ok: true,
    symbol: normalizedSymbol,
    overall: {
      total: overall.total,
      confirmed: overall.confirmed,
      diverged: overall.diverged,
      confirmationRate: Math.round(overallRate * 1000) / 1000,
      decayFactor: overallDecay,
    },
    byVerdict,
  };
}

/**
 * Get latest decay record for a symbol
 */
export async function getLatestDecayRecord(
  symbol: string,
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'ALL' = 'ALL'
): Promise<ConfidenceRecord | null> {
  return ConfidenceRecordModel.findOne({
    symbol: symbol.toUpperCase(),
    verdict,
  })
    .sort({ calculatedAt: -1 })
    .lean() as Promise<ConfidenceRecord | null>;
}

/**
 * Get decay history for a symbol
 */
export async function getDecayHistory(
  symbol: string,
  limit: number = 50
): Promise<ConfidenceRecord[]> {
  return ConfidenceRecordModel.find({
    symbol: symbol.toUpperCase(),
  })
    .sort({ calculatedAt: -1 })
    .limit(limit)
    .lean() as Promise<ConfidenceRecord[]>;
}

console.log('[Phase 2.3] Confidence Decay Service loaded');
