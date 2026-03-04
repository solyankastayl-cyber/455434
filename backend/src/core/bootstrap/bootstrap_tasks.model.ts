/**
 * Bootstrap Tasks Model (P2.1 Step 1)
 * 
 * Contract between Resolver and Indexing system.
 * Resolver guarantees task creation, Worker guarantees completion.
 */
import mongoose, { Schema, Document } from 'mongoose';

// Subject types that can be bootstrapped
export type BootstrapSubjectType = 
  | 'wallet'
  | 'actor'
  | 'entity'
  | 'token';

// Task statuses - strict semantics
export type BootstrapStatus =
  | 'queued'    // Created, waiting for worker
  | 'running'   // Worker picked up task
  | 'done'      // Indexing completed
  | 'failed';   // Exceeded retry limit

// B1: Failure classification (standardized reasons)
export type BootstrapFailureReason =
  | 'rpc_timeout'           // RPC call timed out
  | 'rate_limited'          // 429 or rate limit hit
  | 'invalid_input'         // Invalid address/ENS/format
  | 'unsupported_chain'     // Chain not supported
  | 'dependency_unavailable'// DB/RPC/service down
  | 'data_not_found'        // No data after all steps
  | 'internal_error';       // Unknown/code error

// Supported chains
export type BootstrapChain = 
  | 'ethereum' 
  | 'arbitrum' 
  | 'base' 
  | 'bsc' 
  | 'solana'
  | 'polygon'
  | 'optimism'
  | 'avalanche';

export interface IBootstrapTask extends Document {
  // WHAT
  subjectType: BootstrapSubjectType;
  chain: BootstrapChain;
  subjectId?: string;          // actorId / entityId (if known)
  address?: string;            // wallet / token address
  tokenAddress?: string;       // for token bootstrap

  // STATE
  status: BootstrapStatus;
  progress: number;            // 0..100
  step?: string;               // 'erc20_index', 'relations', 'signals'

  // CONTROL
  priority: number;            // 1 (high) → 5 (low)
  attempts: number;
  maxAttempts: number;

  // IDEMPOTENCY
  dedupKey: string;

  // ERROR (B1: Enhanced failure tracking)
  lastError?: string;
  failureReason?: BootstrapFailureReason;  // B1: Classified reason
  failureDetails?: string;                  // B1: Short description
  lastErrorAt?: Date;                       // B1: When error occurred

  // TIMING
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  nextRetryAt?: Date;
}

const BootstrapTaskSchema = new Schema<IBootstrapTask>(
  {
    // WHAT
    subjectType: {
      type: String,
      required: true,
      enum: ['wallet', 'actor', 'entity', 'token'],
    },
    chain: {
      type: String,
      required: true,
      enum: ['ethereum', 'arbitrum', 'base', 'bsc', 'solana', 'polygon', 'optimism', 'avalanche'],
      default: 'ethereum',
    },
    subjectId: { type: String },
    address: { type: String },
    tokenAddress: { type: String },

    // STATE
    status: {
      type: String,
      required: true,
      enum: ['queued', 'running', 'done', 'failed'],
      default: 'queued',
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    step: { type: String },

    // CONTROL
    priority: {
      type: Number,
      default: 3,
      min: 1,
      max: 5,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },

    // IDEMPOTENCY
    dedupKey: {
      type: String,
      required: true,
      unique: true,
    },

    // ERROR (B1: Enhanced failure tracking)
    lastError: { type: String },
    failureReason: {
      type: String,
      enum: ['rpc_timeout', 'rate_limited', 'invalid_input', 'unsupported_chain', 
             'dependency_unavailable', 'data_not_found', 'internal_error'],
    },
    failureDetails: { type: String },
    lastErrorAt: { type: Date },

    // TIMING
    startedAt: { type: Date },
    finishedAt: { type: Date },
    nextRetryAt: { type: Date },
  },
  {
    timestamps: true, // createdAt, updatedAt
    collection: 'bootstrap_tasks',
  }
);

// INDEXES (CRITICAL)
// 1. Unique dedup key for idempotency
BootstrapTaskSchema.index({ dedupKey: 1 }, { unique: true });

// 2. Worker polling: find queued tasks by priority and age
BootstrapTaskSchema.index({ status: 1, priority: 1, createdAt: 1 });

// 3. Retry scheduler: find tasks ready for retry
BootstrapTaskSchema.index({ nextRetryAt: 1 });

// 4. Subject lookup (for UI status checks)
BootstrapTaskSchema.index({ subjectType: 1, address: 1 });
BootstrapTaskSchema.index({ subjectType: 1, subjectId: 1 });

// 5. B1: Failure analysis - find failed tasks by reason
BootstrapTaskSchema.index({ status: 1, failureReason: 1 });

export const BootstrapTaskModel = mongoose.model<IBootstrapTask>('BootstrapTask', BootstrapTaskSchema);

/**
 * Generate dedup key for idempotency
 * Format: {subjectType}:{chain}:{identifier}
 */
export function generateDedupKey(
  subjectType: BootstrapSubjectType,
  chain: string,
  address?: string,
  subjectId?: string,
  tokenAddress?: string
): string {
  const identifier = address || subjectId || tokenAddress || 'unknown';
  return `${subjectType}:${chain}:${identifier.toLowerCase()}`;
}

/**
 * Calculate backoff delay for retry
 * Formula: min(2^attempts * 60s, 1 hour)
 */
export function calculateBackoffDelay(attempts: number): number {
  const baseDelay = 60 * 1000; // 60 seconds
  const maxDelay = 60 * 60 * 1000; // 1 hour
  const delay = Math.pow(2, attempts) * baseDelay;
  return Math.min(delay, maxDelay);
}

/**
 * B1: Classify error into standardized reason
 */
export function classifyFailureReason(error: Error | string): BootstrapFailureReason {
  const message = typeof error === 'string' ? error : error.message;
  const lowerMsg = message.toLowerCase();
  
  // Rate limiting
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests')) {
    return 'rate_limited';
  }
  
  // Timeouts
  if (lowerMsg.includes('timeout') || lowerMsg.includes('etimedout') || lowerMsg.includes('econnreset')) {
    return 'rpc_timeout';
  }
  
  // Invalid input
  if (lowerMsg.includes('invalid address') || lowerMsg.includes('invalid ens') || 
      lowerMsg.includes('bad address') || lowerMsg.includes('checksum')) {
    return 'invalid_input';
  }
  
  // Unsupported chain
  if (lowerMsg.includes('unsupported chain') || lowerMsg.includes('chain not supported')) {
    return 'unsupported_chain';
  }
  
  // Dependency issues
  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('mongodb') || 
      lowerMsg.includes('database') || lowerMsg.includes('connection')) {
    return 'dependency_unavailable';
  }
  
  // Data not found
  if (lowerMsg.includes('not found') || lowerMsg.includes('no data') || 
      lowerMsg.includes('empty result') || lowerMsg.includes('no transactions')) {
    return 'data_not_found';
  }
  
  // Default
  return 'internal_error';
}
