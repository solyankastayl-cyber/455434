/**
 * DISPERSAL Detector (Relations-based)
 * 
 * Detects one-to-many rapid distribution patterns
 * Common in money laundering / rapid dispersal after exploit
 */

import { Db } from 'mongodb';
import { G2_CONFIG, getWindowLabel } from '../g2.config.js';
import {
  IntelligenceSignal,
  clamp01,
  severityByUsd,
  formatUsd,
} from '../../types.js';

export interface DispersalParams {
  network: string;
  address: string;
  nowTs?: number;
}

export async function detectDispersal(
  db: Db,
  params: DispersalParams
): Promise<IntelligenceSignal[]> {
  const { network, address } = params;
  const now = params.nowTs ?? Math.floor(Date.now() / 1000);
  const signals: IntelligenceSignal[] = [];

  const windowSec = G2_CONFIG.dispersal.windowSec;
  const fromTs = now - windowSec;
  const minRecipients = G2_CONFIG.dispersal.minUniqueRecipients;
  const minOutflow = G2_CONFIG.dispersal.minOutflowUsd;
  const maxTop1Share = G2_CONFIG.dispersal.maxTop1DestShare;

  // Get outgoing relations (many recipients)
  const outflowAgg = await db.collection('relations').aggregate([
    {
      $match: {
        network,
        from: address,
      },
    },
    {
      $group: {
        _id: '$to',
        volumeUsd: { $sum: '$volumeUsd' },
        txCount: { $sum: '$txCount' },
      },
    },
    { $sort: { volumeUsd: -1 } },
    {
      $group: {
        _id: null,
        totalOutflowUsd: { $sum: '$volumeUsd' },
        uniqueRecipients: { $sum: 1 },
        topDest: { $first: '$$ROOT' },
        dests: { $push: '$$ROOT' },
      },
    },
    {
      $project: {
        totalOutflowUsd: 1,
        uniqueRecipients: 1,
        topDest: 1,
        topDestShare: {
          $cond: [
            { $gt: ['$totalOutflowUsd', 0] },
            { $divide: ['$topDest.volumeUsd', '$totalOutflowUsd'] },
            0,
          ],
        },
        avgPerRecipient: {
          $cond: [
            { $gt: ['$uniqueRecipients', 0] },
            { $divide: ['$totalOutflowUsd', '$uniqueRecipients'] },
            0,
          ],
        },
        dests: { $slice: ['$dests', 10] },
      },
    },
  ]).toArray();

  const outflow = outflowAgg[0];
  if (!outflow) return signals;

  const uniqueRecipients = outflow.uniqueRecipients ?? 0;
  const totalOutflowUsd = outflow.totalOutflowUsd ?? 0;
  const topDestShare = outflow.topDestShare ?? 0;
  const avgPerRecipient = outflow.avgPerRecipient ?? 0;

  // Check thresholds
  if (uniqueRecipients < minRecipients) return signals;
  if (totalOutflowUsd < minOutflow) return signals;
  if (topDestShare > maxTop1Share) return signals; // Too concentrated

  // Get inflow for context
  const inflowAgg = await db.collection('relations').aggregate([
    {
      $match: {
        network,
        to: address,
      },
    },
    {
      $group: {
        _id: null,
        totalInflowUsd: { $sum: '$volumeUsd' },
        uniqueSenders: { $sum: 1 },
      },
    },
  ]).toArray();

  const totalInflowUsd = inflowAgg[0]?.totalInflowUsd ?? 0;
  const uniqueSenders = inflowAgg[0]?.uniqueSenders ?? 0;

  // Calculate confidence
  const recipientScore = clamp01(
    (uniqueRecipients - minRecipients) / (minRecipients * 2)
  );
  const volScore = clamp01(Math.log10(totalOutflowUsd / minOutflow) / 1.5);
  const dispersionScore = clamp01(
    (maxTop1Share - topDestShare) / maxTop1Share
  );
  const fanoutScore = clamp01(
    (uniqueRecipients / Math.max(uniqueSenders, 1)) / 3
  );

  const confidence = clamp01(
    0.35 * recipientScore +
      0.30 * volScore +
      0.25 * dispersionScore +
      0.10 * fanoutScore
  );

  if (confidence < G2_CONFIG.dispersal.minConfidence) return signals;

  const severity = severityByUsd(totalOutflowUsd);
  const windowLabel = getWindowLabel(windowSec);

  signals.push({
    id: `g2:dispersal:${network}:${address}:${windowSec}:${Math.floor(now / 60)}`,
    domain: 'CYBERCRIME',
    type: 'RAPID_DISPERSAL',
    severity,
    confidence,
    network,
    subject: { kind: 'ADDRESS', id: address },
    window: { fromTs, toTs: now, label: windowLabel },
    metrics: {
      totalOutflowUsd,
      totalInflowUsd,
      uniqueRecipients,
      uniqueSenders,
      fanoutRatio: Math.round((uniqueRecipients / Math.max(uniqueSenders, 1)) * 100) / 100,
      topDest: outflow.topDest?._id,
      topDestShare: Math.round(topDestShare * 100) / 100,
      avgPerRecipient: Math.round(avgPerRecipient),
      top10Dests: outflow.dests,
      recipientScore: Math.round(recipientScore * 100) / 100,
      volScore: Math.round(volScore * 100) / 100,
      dispersionScore: Math.round(dispersionScore * 100) / 100,
      fanoutScore: Math.round(fanoutScore * 100) / 100,
    },
    evidence: [
      {
        kind: 'NOTE',
        text: `Rapid dispersal: ${formatUsd(totalOutflowUsd)} distributed to ${uniqueRecipients} recipients. Avg per recipient: ${formatUsd(avgPerRecipient)}`,
      },
    ],
    createdAtTs: now,
  });

  return signals;
}
