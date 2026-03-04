/**
 * FUNNEL Detector (Relations-based)
 * 
 * Detects many-to-one-to-few patterns
 * Classic scam collection pattern
 */

import { Db } from 'mongodb';
import { G2_CONFIG, getWindowLabel } from '../g2.config.js';
import {
  IntelligenceSignal,
  clamp01,
  severityByUsd,
  formatUsd,
} from '../../types.js';

export interface FunnelParams {
  network: string;
  address: string;
  nowTs?: number;
}

export async function detectFunnel(
  db: Db,
  params: FunnelParams
): Promise<IntelligenceSignal[]> {
  const { network, address } = params;
  const now = params.nowTs ?? Math.floor(Date.now() / 1000);
  const signals: IntelligenceSignal[] = [];

  const windowSec = G2_CONFIG.funnel.windowSec;
  const fromTs = now - windowSec;
  const minSenders = G2_CONFIG.funnel.minUniqueSenders;
  const minOutflow = G2_CONFIG.funnel.minOutflowUsd;
  const maxTop1Share = G2_CONFIG.funnel.maxTop1DestShare;
  const minInOutRatio = G2_CONFIG.funnel.minInToOutRatio;

  // Get incoming relations (many senders)
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
        uniqueSenders: { $sum: 1 },
        totalInflowUsd: { $sum: '$volumeUsd' },
        totalTxCount: { $sum: '$txCount' },
      },
    },
  ]).toArray();

  const inflow = inflowAgg[0];
  if (!inflow) return signals;

  const uniqueSenders = inflow.uniqueSenders ?? 0;
  const totalInflowUsd = inflow.totalInflowUsd ?? 0;

  // Check sender threshold
  if (uniqueSenders < minSenders) return signals;

  // Get outgoing relations
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
        uniqueDests: { $sum: 1 },
        topDest: { $first: '$$ROOT' },
        dests: { $push: '$$ROOT' },
      },
    },
    {
      $project: {
        totalOutflowUsd: 1,
        uniqueDests: 1,
        topDest: 1,
        topDestShare: {
          $cond: [
            { $gt: ['$totalOutflowUsd', 0] },
            { $divide: ['$topDest.volumeUsd', '$totalOutflowUsd'] },
            0,
          ],
        },
        dests: { $slice: ['$dests', 10] },
      },
    },
  ]).toArray();

  const outflow = outflowAgg[0];
  if (!outflow) return signals;

  const totalOutflowUsd = outflow.totalOutflowUsd ?? 0;
  const topDestShare = outflow.topDestShare ?? 0;
  const uniqueDests = outflow.uniqueDests ?? 0;

  // Check thresholds
  if (totalOutflowUsd < minOutflow) return signals;
  if (topDestShare > maxTop1Share) return signals; // Too concentrated - likely normal payout

  const inOutRatio = totalOutflowUsd > 0 ? totalInflowUsd / totalOutflowUsd : 0;
  if (inOutRatio < minInOutRatio) return signals;

  // Calculate confidence
  const senderScore = clamp01((uniqueSenders - minSenders) / (minSenders * 3));
  const volScore = clamp01(Math.log10(totalOutflowUsd / minOutflow) / 1.5);
  const dispersionScore = clamp01((maxTop1Share - topDestShare) / maxTop1Share);
  const ratioScore = clamp01((inOutRatio - minInOutRatio) / 2);

  const confidence = clamp01(
    0.30 * senderScore +
      0.30 * volScore +
      0.25 * dispersionScore +
      0.15 * ratioScore
  );

  if (confidence < G2_CONFIG.funnel.minConfidence) return signals;

  const severity = severityByUsd(totalOutflowUsd);
  const windowLabel = getWindowLabel(windowSec);

  signals.push({
    id: `g2:funnel:${network}:${address}:${windowSec}:${Math.floor(now / 60)}`,
    domain: 'CYBERCRIME',
    type: 'FUNNEL_SCAM',
    severity,
    confidence,
    network,
    subject: { kind: 'ADDRESS', id: address },
    window: { fromTs, toTs: now, label: windowLabel },
    metrics: {
      uniqueSenders,
      totalInflowUsd,
      totalOutflowUsd,
      inOutRatio: Math.round(inOutRatio * 100) / 100,
      uniqueDests,
      topDest: outflow.topDest?._id,
      topDestShare: Math.round(topDestShare * 100) / 100,
      top10Dests: outflow.dests,
      senderScore: Math.round(senderScore * 100) / 100,
      volScore: Math.round(volScore * 100) / 100,
      dispersionScore: Math.round(dispersionScore * 100) / 100,
      ratioScore: Math.round(ratioScore * 100) / 100,
    },
    evidence: [
      {
        kind: 'NOTE',
        text: `Funnel pattern: ${uniqueSenders} senders → ${formatUsd(totalInflowUsd)} collected → ${uniqueDests} destinations. Top destination: ${Math.round(topDestShare * 100)}%`,
      },
    ],
    createdAtTs: now,
  });

  return signals;
}
