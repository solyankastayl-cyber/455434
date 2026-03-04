/**
 * Bootstrap Service (P2.1 Step 1)
 * 
 * High-level interface for bootstrap task management.
 * Called by Resolver to queue indexing tasks.
 */
import * as repository from './bootstrap.repository.js';
import { 
  BootstrapSubjectType, 
  BootstrapChain,
  BootstrapStatus,
} from './bootstrap_tasks.model.js';

export interface EnqueueInput {
  subjectType: BootstrapSubjectType;
  chain: BootstrapChain | string;
  address?: string;
  subjectId?: string;
  tokenAddress?: string;
  priority?: number;
}

export interface EnqueueResult {
  queued: boolean;
  taskId?: string;
  existing?: boolean;
  status?: BootstrapStatus;
}

/**
 * Enqueue a bootstrap task (idempotent)
 * 
 * Called by Resolver when:
 * - confidence < 0.4
 * - no existing data
 * 
 * Behavior:
 * - Computes dedupKey
 * - If active task exists → returns { queued: false }
 * - Otherwise → creates task
 */
export async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
  // Normalize chain to valid value
  const chain = normalizeChain(input.chain);
  
  return repository.enqueue({
    subjectType: input.subjectType,
    chain,
    address: input.address,
    subjectId: input.subjectId,
    tokenAddress: input.tokenAddress,
    priority: input.priority || 3,
  });
}

/**
 * Get task status for a subject
 * Used by Resolver to check if indexing is in progress
 */
export async function getStatus(
  subjectType: BootstrapSubjectType,
  chain: string,
  identifier: string
): Promise<{
  exists: boolean;
  status?: BootstrapStatus;
  progress?: number;
  eta?: number;
}> {
  return repository.getTaskStatus(subjectType, chain, identifier);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  queued: number;
  running: number;
  done: number;
  failed: number;
  total: number;
}> {
  return repository.getQueueStats();
}

/**
 * Estimate ETA for a subject type
 */
export function estimateETA(subjectType: BootstrapSubjectType): number {
  const estimates: Record<BootstrapSubjectType, number> = {
    wallet: 30,   // 30 seconds
    actor: 60,    // 1 minute  
    entity: 120,  // 2 minutes
    token: 45,    // 45 seconds
  };
  return estimates[subjectType] || 60;
}

/**
 * Normalize chain string to valid BootstrapChain
 */
function normalizeChain(chain: string): BootstrapChain {
  const normalized = chain?.toLowerCase() || 'ethereum';
  const validChains: BootstrapChain[] = [
    'ethereum', 'arbitrum', 'base', 'bsc', 'solana', 'polygon', 'optimism', 'avalanche'
  ];
  
  if (validChains.includes(normalized as BootstrapChain)) {
    return normalized as BootstrapChain;
  }
  
  return 'ethereum';
}

// Re-export types for convenience
export type { BootstrapSubjectType, BootstrapChain, BootstrapStatus };
