/**
 * Follows Zod Schemas
 */
import { z } from 'zod';

export const FollowTypeEnum = z.enum(['actor', 'entity', 'strategy', 'token']);
export const DeliveryMethodEnum = z.enum(['inApp', 'email', 'telegram', 'webhook']);
export const WindowEnum = z.enum(['7d', '30d', '90d']);

export const FollowSettingsSchema = z.object({
  minSeverity: z.number().min(0).max(100).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  allowedTypes: z.array(z.string()).optional(),
  window: WindowEnum.optional(),
  delivery: z.array(DeliveryMethodEnum).optional(),
  muted: z.boolean().optional(),
});

export const CreateFollowBody = z.object({
  followType: FollowTypeEnum,
  targetId: z.string().min(1),
  settings: FollowSettingsSchema.optional(),
  label: z.string().optional(),
  notes: z.string().optional(),
});

export const UpdateFollowBody = z.object({
  settings: FollowSettingsSchema.optional(),
  label: z.string().optional(),
  notes: z.string().optional(),
});

export const GetFollowsQuery = z.object({
  followType: FollowTypeEnum.optional(),
});

export const GetEventsQuery = z.object({
  unread: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const FollowIdParams = z.object({
  id: z.string().min(1),
});

export const EventIdParams = z.object({
  id: z.string().min(1),
});
