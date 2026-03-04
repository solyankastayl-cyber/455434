/**
 * Event Deduplicator (P2.3.2)
 * 
 * Generates deterministic event IDs to prevent duplicates
 */

import crypto from 'crypto';
import type { UnifiedChainEvent } from '../storage/unified_events.model.js';

/**
 * Generate deterministic event ID
 * 
 * Uses SHA256 hash of:
 * - chain
 * - txHash
 * - from
 * - to
 * - amount
 * - tokenAddress (if present)
 * 
 * This ensures:
 * - Same event from RPC + Explorer = 1 record
 * - Safe for cron/realtime ingestion
 * - No duplicates across retries
 */
export function generateEventId(event: {
  chain: string;
  txHash: string;
  from: string;
  to: string;
  amount: string;
  tokenAddress?: string;
}): string {
  const components = [
    event.chain.toLowerCase(),
    event.txHash.toLowerCase(),
    event.from.toLowerCase(),
    event.to.toLowerCase(),
    event.amount,
    event.tokenAddress?.toLowerCase() || 'native'
  ];
  
  const hash = crypto
    .createHash('sha256')
    .update(components.join(':'))
    .digest('hex');
  
  return `evt_${hash.substring(0, 32)}`;
}

/**
 * Add event IDs to batch of events
 */
export function addEventIds(events: Omit<UnifiedChainEvent, 'eventId'>[]): UnifiedChainEvent[] {
  return events.map(event => ({
    ...event,
    eventId: generateEventId(event)
  }));
}

/**
 * Deduplicate events in memory before insertion
 * 
 * Keeps the first occurrence of each unique event
 */
export function deduplicateInMemory(events: UnifiedChainEvent[]): UnifiedChainEvent[] {
  const seen = new Set<string>();
  const unique: UnifiedChainEvent[] = [];
  
  for (const event of events) {
    if (!seen.has(event.eventId)) {
      seen.add(event.eventId);
      unique.push(event);
    }
  }
  
  return unique;
}

/**
 * Find duplicate event IDs in a batch
 */
export function findDuplicates(events: UnifiedChainEvent[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  
  for (const event of events) {
    if (seen.has(event.eventId)) {
      duplicates.push(event.eventId);
    } else {
      seen.add(event.eventId);
    }
  }
  
  return duplicates;
}
