/**
 * ROUND_TRIPPING Detector
 * 
 * Detects funds returning to origin after intermediate hops
 * A → B → C → A (with similar amounts)
 */

import { Db } from 'mongodb';
import { BehavioralSignal } from './behavioral.types.js';
import { clamp01, severityByUsd } from '../../types.js';

export interface RoundTrippingParams {
  network: string;
  address: string;
  nowTs?: number;
}

/**
 * Detect round tripping pattern
 */
export async function detectRoundTripping(
  db: Db,
  params: RoundTrippingParams
): Promise<BehavioralSignal[]> {
  const { network, address } = params;
  const now = params.nowTs ?? Math.floor(Date.now() / 1000);
  const signals: BehavioralSignal[] = [];

  const windowSec = 7 * 24 * 3600; // 7 days
  const fromTs = now - windowSec;

  // Get outgoing and incoming transfers
  const [outgoing, incoming] = await Promise.all([
    db
      .collection('transfers')
      .find({
        network,
        from: address.toLowerCase(),
        timestamp: { $gte: fromTs, $lte: now },
      })
      .sort({ timestamp: 1 })
      .limit(500)
      .toArray(),
    db
      .collection('transfers')
      .find({
        network,
        to: address.toLowerCase(),
        timestamp: { $gte: fromTs, $lte: now },
      })
      .sort({ timestamp: 1 })
      .limit(500)
      .toArray(),
  ]);

  if (outgoing.length === 0 || incoming.length === 0) return signals;

  // Look for round trips: similar amounts returning after delay
  const roundTrips: Array<{
    outTx: any;
    inTx: any;
    timeDiff: number;
    amountDiff: number;
  }> = [];

  for (const out of outgoing) {
    const outAmount = out.valueUsd || 0;
    if (outAmount < 1000) continue; // Skip small amounts

    for (const inc of incoming) {
      // Must be after outgoing
      if (inc.timestamp <= out.timestamp) continue;

      const inAmount = inc.valueUsd || 0;
      const timeDiff = inc.timestamp - out.timestamp;

      // Within 7 days and amount within 20%
      if (timeDiff > 7 * 24 * 3600) continue;

      const amountDiff = Math.abs(inAmount - outAmount) / outAmount;
      if (amountDiff > 0.2) continue;

      roundTrips.push({
        outTx: out,
        inTx: inc,
        timeDiff,
        amountDiff,
      });
    }
  }

  if (roundTrips.length < 2) return signals;

  // Calculate metrics
  const totalVolume = roundTrips.reduce((s, rt) => s + (rt.outTx.valueUsd || 0), 0);
  const avgTimeDiff = roundTrips.reduce((s, rt) => s + rt.timeDiff, 0) / roundTrips.length;
  const avgAmountDiff = roundTrips.reduce((s, rt) => s + rt.amountDiff, 0) / roundTrips.length;

  // Confidence scoring
  const countScore = clamp01((roundTrips.length - 2) / 10);
  const similarityScore = clamp01((1 - avgAmountDiff) / 0.8);
  const volumeScore = clamp01(Math.log10(totalVolume) / 5);

  const confidence = clamp01(0.4 * countScore + 0.35 * similarityScore + 0.25 * volumeScore);

  if (confidence < 0.55) return signals;

  const severity = severityByUsd(totalVolume);

  signals.push({
    id: `g3:round_tripping:${network}:${address}:${Math.floor(now / 60)}`,
    type: 'ROUND_TRIPPING',
    severity,
    confidence,
    network,
    address,
    window: { fromTs, toTs: now, label: '7d' },
    metrics: {
      roundTripCount: roundTrips.length,
      totalVolume,
      avgTimeDiff: Math.round(avgTimeDiff / 3600), // hours
      avgAmountDiff: Math.round(avgAmountDiff * 100) / 100,
      countScore: Math.round(countScore * 100) / 100,
      similarityScore: Math.round(similarityScore * 100) / 100,
      volumeScore: Math.round(volumeScore * 100) / 100,
    },
    evidence: [
      {
        kind: 'PATTERN',
        text: `Round tripping detected: ${roundTrips.length} instances of funds returning with ${Math.round((1 - avgAmountDiff) * 100)}% similarity. Total: $${Math.round(totalVolume).toLocaleString()}`,
      },
    ],
    createdAtTs: now,
  });

  return signals;
}
