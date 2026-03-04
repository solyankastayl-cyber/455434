/**
 * Sanctions Source
 * 
 * Check if address is on sanctions lists (OFAC, EU, UN, etc.)
 */

import { Db } from 'mongodb';

export interface SanctionsCheck {
  isSanctioned: boolean;
  lists: string[];
  confidence: number;
}

/**
 * Check if address is sanctioned (exact match)
 */
export async function checkSanctionsExact(
  db: Db,
  network: string,
  address: string
): Promise<SanctionsCheck> {
  const normalized = address.toLowerCase();

  // Check sanctions collection
  const doc = await db.collection('sanctions').findOne({
    network,
    address: normalized,
  });

  if (!doc) {
    return {
      isSanctioned: false,
      lists: [],
      confidence: 0,
    };
  }

  // Extract lists (support both single listName and multiple lists)
  const lists = Array.isArray(doc.lists)
    ? doc.lists
    : doc.listName
    ? [doc.listName]
    : ['UNKNOWN'];

  return {
    isSanctioned: true,
    lists,
    confidence: 1.0, // exact match = 100% confidence
  };
}

/**
 * Batch check sanctions for multiple addresses
 */
export async function checkSanctionsBatch(
  db: Db,
  network: string,
  addresses: string[]
): Promise<Map<string, SanctionsCheck>> {
  const normalized = addresses.map((a) => a.toLowerCase());
  const results = new Map<string, SanctionsCheck>();

  const docs = await db
    .collection('sanctions')
    .find({
      network,
      address: { $in: normalized },
    })
    .toArray();

  // Initialize all as not sanctioned
  for (const addr of normalized) {
    results.set(addr, {
      isSanctioned: false,
      lists: [],
      confidence: 0,
    });
  }

  // Update sanctioned ones
  for (const doc of docs) {
    const lists = Array.isArray(doc.lists)
      ? doc.lists
      : doc.listName
      ? [doc.listName]
      : ['UNKNOWN'];

    results.set(doc.address, {
      isSanctioned: true,
      lists,
      confidence: 1.0,
    });
  }

  return results;
}
