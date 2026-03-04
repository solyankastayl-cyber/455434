/**
 * Exposure Analyzer
 * 
 * Analyzes counterparty exposure based on relations
 */

import { Db } from 'mongodb';
import { ExposureBucket, ExposureResult } from '../g3.types.js';
import { getLabelsForAddresses } from '../sources/labels.source.js';
import { getWatchlistMap } from '../sources/watchlists.source.js';
import { checkSanctionsBatch } from '../sources/sanctions.source.js';
import { G3_CONFIG } from '../g3.config.js';

/**
 * Determine bucket for address based on labels, watchlist, and sanctions
 */
function bucketFor(
  labelType?: string,
  watchTier?: string,
  isSanctioned?: boolean
): ExposureBucket {
  if (isSanctioned) return 'SANCTIONED';
  if (watchTier === 'HIGH') return 'HIGH_RISK';

  switch ((labelType || '').toUpperCase()) {
    case 'MIXER':
      return 'MIXER';
    case 'BRIDGE':
      return 'BRIDGE';
    case 'CEX':
    case 'EXCHANGE':
      return 'CEX';
    case 'DEFI':
    case 'DEX':
      return 'DEFI';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Compute exposure analysis for an address
 */
export async function computeExposure(
  db: Db,
  network: string,
  address: string,
  window: '7d' | '30d'
): Promise<ExposureResult> {
  const normalized = address.toLowerCase();

  // Calculate time window
  const windowSec = window === '7d' ? 7 * 24 * 3600 : 30 * 24 * 3600;
  const sinceTs = Math.floor(Date.now() / 1000) - windowSec;

  // Get relations (both directions)
  // Note: Adjust field names to match your schema
  const relations = await db
    .collection('relations')
    .aggregate([
      {
        $match: {
          network,
          $or: [{ from: normalized }, { to: normalized }],
          // Only include if lastSeen exists and is recent
          // If your schema uses different timestamp field, adjust
          ...(db.collection('relations').findOne({}, { projection: { lastSeen: 1 } })
            ? { lastSeen: { $exists: true } }
            : {}),
        },
      },
      {
        $project: {
          from: 1,
          to: 1,
          txCount: { $ifNull: ['$txCount', 0] },
          volumeUsd: { $ifNull: ['$volumeUsd', 0] },
          lastSeen: 1,
        },
      },
      { $limit: G3_CONFIG.maxRelations },
    ])
    .toArray();

  // Extract counterparties
  interface Counterparty {
    address: string;
    volumeUsd: number;
    txCount: number;
  }

  const counterparties: Counterparty[] = [];

  for (const rel of relations) {
    const cpAddress = rel.from === normalized ? rel.to : rel.from;
    counterparties.push({
      address: cpAddress,
      volumeUsd: rel.volumeUsd || 0,
      txCount: rel.txCount || 0,
    });
  }

  // Get unique counterparty addresses
  const uniqueAddresses = Array.from(
    new Set(counterparties.map((c) => c.address))
  );

  // Fetch metadata for counterparties
  const [labelsMap, watchMap, sanctionsMap] = await Promise.all([
    getLabelsForAddresses(db, network, uniqueAddresses),
    getWatchlistMap(db, network, uniqueAddresses),
    checkSanctionsBatch(db, network, uniqueAddresses),
  ]);

  // Calculate totals
  const totalVolumeUsd = counterparties.reduce(
    (sum, c) => sum + c.volumeUsd,
    0
  );
  const totalTxCount = counterparties.reduce((sum, c) => sum + c.txCount, 0);

  // Bucket volumes
  const byBucketVol: Record<ExposureBucket, number> = {
    CEX: 0,
    BRIDGE: 0,
    MIXER: 0,
    DEFI: 0,
    HIGH_RISK: 0,
    SANCTIONED: 0,
    UNKNOWN: 0,
  };

  // Sort counterparties by volume
  const sorted = [...counterparties].sort(
    (a, b) => b.volumeUsd - a.volumeUsd
  );

  // Build top counterparties list
  const topCounterparties = sorted
    .slice(0, G3_CONFIG.topCounterparties)
    .map((c) => {
      const label = labelsMap.get(c.address);
      const watch = watchMap.get(c.address);
      const sanctions = sanctionsMap.get(c.address);

      const bucket = bucketFor(
        label?.type,
        watch?.tier,
        sanctions?.isSanctioned
      );

      byBucketVol[bucket] += c.volumeUsd;

      return {
        address: c.address,
        bucket,
        volumeUsd: c.volumeUsd,
        txCount: c.txCount,
        share: totalVolumeUsd > 0 ? c.volumeUsd / totalVolumeUsd : 0,
        label: label?.label,
      };
    });

  // Account for remaining volume (not in top N)
  const topVolume = topCounterparties.reduce(
    (sum, c) => sum + c.volumeUsd,
    0
  );
  const remainingVolume = Math.max(0, totalVolumeUsd - topVolume);

  // Distribute remaining volume to UNKNOWN
  // (In production, you might want to analyze the tail as well)
  byBucketVol.UNKNOWN += remainingVolume;

  // Calculate bucket shares
  const byBucketShare = Object.fromEntries(
    (Object.keys(byBucketVol) as ExposureBucket[]).map((key) => [
      key,
      totalVolumeUsd > 0 ? byBucketVol[key] / totalVolumeUsd : 0,
    ])
  ) as Record<ExposureBucket, number>;

  return {
    byBucketShare,
    topCounterparties,
    totals: {
      totalVolumeUsd,
      totalTxCount,
      uniqueCounterparties: uniqueAddresses.length,
    },
  };
}
