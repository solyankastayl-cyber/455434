/**
 * Phase 3.1: Dataset Auto Writer Hook
 * 
 * Automatically writes ML dataset row when position closes in simulator.
 * Links execution outcome to ML training pipeline.
 * 
 * Flow:
 * 1. Position closes (STOP/TARGET/TIMEOUT)
 * 2. Hook extracts features from scenario context
 * 3. Hook computes label from outcome
 * 4. Writes row to ta_ml_rows_v1 collection
 */

import { v4 as uuid } from 'uuid';
import {
  SimPosition,
  SimScenario,
  SimCandle,
} from './domain.js';
import { 
  writeDatasetRow 
} from '../ml/dataset_writer.js';
import { 
  extractFeatures, 
  ExtractorInput 
} from '../ml/feature_extractor.js';
import { 
  MLDatasetRow,
  createEmptyFeatures,
  MLFeatures 
} from '../ml/feature_schema.js';
import { logger } from '../infra/logger.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface DatasetHookConfig {
  enabled: boolean;
  minRForWrite: number;      // Min R-multiple to write (filter noise)
  maxRForWrite: number;      // Max R to prevent outliers
  writeOnTimeout: boolean;   // Include timeout outcomes
}

const DEFAULT_CONFIG: DatasetHookConfig = {
  enabled: true,
  minRForWrite: -5,          // Filter massive losses (data errors)
  maxRForWrite: 10,          // Filter outliers
  writeOnTimeout: true,
};

let hookConfig = { ...DEFAULT_CONFIG };

export function setDatasetHookConfig(config: Partial<DatasetHookConfig>): void {
  hookConfig = { ...hookConfig, ...config };
}

