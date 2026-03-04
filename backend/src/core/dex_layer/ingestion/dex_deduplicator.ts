/**
 * DEX Trade Deduplicator (P0.4)
 * 
 * Ensures idempotent ingestion:
 * - Deterministic tradeId generation
 * - In-memory dedup for batch processing
 * - MongoDB duplicate handling
 */

import { generateTradeId, DexTradeModel, IDexTrade } from '../storage/dex_trade.model.js';

// ============================================
// Types
// ============================================

export interface DeduplicationResult {
  unique: IDexTrade[];
  duplicates: number;
  duplicateIds: string[];
}

export interface BatchInsertResult {
  inserted: number;
  duplicates: number;
  errors: number;
  errorMessages: string[];
}

// ============================================
// In-Memory Deduplication
// ============================================

/**
 * In-memory deduplication for a batch of trades
 * Removes duplicates within the same batch
 */
export function deduplicateBatch(trades: IDexTrade[]): DeduplicationResult {
  const seen = new Set<string>();
  const unique: IDexTrade[] = [];
  const duplicateIds: string[] = [];
  
  for (const trade of trades) {
    if (seen.has(trade.tradeId)) {
      duplicateIds.push(trade.tradeId);
    } else {
      seen.add(trade.tradeId);
      unique.push(trade);
    }
  }
  
  return {
    unique,
    duplicates: duplicateIds.length,
    duplicateIds
  };
}

// ============================================
// MongoDB Deduplication
// ============================================

/**
 * Check which tradeIds already exist in database
 */
export async function findExistingTradeIds(tradeIds: string[]): Promise<Set<string>> {
  if (tradeIds.length === 0) return new Set();
  
  const existing = await DexTradeModel.find(
    { tradeId: { $in: tradeIds } },
    { tradeId: 1 }
  ).lean();
  
  return new Set(existing.map(t => t.tradeId));
}

/**
 * Filter out trades that already exist in database
 */
export async function filterNewTrades(trades: IDexTrade[]): Promise<{
  newTrades: IDexTrade[];
  existingCount: number;
}> {
  if (trades.length === 0) {
    return { newTrades: [], existingCount: 0 };
  }
  
  const tradeIds = trades.map(t => t.tradeId);
  const existingIds = await findExistingTradeIds(tradeIds);
  
  const newTrades = trades.filter(t => !existingIds.has(t.tradeId));
  
  return {
    newTrades,
    existingCount: existingIds.size
  };
}

// ============================================
// Safe Batch Insert
// ============================================

/**
 * Insert trades with duplicate handling
 * Uses ordered:false for best performance with duplicates
 */
export async function safeBatchInsert(trades: IDexTrade[]): Promise<BatchInsertResult> {
  if (trades.length === 0) {
    return { inserted: 0, duplicates: 0, errors: 0, errorMessages: [] };
  }
  
  // Step 1: In-memory dedup
  const { unique, duplicates: batchDuplicates } = deduplicateBatch(trades);
  
  if (unique.length === 0) {
    return { 
      inserted: 0, 
      duplicates: batchDuplicates, 
      errors: 0, 
      errorMessages: [] 
    };
  }
  
  // Step 2: Filter against database
  const { newTrades, existingCount } = await filterNewTrades(unique);
  
  if (newTrades.length === 0) {
    return { 
      inserted: 0, 
      duplicates: batchDuplicates + existingCount, 
      errors: 0, 
      errorMessages: [] 
    };
  }
  
  // Step 3: Insert with ordered:false to continue on duplicates
  let inserted = 0;
  let errors = 0;
  const errorMessages: string[] = [];
  
  try {
    const result = await DexTradeModel.insertMany(newTrades, { 
      ordered: false,
      // Ignore duplicate key errors
      rawResult: true
    });
    
    inserted = result.insertedCount || newTrades.length;
  } catch (error: any) {
    // Handle bulk write errors (some may have succeeded)
    if (error.name === 'MongoBulkWriteError' || error.code === 11000) {
      // Extract successful inserts
      inserted = error.result?.insertedCount || 0;
      
      // Count duplicate key errors vs other errors
      const writeErrors = error.writeErrors || [];
      for (const writeError of writeErrors) {
        if (writeError.code === 11000) {
          // Duplicate key - not an error for us
        } else {
          errors++;
          errorMessages.push(writeError.errmsg || 'Unknown write error');
        }
      }
    } else {
      // Unexpected error
      errors = newTrades.length;
      errorMessages.push(error.message || 'Unexpected insert error');
    }
  }
  
  return {
    inserted,
    duplicates: batchDuplicates + existingCount + (newTrades.length - inserted - errors),
    errors,
    errorMessages
  };
}

// ============================================
// Validation
// ============================================

/**
 * Validate trade data before insert
 */
export function validateTrade(trade: Partial<IDexTrade>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!trade.chain) errors.push('Missing chain');
  if (!trade.txHash) errors.push('Missing txHash');
  if (trade.logIndex === undefined) errors.push('Missing logIndex');
  if (!trade.poolAddress) errors.push('Missing poolAddress');
  if (!trade.trader) errors.push('Missing trader');
  if (!trade.tokenIn) errors.push('Missing tokenIn');
  if (!trade.tokenOut) errors.push('Missing tokenOut');
  if (!trade.amountIn) errors.push('Missing amountIn');
  if (!trade.amountOut) errors.push('Missing amountOut');
  if (!trade.timestamp) errors.push('Missing timestamp');
  if (!trade.blockNumber) errors.push('Missing blockNumber');
  
  // Validate amounts are valid numbers
  if (trade.amountIn && isNaN(Number(trade.amountIn))) {
    errors.push('Invalid amountIn');
  }
  if (trade.amountOut && isNaN(Number(trade.amountOut))) {
    errors.push('Invalid amountOut');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate and prepare trades for insert
 */
export function prepareTradesForInsert(
  rawTrades: Array<Partial<IDexTrade>>
): { valid: IDexTrade[]; invalid: Array<{ trade: Partial<IDexTrade>; errors: string[] }> } {
  const valid: IDexTrade[] = [];
  const invalid: Array<{ trade: Partial<IDexTrade>; errors: string[] }> = [];
  
  for (const trade of rawTrades) {
    const validation = validateTrade(trade);
    
    if (validation.valid) {
      // Generate tradeId if not present
      if (!trade.tradeId) {
        trade.tradeId = generateTradeId({
          chain: trade.chain!,
          txHash: trade.txHash!,
          logIndex: trade.logIndex!,
          poolAddress: trade.poolAddress!,
          trader: trade.trader!,
          amountIn: trade.amountIn!,
          amountOut: trade.amountOut!
        });
      }
      
      valid.push(trade as IDexTrade);
    } else {
      invalid.push({ trade, errors: validation.errors });
    }
  }
  
  return { valid, invalid };
}

export { generateTradeId };
