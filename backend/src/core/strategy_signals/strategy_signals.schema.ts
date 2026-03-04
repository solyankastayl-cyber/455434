/**
 * Strategy Signals Zod Schemas
 */
import { z } from 'zod';

export const StrategySignalTypeEnum = z.enum([
  'strategy_detected',
  'strategy_shift',
  'strategy_phase_change',
  'strategy_intensity_spike',
  'strategy_risk_spike',
  'strategy_influence_jump',
  'strategy_confirmed',
]);

export const WindowEnum = z.enum(['7d', '30d', '90d']);

export const GetLatestStrategySignalsQuery = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
  type: StrategySignalTypeEnum.optional(),
  window: WindowEnum.optional(),
  strategyType: z.string().optional(),
  minSeverity: z.coerce.number().min(0).max(100).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
});

export const GetStrategySignalsByAddressParams = z.object({
  address: z.string().min(1),
});

export const GetStrategySignalsByAddressQuery = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
});
