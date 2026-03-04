/**
 * Transfers Zod Schemas
 * Validation for transfer queries
 */
import { z } from 'zod';

// Asset types
export const AssetTypeEnum = z.enum(['erc20', 'eth', 'internal', 'swap']);
export type AssetTypeSchema = z.infer<typeof AssetTypeEnum>;

// Transfer sources
export const TransferSourceEnum = z.enum(['erc20_log', 'eth_tx', 'internal_tx', 'dex_swap']);
export type TransferSourceSchema = z.infer<typeof TransferSourceEnum>;

// Chains
export const ChainEnum = z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon']);
export type ChainSchema = z.infer<typeof ChainEnum>;

/**
 * Query transfers by address
 */
export const QueryByAddressSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address'),
  direction: z.enum(['in', 'out', 'both']).optional().default('both'),
  assetAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  assetType: AssetTypeEnum.optional(),
  chain: ChainEnum.optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  minAmount: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z.enum(['timestamp', 'amountNormalized', 'blockNumber']).optional().default('timestamp'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});
export type QueryByAddressInput = z.infer<typeof QueryByAddressSchema>;

/**
 * Query transfers by asset
 */
export const QueryByAssetSchema = z.object({
  asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid asset address'),
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type QueryByAssetInput = z.infer<typeof QueryByAssetSchema>;

/**
 * Query transfers between two addresses
 */
export const QueryCorridorSchema = z.object({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid from address'),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid to address'),
  assetAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});
export type QueryCorridorInput = z.infer<typeof QueryCorridorSchema>;

/**
 * Get netflow for address
 */
export const NetflowQuerySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address'),
  assetAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});
export type NetflowQueryInput = z.infer<typeof NetflowQuerySchema>;

/**
 * Transfer response schema
 */
export const TransferResponseSchema = z.object({
  id: z.string(),
  txHash: z.string(),
  logIndex: z.number().nullable(),
  blockNumber: z.number(),
  timestamp: z.date(),
  from: z.string(),
  to: z.string(),
  assetType: AssetTypeEnum,
  assetAddress: z.string(),
  amountRaw: z.string(),
  amountNormalized: z.number().nullable(),
  chain: ChainEnum,
  source: TransferSourceEnum,
});
export type TransferResponse = z.infer<typeof TransferResponseSchema>;
