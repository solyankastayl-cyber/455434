/**
 * RAPID_DRAIN Detector (Transfers-based)
 * 
 * Detects rapid, large outflows to many destinations
 * Classic hack/exploit pattern
 */

import { Db } from 'mongodb';
import { G2_CONFIG, getWindowLabel } from '../g2.config.js';
import { 
  IntelligenceSignal, 
  clamp01, 
  severityByUsd, 
  formatUsd 
} from '../../types.js';

export interface RapidDrainParams {
  network: string;
  address: string;
  nowTs?: number;
}

export async function detectRapidDrain(
  db: Db,
  params: RapidDrainParams
): Promise<IntelligenceSignal[]> {
  const { network, address } = params;
  const now = params.nowTs ?? Math.floor(Date.now() / 1000);
  const signals: IntelligenceSignal[] = [];

  for (const windowSec of G2_CONFIG.rapidDrain.windowsSec) {
    const fromTs = now - windowSec;
    const minOut = G2_CONFIG.rapidDrain.minOutflowUsd[windowSec];
    const minDests = G2_CONFIG.rapidDrain.minUniqueDests[windowSec];

    // Aggregate outflows from address in window
    const outflowAgg = await db.collection('transfers').aggregate([
      {
        $match: {
          network,
          from: address,
          timestamp: { $gte: fromTs, $lte: now },
        },
      },
      {
        $group: {
          _id: '$to',
          txCount: { $sum: 1 },
          volumeUsd: { $sum: '$valueUsd' },
          lastTs: { $max: '$timestamp' },
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
    if (!outflow) continue;

    const outflowUsd = outflow.totalOutflowUsd ?? 0;
    const uniqueDests = outflow.uniqueDests ?? 0;

    // Check thresholds
    if (outflowUsd < minOut) continue;
    if (uniqueDests < minDests) continue;

    // Calculate inflows in same window
    const inflowAgg = await db.collection('transfers').aggregate([
      {
        $match: {
          network,
          to: address,
          timestamp: { $gte: fromTs, $lte: now },
        },
      },
      {
        $group: {
          _id: null,
          totalInflowUsd: { $sum: '$valueUsd' },
          txCount: { $sum: 1 },
        },
      },
    ]).toArray();

    const inflowUsd = inflowAgg[0]?.totalInflowUsd ?? 0;
    const outToInRatio = inflowUsd > 0 ? outflowUsd / inflowUsd : 999;

    // Check ratio threshold
    if (outToInRatio < G2_CONFIG.rapidDrain.minOutToInRatio) continue;

    // Calculate confidence (deterministic model)
    const volScore = clamp01(Math.log10(outflowUsd / minOut) / 1.5);
    const destScore = clamp01((uniqueDests - minDests) / (minDests * 2));
    const ratioScore = clamp01(Math.log10(outToInRatio) / 1.2);
    const confidence = clamp01(
      0.45 * volScore + 0.35 * destScore + 0.20 * ratioScore
    );

    if (confidence < G2_CONFIG.rapidDrain.minConfidence) continue;

    const severity = severityByUsd(outflowUsd);
    const windowLabel = getWindowLabel(windowSec);

    signals.push({
      id: `g2:rapid_drain:${network}:${address}:${windowSec}:${Math.floor(now / 60)}`,
      domain: 'CYBERCRIME',
      type: 'RAPID_DRAIN',
      severity,
      confidence,
      network,
      subject: { kind: 'ADDRESS', id: address },
      window: { fromTs, toTs: now, label: windowLabel },
      metrics: {
        outflowUsd,
        inflowUsd,
        outToInRatio: Math.round(outToInRatio * 100) / 100,
        uniqueDests,
        topDest: outflow.topDest?._id,
        topDestShare: Math.round((outflow.topDestShare ?? 0) * 100) / 100,
        top10Dests: outflow.dests,
        volScore: Math.round(volScore * 100) / 100,
        destScore: Math.round(destScore * 100) / 100,
        ratioScore: Math.round(ratioScore * 100) / 100,
      },
      evidence: [
        {
          kind: 'NOTE',
          text: `Rapid outflow: ${formatUsd(outflowUsd)} to ${uniqueDests} destinations in ${windowLabel}. Ratio out/in: ${Math.round(outToInRatio * 10) / 10}x`,
        },
      ],
      createdAtTs: now,
    });
  }

  return signals;
}
