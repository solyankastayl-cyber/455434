/**
 * STRUCTURING Detector
 * 
 * Detects regular, similar-sized transfers (avoiding reporting thresholds)
 * Classic anti-money laundering red flag
 */

import { Db } from 'mongodb';
import { BehavioralSignal } from './behavioral.types.js';
import { clamp01, severityByUsd } from '../../types.js';

export interface StructuringParams {
  network: string;
  address: string;
  nowTs?: number;
}

/**
 * Detect structuring pattern
 */
export async function detectStructuring(
  db: Db,
  params: StructuringParams
): Promise<BehavioralSignal[]> {
  const { network, address } = params;
  const now = params.nowTs ?? Math.floor(Date.now() / 1000);
  const signals: BehavioralSignal[] = [];

  const windowSec = 30 * 24 * 3600; // 30 days
  const fromTs = now - windowSec;

  // Get outgoing transfers
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

  if (transfers.length < 10) return signals;

  // Group by similar amounts (within 10%)
  const amountGroups = new Map<number, any[]>();

  for (const tx of transfers) {
    const amount = tx.valueUsd || 0;
    if (amount < 1000) continue; // Skip very small amounts

    let found = false;
    for (const [baseAmount, group] of amountGroups) {
      const diff = Math.abs(amount - baseAmount) / baseAmount;
      if (diff < 0.1) {
        // Within 10%
        group.push(tx);
        found = true;
        break;
      }
    }

    if (!found) {
      amountGroups.set(amount, [tx]);
    }
  }

  // Look for groups with many similar transactions
  const structuringGroups: Array<{
    baseAmount: number;
    count: number;
    totalVolume: number;
    avgInterval: number;
  }> = [];

  for (const [baseAmount, group] of amountGroups) {
    if (group.length < 5) continue;

    const totalVolume = group.reduce((s, tx) => s + (tx.valueUsd || 0), 0);

    // Calculate average time interval
    const intervals: number[] = [];
    for (let i = 1; i < group.length; i++) {
      intervals.push(group[i].timestamp - group[i - 1].timestamp);
    }
    const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;

    structuringGroups.push({
      baseAmount,
      count: group.length,
      totalVolume,
      avgInterval,
    });
  }

  if (structuringGroups.length === 0) return signals;

  // Find most suspicious group
  const topGroup = structuringGroups.sort((a, b) => b.count - a.count)[0];

  // Confidence scoring
  const countScore = clamp01((topGroup.count - 5) / 30);
  const regularityScore = clamp01(1 / (1 + Math.log10(topGroup.avgInterval / 3600))); // More regular = higher score
  const volumeScore = clamp01(Math.log10(topGroup.totalVolume) / 5);

  const confidence = clamp01(0.4 * countScore + 0.35 * regularityScore + 0.25 * volumeScore);

  if (confidence < 0.55) return signals;

  const severity = severityByUsd(topGroup.totalVolume);

  signals.push({
    id: `g3:structuring:${network}:${address}:${Math.floor(now / 60)}`,
    type: 'STRUCTURING',
    severity,
    confidence,
    network,
    address,
    window: { fromTs, toTs: now, label: '30d' },
    metrics: {
      groupCount: topGroup.count,
      baseAmount: Math.round(topGroup.baseAmount),
      totalVolume: Math.round(topGroup.totalVolume),
      avgIntervalHours: Math.round(topGroup.avgInterval / 3600),
      countScore: Math.round(countScore * 100) / 100,
      regularityScore: Math.round(regularityScore * 100) / 100,
      volumeScore: Math.round(volumeScore * 100) / 100,
    },
    evidence: [
      {
        kind: 'PATTERN',
        text: `Structuring detected: ${topGroup.count} transfers of ~$${Math.round(topGroup.baseAmount).toLocaleString()} each (total: $${Math.round(topGroup.totalVolume).toLocaleString()}). Avg interval: ${Math.round(topGroup.avgInterval / 3600)}h`,
      },
    ],
    createdAtTs: now,
  });

  return signals;
}
