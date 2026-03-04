/**
 * PEEL_CHAIN Detector
 * 
 * Detects sequential peeling pattern:
 * Large amount → sequential small withdrawals → final large transfer
 * Classic money laundering technique
 */

import { Db } from 'mongodb';
import { BehavioralSignal } from './behavioral.types.js';
import { clamp01, severityByUsd } from '../../types.js';

export interface PeelChainParams {
  network: string;
  address: string;
  nowTs?: number;
}

/**
 * Detect peel chain pattern
 */
export async function detectPeelChain(
  db: Db,
  params: PeelChainParams
): Promise<BehavioralSignal[]> {
  const { network, address } = params;
  const now = params.nowTs ?? Math.floor(Date.now() / 1000);
  const signals: BehavioralSignal[] = [];

  const windowSec = 7 * 24 * 3600; // 7 days
  const fromTs = now - windowSec;

  // Get outgoing transfers sorted by time
  const transfers = await db
    .collection('transfers')
    .find({
      network,
      from: address.toLowerCase(),
      timestamp: { $gte: fromTs, $lte: now },
    })
    .sort({ timestamp: 1 })
    .limit(1000)
    .toArray();

  if (transfers.length < 5) return signals;

  // Calculate statistics
  const volumes = transfers.map((t) => t.valueUsd || 0);
  const avgVolume = volumes.reduce((s, v) => s + v, 0) / volumes.length;
  const maxVolume = Math.max(...volumes);

  // Look for peel pattern:
  // 1. Multiple small transfers (< 20% of max)
  // 2. Followed by larger transfer (> 50% of max)
  const smallTransfers = transfers.filter((t) => (t.valueUsd || 0) < maxVolume * 0.2);
  const largeTransfers = transfers.filter((t) => (t.valueUsd || 0) > maxVolume * 0.5);

  if (smallTransfers.length < 5 || largeTransfers.length === 0) return signals;

  // Check if large transfer comes after peeling
  const lastSmallTs = Math.max(...smallTransfers.map((t) => t.timestamp));
  const firstLargeTs = Math.min(...largeTransfers.map((t) => t.timestamp));

  if (firstLargeTs <= lastSmallTs) return signals;

  // Calculate metrics
  const totalPeeled = smallTransfers.reduce((s, t) => s + (t.valueUsd || 0), 0);
  const finalAmount = largeTransfers[0].valueUsd || 0;
  const peelRatio = totalPeeled / (totalPeeled + finalAmount);

  // Confidence scoring
  const countScore = clamp01((smallTransfers.length - 5) / 20);
  const ratioScore = clamp01(peelRatio / 0.7);
  const volumeScore = clamp01(Math.log10(totalPeeled) / 5);

  const confidence = clamp01(0.4 * countScore + 0.35 * ratioScore + 0.25 * volumeScore);

  if (confidence < 0.55) return signals;

  const severity = severityByUsd(totalPeeled + finalAmount);

  signals.push({
    id: `g3:peel_chain:${network}:${address}:${Math.floor(now / 60)}`,
    type: 'PEEL_CHAIN',
    severity,
    confidence,
    network,
    address,
    window: { fromTs, toTs: now, label: '7d' },
    metrics: {
      smallTransferCount: smallTransfers.length,
      totalPeeled,
      finalAmount,
      peelRatio: Math.round(peelRatio * 100) / 100,
      avgSmallAmount: Math.round(totalPeeled / smallTransfers.length),
      countScore: Math.round(countScore * 100) / 100,
      ratioScore: Math.round(ratioScore * 100) / 100,
      volumeScore: Math.round(volumeScore * 100) / 100,
    },
    evidence: [
      {
        kind: 'PATTERN',
        text: `Peel chain detected: ${smallTransfers.length} small transfers ($${Math.round(totalPeeled).toLocaleString()}) followed by large transfer ($${Math.round(finalAmount).toLocaleString()})`,
      },
    ],
    createdAtTs: now,
  });

  return signals;
}
