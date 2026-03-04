/**
 * Deduplication Event Schema (A1)
 * 
 * Purpose: Track deduplicated events to avoid noise
 * Question: "Это новое событие или повтор?"
 * 
 * NOT responsible for:
 * - Severity calculation
 * - Dispatch decisions
 * - Grouping
 * - UI logic
 */
import { z } from 'zod';

export const DedupStatusEnum = z.enum(['first_seen', 'repeated', 'suppressed']);

export const DedupEventSchema = z.object({
  dedupKey: z.string(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  count: z.number().default(1),
  status: DedupStatusEnum,
  lastEventId: z.string(),
  
  // Metadata for debugging
  signalType: z.string(),
  targetId: z.string(),
});

export const DedupedEventSchema = z.object({
  // Original normalized event
  normalizedEvent: z.any(), // NormalizedAlertEvent
  
  // Dedup info
  dedupStatus: DedupStatusEnum,
  occurrenceCount: z.number(),
  firstSeenAt: z.date().optional(),
  dedupKey: z.string(),
});

// Type exports
export type DedupStatus = z.infer<typeof DedupStatusEnum>;
export type DedupEvent = z.infer<typeof DedupEventSchema>;
export type DedupedEvent = z.infer<typeof DedupedEventSchema>;
