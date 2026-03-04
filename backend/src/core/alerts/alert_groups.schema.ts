/**
 * Alert Groups Schema (A1 - Deduplication & Noise Control)
 * 
 * Purpose: Group similar alerts to reduce noise
 * Groups by: signal type + target + time window
 */
import { z } from 'zod';

export const AlertGroupStatusEnum = z.enum(['active', 'resolved']);

export const AlertGroupSchema = z.object({
  groupId: z.string(), // hash(ruleId + signalType + targetId + timeWindow)
  ruleId: z.string(), // Reference to AlertRule
  signalType: z.string(),
  targetId: z.string(),
  scope: z.enum(['strategy', 'actor', 'entity', 'token', 'wallet']),
  
  // Timing
  firstTriggeredAt: z.date(),
  lastTriggeredAt: z.date(),
  windowMinutes: z.number().default(60),
  
  // Grouping stats
  eventCount: z.number().default(1),
  status: AlertGroupStatusEnum.default('active'),
  
  // Context
  targetMeta: z.object({
    symbol: z.string().optional(),
    name: z.string().optional(),
    chain: z.string().optional(),
  }).optional(),
  
  // Explainability (A2)
  why: z.string().optional(),
  evidence: z.array(z.object({
    metric: z.string(),
    value: z.number(),
    delta: z.number().optional(),
    baseline: z.number().optional(),
  })).optional(),
  
  // Metadata
  userId: z.string(),
  resolvedAt: z.date().optional(),
  resolvedBy: z.enum(['auto', 'user']).optional(),
});

export const AlertGroupEventSchema = z.object({
  eventId: z.string(),
  groupId: z.string(), // Links to AlertGroup
  ruleId: z.string(),
  alertEventId: z.string(), // Original alert event ID
  
  triggeredAt: z.date(),
  signalType: z.string(),
  targetId: z.string(),
  
  // Event-specific data
  metadata: z.object({
    threshold: z.number().optional(),
    actualValue: z.number().optional(),
    deviation: z.number().optional(),
    confidence: z.number().optional(),
  }).optional(),
  
  userId: z.string(),
});

export const CreateAlertGroupBody = z.object({
  ruleId: z.string(),
  signalType: z.string(),
  targetId: z.string(),
  scope: z.enum(['strategy', 'actor', 'entity', 'token', 'wallet']),
  targetMeta: z.object({
    symbol: z.string().optional(),
    name: z.string().optional(),
    chain: z.string().optional(),
  }).optional(),
  windowMinutes: z.number().default(60),
});

export const GetAlertGroupsQuery = z.object({
  status: AlertGroupStatusEnum.optional(),
  signalType: z.string().optional(),
  limit: z.preprocess(
    (val) => (val ? parseInt(val as string, 10) : 50),
    z.number()
  ).default(50),
  offset: z.preprocess(
    (val) => (val ? parseInt(val as string, 10) : 0),
    z.number()
  ).default(0),
});

export const ResolveAlertGroupBody = z.object({
  resolvedBy: z.enum(['auto', 'user']).default('user'),
});

// Type exports
export type AlertGroup = z.infer<typeof AlertGroupSchema>;
export type AlertGroupEvent = z.infer<typeof AlertGroupEventSchema>;
export type CreateAlertGroupBody = z.infer<typeof CreateAlertGroupBody>;
export type GetAlertGroupsQuery = z.infer<typeof GetAlertGroupsQuery>;
export type ResolveAlertGroupBody = z.infer<typeof ResolveAlertGroupBody>;
