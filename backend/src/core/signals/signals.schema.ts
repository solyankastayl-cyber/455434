/**
 * Signals Zod Schemas
 * Validation for signal queries
 */
import { z } from 'zod';

// Entity type enum
export const SignalEntityTypeEnum = z.enum(['address', 'corridor', 'asset']);
export type SignalEntityTypeSchema = z.infer<typeof SignalEntityTypeEnum>;

// Signal type enum
export const SignalTypeEnum = z.enum([
  'accumulation_start', 'accumulation_end',
  'distribution_start', 'distribution_end',
  'wash_detected', 'wash_cleared',
  'rotation_shift',
  'intensity_spike', 'intensity_drop',
  'bundle_change',
  'new_corridor', 'corridor_dormant'
]);
export type SignalTypeSchema = z.infer<typeof SignalTypeEnum>;

// Severity enum
export const SignalSeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type SignalSeveritySchema = z.infer<typeof SignalSeverityEnum>;

/**
 * Query latest signals
 */
export const QueryLatestSignalsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  signalType: SignalTypeEnum.optional(),
  severity: SignalSeverityEnum.optional(),
  minSeverityScore: z.coerce.number().min(0).max(100).optional(),
  window: z.string().optional(),
  acknowledged: z.coerce.boolean().optional(),
  since: z.coerce.date().optional(),
});
export type QueryLatestSignalsInput = z.infer<typeof QueryLatestSignalsSchema>;

/**
 * Query signals for address
 */
export const QueryByAddressSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  signalType: SignalTypeEnum.optional(),
  severity: SignalSeverityEnum.optional(),
  since: z.coerce.date().optional(),
});
export type QueryByAddressInput = z.infer<typeof QueryByAddressSchema>;

/**
 * Query signals for corridor
 */
export const QueryByCorridorSchema = z.object({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid from address'),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid to address'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  signalType: SignalTypeEnum.optional(),
  since: z.coerce.date().optional(),
});
export type QueryByCorridorInput = z.infer<typeof QueryByCorridorSchema>;

/**
 * Signal response
 */
export const SignalResponseSchema = z.object({
  id: z.string(),
  entityType: SignalEntityTypeEnum,
  entityId: z.string(),
  signalType: SignalTypeEnum,
  prevBundleType: z.string().nullable(),
  newBundleType: z.string().nullable(),
  prevIntensity: z.number().nullable(),
  newIntensity: z.number().nullable(),
  confidence: z.number(),
  severityScore: z.number(),
  severity: SignalSeverityEnum,
  window: z.string(),
  chain: z.string(),
  triggeredAt: z.date(),
  explanation: z.string(),
  relatedAddresses: z.array(z.string()),
  acknowledged: z.boolean(),
});
export type SignalResponse = z.infer<typeof SignalResponseSchema>;