export function getDatasetHookConfig(): DatasetHookConfig {
  return { ...hookConfig };
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT STORAGE (per run)
// ═══════════════════════════════════════════════════════════════

interface ScenarioContext {
  scenario: SimScenario;
  patterns: any[];
  riskPack: any;
  regime: any;
  vol: any;
  confluence: any;
  reliability: any;
  candles: SimCandle[];
  nowTs: number;
}

// Store context when scenario is created
const scenarioContexts = new Map<string, ScenarioContext>();

/**
 * Store scenario context for later feature extraction
 */
export function storeScenarioContext(
  scenarioId: string,
  context: ScenarioContext
): void {
  scenarioContexts.set(scenarioId, context);
  
  // Cleanup old entries (keep last 1000)
  if (scenarioContexts.size > 1000) {
    const oldest = Array.from(scenarioContexts.keys()).slice(0, 500);
    for (const key of oldest) {
      scenarioContexts.delete(key);
    }
  }
}

/**
 * Get stored scenario context
 */
export function getScenarioContext(scenarioId: string): ScenarioContext | null {
  return scenarioContexts.get(scenarioId) || null;
}

/**
 * Clear context for scenario (after use)
 */
export function clearScenarioContext(scenarioId: string): void {
  scenarioContexts.delete(scenarioId);
}

// ═══════════════════════════════════════════════════════════════
// MAIN HOOK: ON POSITION CLOSE
// ═══════════════════════════════════════════════════════════════

export interface OnPositionCloseParams {
  position: SimPosition;
  runId: string;
  scenario?: SimScenario;
  patterns?: any[];
  riskPack?: any;
  regime?: any;
  vol?: any;
  confluence?: any;
  reliability?: any;
}

/**
 * Hook called when position closes in simulator
 * Extracts features and writes ML dataset row
 */
export async function onPositionClose(params: OnPositionCloseParams): Promise<void> {
  if (!hookConfig.enabled) {
    return;
  }
  
  const { position, runId } = params;
  
  // Validate position is closed
  if (position.status !== 'CLOSED') {
    return;
  }
  
  // Skip if no R-multiple
  const r = position.rMultiple;
  if (r === undefined || r === null) {
    logger.debug({ phase: 'dataset_hook', reason: 'no_r_multiple' }, 'Skipping dataset write');
    return;
  }
  
  // Filter outliers
  if (r < hookConfig.minRForWrite || r > hookConfig.maxRForWrite) {
    logger.debug({ 
      phase: 'dataset_hook', 
      reason: 'r_out_of_range',
      r,
      range: [hookConfig.minRForWrite, hookConfig.maxRForWrite]
    }, 'Skipping dataset write');
    return;
  }
  
  // Skip timeout if configured
  if (!hookConfig.writeOnTimeout && position.exitReason === 'TIMEOUT') {
    logger.debug({ phase: 'dataset_hook', reason: 'timeout_excluded' }, 'Skipping dataset write');
    return;
  }
  
  try {
    // Get stored context or use params
    const scenarioId = position.scenarioId;
    const storedContext = getScenarioContext(scenarioId);
    
    // Build extractor input
    const extractorInput: ExtractorInput = {
      scenario: storedContext?.scenario || params.scenario,
      patterns: storedContext?.patterns || params.patterns || [],
      riskPack: storedContext?.riskPack || params.riskPack,
      structure: { regime: storedContext?.regime || params.regime },
      vol: storedContext?.vol || params.vol,
      confluence: storedContext?.confluence || params.confluence,
      reliability: storedContext?.reliability || params.reliability,
    };
    
    // Extract features
    const features = extractFeatures(extractorInput);
    
    // Compute label: 1 = win, 0 = loss
    const label = r > 0 ? 1 : 0;
    
    // Build row
    const row: MLDatasetRow = {
      rowId: uuid(),
      runId,
      scenarioId,
      symbol: position.symbol,
      timeframe: position.tf,
      timestamp: position.entryTs,
      features,
      label,
      meta: {
        entry: position.entryPrice,
        stop: position.stopPrice,
        target: position.target1Price || 0,
        rMultiple: r,
        mfePct: position.mfePct,
        maePct: position.maePct,
        barsInTrade: position.barsInTrade,
        exitReason: position.exitReason,
        side: position.side,
      },
    };
    
    // Write to database
    await writeDatasetRow(row);
    
    logger.info({ 
      phase: 'dataset_hook',
      scenarioId,
      symbol: position.symbol,
      label,
      r: r.toFixed(2),
      exitReason: position.exitReason,
    }, 'ML dataset row written');
    
    // Cleanup stored context
    clearScenarioContext(scenarioId);
    
  } catch (error) {
    logger.error({ 
      phase: 'dataset_hook',
      error: (error as Error).message,
      scenarioId: position.scenarioId,
    }, 'Failed to write dataset row');
  }
}

// ═══════════════════════════════════════════════════════════════
// BATCH WRITE (for replay catchup)
// ═══════════════════════════════════════════════════════════════

export interface BatchWriteResult {
  written: number;
  skipped: number;
  errors: number;
}

/**
 * Batch write dataset rows for completed positions
 * Useful for backfilling from existing simulation runs
 */
export async function batchWriteFromPositions(
  positions: SimPosition[],
  runId: string
): Promise<BatchWriteResult> {
  const result: BatchWriteResult = {
    written: 0,
    skipped: 0,
    errors: 0,
  };
  
  for (const position of positions) {
    try {
      if (position.status !== 'CLOSED') {
        result.skipped++;
        continue;
      }
      
      const r = position.rMultiple;
      if (r === undefined || r === null) {
        result.skipped++;
        continue;
      }
      
      if (r < hookConfig.minRForWrite || r > hookConfig.maxRForWrite) {
        result.skipped++;
        continue;
      }
      
      // Create minimal features (no context available for batch)
      const features = createEmptyFeatures();
      features.rrToT1 = position.target1Price 
        ? Math.abs(position.target1Price - position.entryPrice) / Math.abs(position.entryPrice - position.stopPrice)
        : 0;
      features.topBias = position.side === 'LONG' ? 1 : -1;
      
      const label = r > 0 ? 1 : 0;
      
      const row: MLDatasetRow = {
        rowId: uuid(),
        runId,
        scenarioId: position.scenarioId,
        symbol: position.symbol,
        timeframe: position.tf,
        timestamp: position.entryTs,
        features,
        label,
        meta: {
          entry: position.entryPrice,
          stop: position.stopPrice,
          target: position.target1Price || 0,
          rMultiple: r,
          mfePct: position.mfePct,
          maePct: position.maePct,
          barsInTrade: position.barsInTrade,
          exitReason: position.exitReason,
          side: position.side,
        },
      };
      
      await writeDatasetRow(row);
      result.written++;
      
    } catch (error) {
      result.errors++;
    }
  }
  
  logger.info({
    phase: 'dataset_hook',
    batch: true,
    ...result,
  }, 'Batch dataset write complete');
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

export {
  DEFAULT_CONFIG as DATASET_HOOK_DEFAULT_CONFIG,
};
