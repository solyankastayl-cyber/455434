/**
 * Watchlists Source
 * 
 * Internal watchlists for high-risk addresses
 */

import { Db } from 'mongodb';

export interface WatchlistInfo {
  tier: 'LOW' | 'MEDIUM' | 'HIGH';
  reason?: string;
}

/**
 * Get watchlist info for multiple addresses
 */
export async function getWatchlistMap(
  db: Db,
  network: string,
  addresses: string[]
): Promise<Map<string, WatchlistInfo>> {
  const normalized = addresses.map((a) => a.toLowerCase());
  const map = new Map<string, WatchlistInfo>();

  const rows = await db
    .collection('watchlists')
    .find({ network, address: { $in: normalized } })
    .toArray();

  for (const row of rows) {
    map.set(row.address, {
      tier: row.tier || 'MEDIUM',
      reason: row.reason,
    });
  }

  return map;
}

/**
 * Get watchlist info for single address
 */
export async function getWatchlistInfo(
  db: Db,
  network: string,
  address: string
): Promise<WatchlistInfo | null> {
  const normalized = address.toLowerCase();

  const doc = await db.collection('watchlists').findOne({
    network,
    address: normalized,
  });

  if (!doc) return null;

  return {
    tier: doc.tier || 'MEDIUM',
    reason: doc.reason,
  };
}
