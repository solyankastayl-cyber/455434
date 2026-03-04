/**
 * Wallet Token Correlation Schema (B2)
 * 
 * Purpose: "Этот токен движется из-за кого?"
 * 
 * B2 connects:
 * - Alerts (A) — explains cause
 * - Tokens — who drives activity  
 * - Wallets — their influence
 * 
 * ARCHITECTURAL RULE:
 * - A4 Dispatcher does NOT form drivers
 * - Drivers come ONLY from B2
 * - UI never guesses, backend always explains
 * 
 * WITHOUT this:
 * - Alerts look like "magic"
 * - Token Page is just a showcase
 * - Wallet Profile lives separately
 */
import { z } from 'zod';

/**
 * Wallet role in token activity
 * NOTE: Role is NOT absolute, but contextual to the event
 */
export const WalletRoleEnum = z.enum([
  'buyer',     // Primarily buying/accumulating
  'seller',    // Primarily selling/distributing  
  'mixed',     // Both buying and selling
]);

/**
 * Role context - explains WHEN/WHERE the role applies
 * Prevents false interpretations like "Wallet is buyer" (absolute)
 * Enables: "This wallet acted as a buyer during this accumulation" (contextual)
 */
export const RoleContextEnum = z.enum([
  'accumulation',   // During accumulation phase
  'distribution',   // During distribution phase
  'net_flow',       // Based on net token flow
  'alert_group',    // Within specific alert group
  'signal_window',  // During signal detection window
]);

/**
 * Timing relation to signal
 */
export const TimeRelationEnum = z.enum([
  'before_signal',   // Activity started before signal
  'during_signal',   // Activity during signal period
  'after_signal',    // Activity after signal
]);

/**
 * Score components - transparent influence breakdown
 * UI can explain WHY this wallet is important
 * B4 (Smart Money) can reuse this data
 * Eliminates "black box" scoring
 */
export const ScoreComponentsSchema = z.object({
  volumeShare: z.number().min(0).max(1),        // Weight: 0.4 - Share of total volume
  activityFrequency: z.number().min(0).max(1),  // Weight: 0.3 - Normalized tx frequency
  timingWeight: z.number().min(0).max(1),       // Weight: 0.3 - Timing relative to signal
});

/**
 * Main Wallet Token Correlation Schema
 */
export const WalletTokenCorrelationSchema = z.object({
  // Identity
  correlationId: z.string(),
  walletAddress: z.string(),
  tokenAddress: z.string(),
  chain: z.string().default('Ethereum'),
  
  // Role classification (contextual, not absolute)
  role: WalletRoleEnum,
  roleContext: RoleContextEnum,  // NEW: Context for role interpretation
  
  // Influence score (0-1)
  // Higher = more influential on token activity
  influenceScore: z.number().min(0).max(1),
  
  // NEW: Transparent score breakdown
  // Rule: UI never guesses, backend always explains
  scoreComponents: ScoreComponentsSchema,
  
  // Flow metrics
  netFlow: z.number(),         // Positive = accumulation, Negative = distribution
  totalVolume: z.number(),     // Absolute volume in USD
  txCount: z.number(),         // Number of transactions
  
  // Volume share (percentage of total token flow)
  volumeShare: z.number().min(0).max(1),
  
  // Activity frequency
  activityFrequency: z.number(), // Transactions per day
  
  // Timing analysis
  timeRelation: TimeRelationEnum,
  timingWeight: z.number().min(0).max(1), // Higher = earlier/better timing
  
  // Time window
  periodStart: z.date(),
  periodEnd: z.date(),
  
  // Confidence (based on data quality)
  confidence: z.number().min(0).max(1),
  
  // Wallet metadata (from B1 profile)
  walletMeta: z.object({
    tags: z.array(z.string()).optional(),
    headline: z.string().optional(),
  }).optional(),
  
  // Token metadata
  tokenMeta: z.object({
    symbol: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  
  // Timestamps
  calculatedAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Token Activity Drivers - aggregated view for UI
 * 
 * PRODUCT RULES:
 * - Max 3 wallets in the block (not dashboard)
 * - Sort by influenceScore, NOT by txCount
 * - Human-summary always on top
 */
export const TokenActivityDriversSchema = z.object({
  tokenAddress: z.string(),
  chain: z.string(),
  
  // Summary
  totalParticipants: z.number(),
  dominantRole: WalletRoleEnum,
  roleContext: RoleContextEnum,  // NEW: Context for all drivers
  
  // Top drivers (sorted by influenceScore, max 3 for UI)
  topDrivers: z.array(z.object({
    walletAddress: z.string(),
    role: WalletRoleEnum,
    roleContext: RoleContextEnum,     // NEW
    influenceScore: z.number(),
    scoreComponents: ScoreComponentsSchema,  // NEW: Transparent breakdown
    volumeShare: z.number(),
    netFlow: z.number(),
    txCount: z.number(),
    confidence: z.number(),
    walletMeta: z.object({
      tags: z.array(z.string()).optional(),
      headline: z.string().optional(),
    }).optional(),
  })),
  
  // Human-readable summary (ALWAYS on top in UI)
  // Example: "Recent accumulation is primarily driven by 2 wallets with historically high activity."
  summary: z.object({
    headline: z.string(),      // "2 high-activity wallets driving accumulation"
    description: z.string(),   // Detailed explanation
  }),
  
  // Period
  periodStart: z.date(),
  periodEnd: z.date(),
  calculatedAt: z.date(),
});

/**
 * Alert Group Drivers - for linking B2 to alerts (A)
 * 
 * ARCHITECTURAL RULE:
 * A4 Dispatcher does NOT form drivers.
 * Drivers come ONLY from B2.
 * 
 * Empty state:
 * - label: "Behavior detected"
 * - tooltip: "No dominant wallets identified for this activity"
 * - Empty driver ≠ error (sometimes market moves as "crowd")
 */
export const AlertGroupDriversSchema = z.object({
  groupId: z.string(),
  
  // Wallet drivers
  drivers: z.array(z.object({
    walletAddress: z.string(),
    influenceScore: z.number(),
    scoreComponents: ScoreComponentsSchema,  // NEW
    role: WalletRoleEnum,
    roleContext: RoleContextEnum,  // NEW
    confidence: z.number(),
  })),
  
  // Summary for alert card
  driverSummary: z.string(),   // "Driven by Wallet A and 1 more" or "Behavior detected"
  
  // NEW: Empty state flag
  hasDrivers: z.boolean(),     // false = crowd behavior, no dominant wallets
  
  calculatedAt: z.date(),
});

// Type exports
export type WalletRole = z.infer<typeof WalletRoleEnum>;
export type RoleContext = z.infer<typeof RoleContextEnum>;
export type TimeRelation = z.infer<typeof TimeRelationEnum>;
export type ScoreComponents = z.infer<typeof ScoreComponentsSchema>;
export type WalletTokenCorrelation = z.infer<typeof WalletTokenCorrelationSchema>;
export type TokenActivityDrivers = z.infer<typeof TokenActivityDriversSchema>;
export type AlertGroupDrivers = z.infer<typeof AlertGroupDriversSchema>;
