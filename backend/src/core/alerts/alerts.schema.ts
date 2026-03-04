/**
 * Alerts Zod Schemas (P0 Architecture)
 */
import { z } from 'zod';

export const AlertScopeEnum = z.enum(['strategy', 'actor', 'entity', 'token', 'wallet']);
export const ThrottleEnum = z.enum(['1h', '6h', '24h']);

export const TriggerTypesEnum = z.enum([
  // Strategy triggers
  'strategy_detected',
  'strategy_confirmed',
  'strategy_shift',
  'strategy_phase_change',
  'strategy_intensity_spike',
  'strategy_risk_spike',
  'strategy_influence_jump',
  // Token triggers (P0)
  'accumulation',
  'distribution',
  'large_move',
  'smart_money_entry',
  'smart_money_exit',
  'net_flow_spike',
  'activity_spike',
]);

export const TriggerConfigSchema = z.object({
  type: TriggerTypesEnum,
  threshold: z.number().optional(),
  direction: z.enum(['in', 'out']).optional(),
  window: z.enum(['1h', '6h', '24h']).optional(),
}).optional();

export const ChannelsSchema = z.object({
  inApp: z.boolean().default(true),
  telegram: z.boolean().default(true),
}).optional();

export const TargetMetaSchema = z.object({
  symbol: z.string().optional(),
  name: z.string().optional(),
  chain: z.string().optional(),
}).optional();

// A5.4: Sensitivity level enum
export const SensitivityEnum = z.enum(['low', 'medium', 'high']);

export const CreateAlertRuleBody = z.object({
  scope: AlertScopeEnum,
  targetId: z.string().min(1),
  triggerTypes: z.array(TriggerTypesEnum).min(1),
  trigger: TriggerConfigSchema,
  channels: ChannelsSchema,
  minSeverity: z.number().min(0).max(100).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  minStability: z.number().min(0).max(1).optional(),
  throttle: ThrottleEnum.optional(),
  sensitivity: SensitivityEnum.optional(),  // A5.4: Sensitivity level
  name: z.string().optional(),
  targetMeta: TargetMetaSchema,
});

export const UpdateAlertRuleBody = z.object({
  triggerTypes: z.array(TriggerTypesEnum).min(1).optional(),
  trigger: TriggerConfigSchema,
  channels: ChannelsSchema,
  minSeverity: z.number().min(0).max(100).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  minStability: z.number().min(0).max(1).optional(),
  throttle: ThrottleEnum.optional(),
  sensitivity: SensitivityEnum.optional(),  // A5.4: Sensitivity level
  status: z.enum(['active', 'paused']).optional(),
  active: z.boolean().optional(),
  name: z.string().optional(),
});

export const GetAlertRulesQuery = z.object({
  activeOnly: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean()
  ).default(false),
});

export const GetAlertFeedQuery = z.object({
  unacknowledged: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const RuleIdParams = z.object({
  id: z.string().min(1),
});

export const AlertIdParams = z.object({
  id: z.string().min(1),
});
