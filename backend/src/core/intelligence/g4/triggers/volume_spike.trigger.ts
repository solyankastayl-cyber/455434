/**
 * Volume Spike Trigger
 * 
 * Detects sudden volume increases (5x+ average)
 */

import { Db } from 'mongodb';
import { AlertEvent } from '../g4.types.js';

export interface VolumeSpikeParams {
  network: string;
  address: string;
  watchlistId: string;
  thresholdMultiplier?: number; // default 5x
}

/**
 * Check for volume spike
 */
export async function checkVolumeSpike(
  db: Db,
  params: VolumeSpikeParams
): Promise<AlertEvent | null> {
  const { network, address, watchlistId } = params;
  const thresholdMultiplier = params.thresholdMultiplier || 5;

  const now = Math.floor(Date.now() / 1000);
  const last1h = now - 3600;
  const last24h = now - 24 * 3600;

  // Get volume in last hour
  const recent = await db
    .collection('transfers')
    .aggregate([
      {
        $match: {
          network,
          from: address.toLowerCase(),
          timestamp: { $gte: last1h, $lte: now },
        },
      },
      {
        $group: {
          _id: null,
          volumeUsd: { $sum: '$valueUsd' },
          txCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  if (!recent[0] || recent[0].volumeUsd === 0) return null;

  const recentVolume = recent[0].volumeUsd;
  const recentTxCount = recent[0].txCount;

  // Get average volume in previous 24h (excluding last hour)
  const baseline = await db
    .collection('transfers')
    .aggregate([
      {
        $match: {
          network,
          from: address.toLowerCase(),
          timestamp: { $gte: last24h, $lt: last1h },
        },
      },
      {
        $group: {
          _id: null,
          volumeUsd: { $sum: '$valueUsd' },
          txCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  if (!baseline[0] || baseline[0].volumeUsd === 0) return null;

  const baselineVolume = baseline[0].volumeUsd / 23; // Average per hour
  const ratio = recentVolume / baselineVolume;

  if (ratio < thresholdMultiplier) return null;

  // Generate alert
  const severity =
    ratio >= 20 ? 'CRITICAL' : ratio >= 10 ? 'HIGH' : ratio >= 5 ? 'MEDIUM' : 'LOW';

  const alert: AlertEvent = {
    id: `alert:volume_spike:${watchlistId}:${Date.now()}`,
    watchlistId,
    triggerType: 'VOLUME_SPIKE',
    severity,
    network,
    subject: address,
    title: 'Volume Spike Detected',
    message: `Volume increased ${Math.round(ratio)}x: $${Math.round(recentVolume).toLocaleString()} in last hour (baseline: $${Math.round(baselineVolume).toLocaleString()}/hr)`,
    metrics: {
      recentVolume,
      baselineVolume,
      ratio: Math.round(ratio * 10) / 10,
      recentTxCount,
    },
    timestamp: new Date(),
    notified: false,
  };

  return alert;
}
