/**
 * BRIDGE_ESCAPE Detector (Transfers-based)
 * 
 * Detects large outflows to bridge contracts
 * Common pattern after exploits - escaping to another chain
 */

import { Db } from 'mongodb';
import { G2_CONFIG, getWindowLabel } from '../g2.config.js';
import {
  IntelligenceSignal,
  clamp01,
  severityByUsd,
  formatUsd,
} from '../../types.js';

export interface BridgeEscapeParams {
  network: string;
  address: string;
  nowTs?: number;
}

// Known bridge contracts (this should ideally come from your bridge registry)
const KNOWN_BRIDGES: Record<string, string[]> = {
  ethereum: [
    '0x8484ef722627bf18ca5ae6bcf031c23e6e922b30', // Arbitrum Bridge
    '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', // Optimism Bridge
    '0x3154cf16ccdb4c6d922629664174b904d80f2c35', // Base Bridge
    '0xa0c68c638235ee32657e8f720a23cec1bfc77c77', // Polygon Bridge
  ],
  arbitrum: [
    '0x0000000000000000000000000000000000000064', // Arbitrum System
  ],
  // Add more as needed
};

export async function detectBridgeEscape(
  db: Db,
  params: BridgeEscapeParams
): Promise<IntelligenceSignal[]> {
  const { network, address } = params;
  const now = params.nowTs ?? Math.floor(Date.now() / 1000);
  const signals: IntelligenceSignal[] = [];

  const windowSec = G2_CONFIG.bridgeEscape.windowSec;
  const fromTs = now - windowSec;
  const minBridgeOut = G2_CONFIG.bridgeEscape.minBridgeOutflowUsd;
  const minBridgeShare = G2_CONFIG.bridgeEscape.minBridgeShare;

  // Get known bridges for this network
  const bridges = KNOWN_BRIDGES[network] || [];
  if (bridges.length === 0) {
    // No bridge data for this network
    return signals;
  }

  // Aggregate outflows
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
        _id: null,
        totalOutflowUsd: { $sum: '$valueUsd' },
        allDests: { $push: { to: '$to', value: '$valueUsd' } },
      },
    },
  ]).toArray();

  const outflow = outflowAgg[0];
  if (!outflow) return signals;

  const totalOutflowUsd = outflow.totalOutflowUsd ?? 0;
  if (totalOutflowUsd === 0) return signals;

  // Calculate bridge outflow
  const bridgeDests = outflow.allDests.filter((d: any) =>
    bridges.some((b) => b.toLowerCase() === d.to.toLowerCase())
  );

  const bridgeOutflowUsd = bridgeDests.reduce(
    (sum: number, d: any) => sum + (d.value ?? 0),
    0
  );

  const bridgeShare = bridgeOutflowUsd / totalOutflowUsd;

  // Check thresholds
  if (bridgeOutflowUsd < minBridgeOut) return signals;
  if (bridgeShare < minBridgeShare) return signals;

  // Calculate confidence
  const volScore = clamp01(Math.log10(bridgeOutflowUsd / minBridgeOut) / 1.5);
  const shareScore = clamp01((bridgeShare - minBridgeShare) / (1 - minBridgeShare));
  const confidence = clamp01(0.60 * volScore + 0.40 * shareScore);

  if (confidence < G2_CONFIG.bridgeEscape.minConfidence) return signals;

  const severity = severityByUsd(bridgeOutflowUsd);
  const windowLabel = getWindowLabel(windowSec);

  // Determine target networks (simplified - in production, use bridge registry)
  const targetNetworks = new Set<string>();
  bridgeDests.forEach((d: any) => {
    if (d.to.toLowerCase().includes('arbitrum')) targetNetworks.add('arbitrum');
    if (d.to.toLowerCase().includes('optimism')) targetNetworks.add('optimism');
    if (d.to.toLowerCase().includes('base')) targetNetworks.add('base');
    if (d.to.toLowerCase().includes('polygon')) targetNetworks.add('polygon');
  });

  signals.push({
    id: `g2:bridge_escape:${network}:${address}:${windowSec}:${Math.floor(now / 60)}`,
    domain: 'CYBERCRIME',
    type: 'BRIDGE_ESCAPE',
    severity,
    confidence,
    network,
    subject: { kind: 'ADDRESS', id: address },
    window: { fromTs, toTs: now, label: windowLabel },
    metrics: {
      totalOutflowUsd,
      bridgeOutflowUsd,
      bridgeShare: Math.round(bridgeShare * 100) / 100,
      bridgeCount: bridgeDests.length,
      targetNetworks: Array.from(targetNetworks),
      volScore: Math.round(volScore * 100) / 100,
      shareScore: Math.round(shareScore * 100) / 100,
    },
    evidence: [
      {
        kind: 'NOTE',
        text: `Bridge escape: ${formatUsd(bridgeOutflowUsd)} (${Math.round(bridgeShare * 100)}% of outflow) to ${targetNetworks.size} target network(s) in ${windowLabel}`,
      },
    ],
    createdAtTs: now,
  });

  return signals;
}
