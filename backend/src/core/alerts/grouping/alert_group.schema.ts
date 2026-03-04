/**
 * Alert Group Schema (A3)
 * 
 * Purpose: Define AlertGroup lifecycle structure
 * Question: "Это новое событие или продолжение уже идущего поведения?"
 * 
 * A3 groups by MEANING of behavior, not by time:
 * "Smart money continues accumulating USDT"
 * NOT
 * "Alert #1", "Alert #2", "Alert #3"
 * 
 * NOT responsible for:
 * - Severity calculation (A2)
 * - Deduplication (A1)
 * - Dispatch decisions (A4)
 */
import { z } from 'zod';

/**
 * Group Scope - what entity the group is tracking
 */
export const GroupScopeEnum = z.enum(['token', 'wallet', 'actor']);

/**
 * Group Status - lifecycle states
 * 
 * active   → Behavior is ongoing
 * cooling  → Behavior slowing down (IMPORTANT: not resolved yet!)
 * resolved → Behavior returned to baseline
 */
export const GroupStatusEnum = z.enum(['active', 'cooling', 'resolved']);

/**
 * Group Priority - inherited/escalated from events
 */
export const GroupPriorityEnum = z.enum(['low', 'medium', 'high']);

/**
 * Signal Type - matches normalized event types
 */
export const SignalTypeEnum = z.enum([
  'accumulation',
  'distribution',
  'large_move',
  'smart_money_entry',
  'smart_money_exit',
  'net_flow_spike',
  'activity_spike',
]);

/**
 * Group Reason - evolves over lifecycle
 * 
 * Start:   "Large wallets started accumulating"
 * Ongoing: "Large wallets continue accumulating (4 events, 6h)"
 * Cooling: "Accumulation activity slowing down"
 * Resolved: "Accumulation ended after 8 hours"
 */
export const GroupReasonSchema = z.object({
  summary: z.string(),   // Human-readable headline
  context: z.string(),   // Duration/event count context
});

/**
 * Main AlertGroup Schema
 */
export const AlertGroupSchema = z.object({
  groupId: z.string(),
  
  // Grouping key components (CRITICAL)
  // groupKey = scope + targetId + signalType
  scope: GroupScopeEnum,
  targetId: z.string(),
  signalType: SignalTypeEnum,
  
  // Target metadata for display
  targetMeta: z.object({
    symbol: z.string().optional(),
    name: z.string().optional(),
    chain: z.string().optional(),
  }).optional(),
  
  // Lifecycle
  status: GroupStatusEnum,
  priority: GroupPriorityEnum,
  
  // Timestamps
  startedAt: z.date(),
  lastUpdatedAt: z.date(),
  coolingStartedAt: z.date().optional(),
  resolvedAt: z.date().optional(),
  
  // Event tracking
  eventIds: z.array(z.string()),
  eventCount: z.number(),
  
  // Severity tracking
  peakSeverity: z.number(),
  lastSeverity: z.number(),
  
  // Human-readable reason (evolves with lifecycle)
  reason: GroupReasonSchema,
  
  // User association
  userId: z.string(),
  ruleId: z.string().optional(),
});

/**
 * Output of grouping operation
 */
export const GroupedEventSchema = z.object({
  group: AlertGroupSchema,
  
  // Lifecycle change flags
  isNewGroup: z.boolean(),      // First event in this group
  isEscalation: z.boolean(),    // Priority increased
  isResolution: z.boolean(),    // Group just resolved
  isCoolingStart: z.boolean(),  // Just entered cooling
  
  // Previous state (for comparison)
  previousStatus: GroupStatusEnum.optional(),
  previousPriority: GroupPriorityEnum.optional(),
});

// Type exports
export type GroupScope = z.infer<typeof GroupScopeEnum>;
export type GroupStatus = z.infer<typeof GroupStatusEnum>;
export type GroupPriority = z.infer<typeof GroupPriorityEnum>;
export type SignalType = z.infer<typeof SignalTypeEnum>;
export type GroupReason = z.infer<typeof GroupReasonSchema>;
export type AlertGroup = z.infer<typeof AlertGroupSchema>;
export type GroupedEvent = z.infer<typeof GroupedEventSchema>;
