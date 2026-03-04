/**
 * Labels Source
 * 
 * Get entity labels (CEX, Bridge, Mixer, DeFi, etc.)
 */

import { Db } from 'mongodb';

export interface LabelInfo {
  type: string;
  label?: string;
  riskTier?: string;
}

/**
 * Get labels for multiple addresses
 */
export async function getLabelsForAddresses(
  db: Db,
  network: string,
  addresses: string[]
): Promise<Map<string, LabelInfo>> {
  const normalized = addresses.map((a) => a.toLowerCase());
  const map = new Map<string, LabelInfo>();

  const rows = await db
    .collection('labels')
    .find({ network, address: { $in: normalized } })
    .toArray();

  for (const row of rows) {
    map.set(row.address, {
      type: row.type || 'UNKNOWN',
      label: row.label,
      riskTier: row.riskTier,
    });
  }

  return map;
}

/**
 * Get label for single address
 */
export async function getLabelForAddress(
  db: Db,
  network: string,
  address: string
): Promise<LabelInfo | null> {
  const normalized = address.toLowerCase();

  const doc = await db.collection('labels').findOne({
    network,
    address: normalized,
  });

  if (!doc) return null;

  return {
    type: doc.type || 'UNKNOWN',
    label: doc.label,
    riskTier: doc.riskTier,
  };
}
