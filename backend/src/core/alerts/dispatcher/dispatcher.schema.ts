/**
 * Dispatcher Schema (A4)
 * 
 * Purpose: "Когда, кому и как сообщать о группе событий?"
 * 
 * A4 is attention management, not business logic.
 * 
 * NOT responsible for:
 * - Grouping (A3)
 * - Severity calculation (A2)
 * - Deduplication (A1)
 * - Normalization (A0)
 */
import { z } from 'zod';

/**
 * Dispatch Types - what kind of notification
 */
export const DispatchTypeEnum = z.enum([
  'new',        // New behavior started
  'escalation', // Priority/severity increased
  'cooling',    // Activity slowing down (optional)
  'resolved',   // Behavior ended
]);

/**
 * Channel Types
 */
export const ChannelTypeEnum = z.enum([
  'ui',       // In-app notifications
  'telegram', // Telegram bot
  // ❌ email — NOT USED (documented)
]);

/**
 * Dispatch Priority
 */
export const DispatchPriorityEnum = z.enum(['low', 'medium', 'high']);

/**
 * User Alert Preferences (CRITICAL)
 * 
 * Without this, A4 becomes a spam machine
 */
export const UserAlertPreferencesSchema = z.object({
  userId: z.string(),
  
  // Minimum priority to notify
  minPriority: DispatchPriorityEnum.default('medium'),
  
  // Active channels
  channels: z.array(ChannelTypeEnum).default(['ui']),
  
  // What events to notify on
  notifyOn: z.object({
    new: z.boolean().default(true),
    escalation: z.boolean().default(true),
    cooling: z.boolean().default(false),
    resolution: z.boolean().default(false),
  }).default({}),
  
  // Telegram settings
  telegram: z.object({
    chatId: z.string().optional(),
    enabled: z.boolean().default(false),
  }).default({}),
  
  // Rate limiting overrides
  rateLimits: z.object({
    maxPerHour: z.number().default(10),
    minIntervalMinutes: z.number().default(15),
  }).default({}),
});

/**
 * Dispatch Payload (UNIFIED)
 * 
 * Same structure for all channels
 */
export const DispatchPayloadSchema = z.object({
  // Identifiers
  payloadId: z.string(),
  groupId: z.string(),
  userId: z.string(),
  
  // Dispatch type
  type: DispatchTypeEnum,
  priority: DispatchPriorityEnum,
  
  // Human-readable content
  title: z.string(),     // Short headline
  message: z.string(),   // Main content
  
  // From AlertGroup.reason
  reason: z.object({
    summary: z.string(),
    context: z.string(),
  }),
  
  // Action
  actionLink: z.string().optional(),
  
  // Metadata
  targetMeta: z.object({
    symbol: z.string().optional(),
    name: z.string().optional(),
    chain: z.string().optional(),
  }).optional(),
  
  // Timestamps
  createdAt: z.date(),
  
  // Delivery status per channel
  deliveryStatus: z.record(ChannelTypeEnum, z.object({
    sent: z.boolean(),
    sentAt: z.date().optional(),
    error: z.string().optional(),
  })).optional(),
});

/**
 * Dispatch Decision
 * 
 * Result of dispatcher decision-making
 */
export const DispatchDecisionSchema = z.object({
  shouldDispatch: z.boolean(),
  
  // If should dispatch
  type: DispatchTypeEnum.optional(),
  channels: z.array(ChannelTypeEnum).optional(),
  
  // If should NOT dispatch
  reason: z.string().optional(), // "rate_limited", "below_min_priority", "silent_update", etc.
});

/**
 * Rate Limit Entry
 */
export const RateLimitEntrySchema = z.object({
  userId: z.string(),
  groupId: z.string().optional(), // Per-group limit
  
  // Counters
  notificationsThisHour: z.number(),
  hourStartedAt: z.date(),
  
  lastNotificationAt: z.date().optional(),
});

/**
 * Notification History Entry
 */
export const NotificationHistorySchema = z.object({
  notificationId: z.string(),
  userId: z.string(),
  groupId: z.string(),
  
  type: DispatchTypeEnum,
  priority: DispatchPriorityEnum,
  
  channels: z.array(ChannelTypeEnum),
  payload: DispatchPayloadSchema,
  
  createdAt: z.date(),
  
  // Delivery tracking
  deliveredAt: z.record(ChannelTypeEnum, z.date()).optional(),
  errors: z.record(ChannelTypeEnum, z.string()).optional(),
});

// Type exports
export type DispatchType = z.infer<typeof DispatchTypeEnum>;
export type ChannelType = z.infer<typeof ChannelTypeEnum>;
export type DispatchPriority = z.infer<typeof DispatchPriorityEnum>;
export type UserAlertPreferences = z.infer<typeof UserAlertPreferencesSchema>;
export type DispatchPayload = z.infer<typeof DispatchPayloadSchema>;
export type DispatchDecision = z.infer<typeof DispatchDecisionSchema>;
export type RateLimitEntry = z.infer<typeof RateLimitEntrySchema>;
export type NotificationHistory = z.infer<typeof NotificationHistorySchema>;
