import { z } from 'zod';
import { SUPPORTED_NETWORKS, NetworkType } from './network.types.js';

/**
 * Common Types
 */

// Pagination
export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Sorting
export const SortOrderSchema = z.enum(['asc', 'desc']).default('desc');
export type SortOrder = z.infer<typeof SortOrderSchema>;

// MongoDB ObjectId as string
export const ObjectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

// Blockchain address (Ethereum-like)
export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid address');

// ============================================
// NETWORK (P0 - ОБЯЗАТЕЛЬНЫЙ ПАРАМЕТР)
// ============================================

/**
 * Network Schema - ОБЯЗАТЕЛЬНЫЙ параметр во всех API
 * 
 * ПРАВИЛО: Никаких default, никаких optional
 */
export const NetworkSchema = z.enum(SUPPORTED_NETWORKS as unknown as [string, ...string[]]);

/**
 * Network Schema с возможностью 'all' для агрегации
 */
export const NetworkWithAllSchema = z.union([
  NetworkSchema,
  z.literal('all'),
]);

// Deprecated: используем NetworkSchema из network.types.ts
export const ChainSchema = NetworkSchema;
export type Chain = NetworkType;

// Common timestamp fields
export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

// API Response wrapper
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Window schema для временных окон
export const WindowSchema = z.enum(['1h', '24h', '7d', '30d', '90d']).default('7d');
export type Window = z.infer<typeof WindowSchema>;
