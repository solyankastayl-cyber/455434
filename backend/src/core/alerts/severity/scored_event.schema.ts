/**
 * Scored Event Schema (A2)
 * 
 * Purpose: Event with severity score and priority
 * Question: "Насколько это событие важно для пользователя прямо сейчас?"
 * 
 * NOT responsible for:
 * - Grouping (A3)
 * - Lifecycle management (A3)
 * - Dispatch decisions (A4)
 * - UI/Telegram logic
 */
import { z } from 'zod';

export const PriorityBucketEnum = z.enum(['low', 'medium', 'high']);

export const SeverityReasonSchema = z.object({
  summary: z.string(),
  details: z.array(z.string()),
});

export const ScoredEventSchema = z.object({
  // From previous layers
  normalizedEvent: z.any(), // NormalizedAlertEvent
  dedupStatus: z.enum(['first_seen', 'repeated', 'suppressed']),
  occurrenceCount: z.number(),
  dedupKey: z.string(),
  
  // A2 calculations
  severityScore: z.number().min(0).max(5),
  priority: PriorityBucketEnum,
  
  // Human-readable explanation
  reason: SeverityReasonSchema,
  
  // Score components (for debugging/tuning)
  scoreComponents: z.object({
    magnitudeScore: z.number(),
    confidenceMultiplier: z.number(),
    noveltyMultiplier: z.number(),
    persistenceBonus: z.number(),
  }).optional(),
});

// Type exports
export type PriorityBucket = z.infer<typeof PriorityBucketEnum>;
export type SeverityReason = z.infer<typeof SeverityReasonSchema>;
export type ScoredEvent = z.infer<typeof ScoredEventSchema>;
