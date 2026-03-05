/**
 * Phase 7: Batch Task Runner
 * 
 * Executes single batch task: replay simulation for date range.
 * Uses existing SimRunner with dataset v2 auto-writer.
 */

import { v4 as uuid } from 'uuid';
import {
  BatchTask,
  BatchRun,
} from './domain.js';
import * as storage from './storage.js';
import { logger } from '../infra/logger.js';

// Import simulation components
import {
  DEFAULT_SIM_CONFIG,
  SimConfig,
} from '../simulator/config.js';
import {
  SimCandle,
  SimPosition,
} from '../simulator/domain.js';
import {
  createEntryOrder,
  tryFillOrder,
  createPosition,
  updatePositionOnCandle,
} from '../simulator/execution.js';
import {
  onPositionClose,
} from '../simulator/dataset_hook.js';

// ═══════════════════════════════════════════════════════════════
// WORKER ID
// ═══════════════════════════════════════════════════════════════

const WORKER_ID = `worker_${process.pid}_${uuid().slice(0, 8)}`;

// ═══════════════════════════════════════════════════════════════
// CANDLE GENERATION (Mock/Deterministic)
// ═══════════════════════════════════════════════════════════════

function mulberry32(seed: number): () => number {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateCandles(
  symbol: string,
  tf: string,
  startTs: number,
  endTs: number,
  warmupBars: number,
  seed: number
): SimCandle[] {
  const candles: SimCandle[] = [];
  const rng = mulberry32(seed + hashCode(symbol + tf));
  
  // TF in ms
  const tfMs = getTfMs(tf);
  
  // Start from warmup
  const warmupStart = startTs - (warmupBars * tfMs);
  
  // Base price depends on symbol
  let price = getBasePrice(symbol);
  const volatility = getVolatility(symbol);
  
  let ts = warmupStart;
  while (ts <= endTs) {
    // Random walk with drift
    const change = (rng() - 0.48) * volatility * price;
    price = Math.max(price * 0.5, price + change);
    
    const range = price * volatility * (0.5 + rng());
    const open = price;
    const close = price + (rng() - 0.5) * range;
    const high = Math.max(open, close) + rng() * range * 0.5;
    const low = Math.min(open, close) - rng() * range * 0.5;
    
    candles.push({
      ts: Math.floor(ts / 1000), // Unix seconds
      open,
      high,
      low,
      close,
      volume: 1000000 * (0.5 + rng()),
    });
    
    price = close;
    ts += tfMs;
  }
  
  return candles;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getTfMs(tf: string): number {
  const tfLower = tf.toLowerCase();
  switch (tfLower) {
    case '1m': return 60 * 1000;
    case '5m': return 5 * 60 * 1000;
    case '15m': return 15 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '4h': return 4 * 60 * 60 * 1000;
    case '1d': return 24 * 60 * 60 * 1000;
    case '1w': return 7 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

function getBasePrice(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes('BTC')) return 30000 + Math.random() * 20000;
  if (s.includes('ETH')) return 2000 + Math.random() * 1000;
  if (s.includes('SOL')) return 50 + Math.random() * 100;
  if (s.includes('BNB')) return 300 + Math.random() * 200;
  if (s.includes('XRP')) return 0.5 + Math.random() * 0.5;
  if (s.includes('SPX') || s.includes('SP500')) return 4000 + Math.random() * 1000;
  if (s.includes('NQ') || s.includes('NASDAQ')) return 14000 + Math.random() * 2000;
  if (s.includes('GOLD') || s.includes('XAU')) return 1800 + Math.random() * 200;
  return 100 + Math.random() * 100;
}

function getVolatility(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes('BTC')) return 0.03;
  if (s.includes('ETH')) return 0.04;
  if (s.includes('SOL')) return 0.05;
  if (s.includes('XRP')) return 0.04;
  if (s.includes('SPX')) return 0.01;
  if (s.includes('NQ')) return 0.015;
  if (s.includes('GOLD')) return 0.008;
  return 0.02;
}

// ═══════════════════════════════════════════════════════════════
// SIMPLE DECISION MAKER (Pattern Detection Stub)
// ═══════════════════════════════════════════════════════════════

interface SimpleDecision {
  shouldTrade: boolean;
  side: 'LONG' | 'SHORT';
  entry: number;
  stop: number;
  target1: number;
  patternType: string;
  confidence: number;
}

function makeDecision(candles: SimCandle[], nowIdx: number): SimpleDecision | null {
  if (nowIdx < 20) return null;
  
  const window = candles.slice(nowIdx - 20, nowIdx + 1);
  const closes = window.map(c => c.close);
  const highs = window.map(c => c.high);
  const lows = window.map(c => c.low);
  
  const now = candles[nowIdx];
  const sma20 = closes.reduce((a, b) => a + b, 0) / closes.length;
  
  // Calculate RSI-like momentum
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const rs = gains / Math.max(losses, 0.001);
  const rsi = 100 - (100 / (1 + rs));
  
  // ATR for stops
  let atrSum = 0;
  for (const c of window) {
    atrSum += c.high - c.low;
  }
  const atr = atrSum / window.length;
  
  // Simple pattern detection
  const recentHigh = Math.max(...highs.slice(-5));
  const recentLow = Math.min(...lows.slice(-5));
  const rangePos = (now.close - recentLow) / (recentHigh - recentLow + 0.001);
  
  // Decision logic: trade more frequently for data generation
  let decision: SimpleDecision | null = null;
  
  // Use simple hash to decide if we trade on this bar (every ~10 bars)
  const barHash = (nowIdx * 7 + Math.floor(now.close * 100)) % 10;
  
  if (barHash === 0) {
    // Decide direction based on trend
    const side: 'LONG' | 'SHORT' = now.close > sma20 ? 'LONG' : 'SHORT';
    
    decision = {
      shouldTrade: true,
      side,
      entry: now.close,
      stop: side === 'LONG' ? now.close - atr * 1.5 : now.close + atr * 1.5,
      target1: side === 'LONG' ? now.close + atr * 2.5 : now.close - atr * 2.5,
      patternType: 'momentum_pattern',
      confidence: 0.6,
    };
    
    // Add variety to pattern types
    const patterns = [
      'triangle_breakout', 'flag_continuation', 'channel_bounce', 
      'double_bottom', 'support_test', 'resistance_reject',
      'momentum_reversal', 'trend_continuation', 'range_breakout'
    ];
    decision.patternType = patterns[nowIdx % patterns.length];
  }
  
  return decision;
}

// ═══════════════════════════════════════════════════════════════
// TASK RUNNER
// ═══════════════════════════════════════════════════════════════

export interface TaskResult {
  success: boolean;
  rowsWritten: number;
  tradesClosed: number;
  error?: string;
}

export async function runTask(task: BatchTask, seed: number): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    // Generate candles
    const candles = generateCandles(
      task.symbol,
      task.tf,
      task.startTs,
      task.endTs,
      task.warmupBars,
      seed
    );
    
    console.log(`[Batch] Task ${task.taskId.slice(0,8)}: Generated ${candles.length} candles, warmup=${task.warmupBars}`);
    
    if (candles.length < task.warmupBars + 10) {
      return { success: false, rowsWritten: 0, tradesClosed: 0, error: `Not enough candles: ${candles.length}` };
    }
    
    const config: SimConfig = {
      ...DEFAULT_SIM_CONFIG,
      tradeTimeoutBars: task.horizonBars,
    };
    
    let openPosition: SimPosition | null = null;
    let openOrder: any = null;
    let rowsWritten = 0;
    let tradesClosed = 0;
    let decisionsAttempted = 0;
    let decisionsAccepted = 0;
    
    const runId = `batch_${task.runId}_${task.taskId}`;
    
    // Walk through candles
    const startIdx = task.warmupBars;
    const endIdx = candles.length;
    console.log(`[Batch] Task ${task.taskId.slice(0,8)}: Walking bars ${startIdx} to ${endIdx-1}`);
    
    for (let i = startIdx; i < endIdx; i++) {
      const nowCandle = candles[i];
      const nowTs = nowCandle.ts;
      
      // Update existing position
      if (openPosition && openPosition.status === 'OPEN') {
        const updateResult = updatePositionOnCandle(openPosition, nowCandle, config);
        openPosition = updateResult.position;
        
        if (updateResult.closed) {
          // Write to dataset via hook
          try {
            await onPositionClose({
              position: openPosition,
              runId,
            });
            rowsWritten++;
            tradesClosed++;
          } catch (e) {
            // Continue even if hook fails
          }
          openPosition = null;
        }
      }
      
      // Try to fill pending order
      if (openOrder && openOrder.status === 'OPEN') {
        openOrder = tryFillOrder(openOrder, nowCandle, config);
        
        if (openOrder.status === 'FILLED') {
          openPosition = createPosition(
            runId,
            {
              scenarioId: openOrder.scenarioId,
              symbol: task.symbol,
              tf: task.tf,
              side: openOrder.side,
              risk: {
                entryPrice: openOrder.filledPrice,
                stopPrice: openOrder.meta?.stop,
                target1Price: openOrder.meta?.target1,
              },
            },
            openOrder,
            config
          );
          openOrder = null;
        }
      }
      
      // No position and no order - try to open new trade
      if (!openPosition && !openOrder) {
        decisionsAttempted++;
        const decision = makeDecision(candles, i);
        
        if (decision && decision.shouldTrade) {
          decisionsAccepted++;
          const scenarioId = `scenario_${nowTs}_${Math.random().toString(36).slice(2, 8)}`;
          
          openOrder = createEntryOrder(
            runId,
            `step_${nowTs}`,
            nowTs,
            {
              scenarioId,
              symbol: task.symbol,
              tf: task.tf,
              side: decision.side,
              risk: {
                entryType: 'MARKET',
                entryPrice: decision.entry,
                stopPrice: decision.stop,
                target1Price: decision.target1,
                entryTimeoutBars: 5,
                tradeTimeoutBars: task.horizonBars,
              },
            }
          );
          
          // Store extra info for dataset
          openOrder.meta = {
            ...openOrder.meta,
            stop: decision.stop,
            target1: decision.target1,
            patternType: decision.patternType,
          };
          
          // MARKET orders fill immediately
          openOrder = tryFillOrder(openOrder, nowCandle, config);
          
          if (openOrder.status === 'FILLED') {
            openPosition = createPosition(
              runId,
              {
                scenarioId,
                symbol: task.symbol,
                tf: task.tf,
                side: decision.side,
                risk: {
                  entryPrice: openOrder.filledPrice,
                  stopPrice: decision.stop,
                  target1Price: decision.target1,
                },
              },
              openOrder,
              config
            );
            openOrder = null;
          }
        }
      }
      
      // Renew lease periodically
      if (i % 100 === 0) {
        await storage.renewTaskLease(task.taskId, WORKER_ID);
      }
    }
    
    // Close any remaining position at end
    if (openPosition && openPosition.status === 'OPEN') {
      const lastCandle = candles[candles.length - 1];
      openPosition.status = 'CLOSED';
      openPosition.exitTs = lastCandle.ts;
      openPosition.exitPrice = lastCandle.close;
      openPosition.exitReason = 'TIMEOUT';
      
      const stopDist = Math.abs(openPosition.entryPrice - openPosition.stopPrice);
      const pnl = openPosition.side === 'LONG'
        ? lastCandle.close - openPosition.entryPrice
        : openPosition.entryPrice - lastCandle.close;
      openPosition.rMultiple = stopDist > 0 ? pnl / stopDist : 0;
      
      try {
        await onPositionClose({ position: openPosition, runId });
        rowsWritten++;
        tradesClosed++;
      } catch (e) {}
    }
    
    const duration = Date.now() - startTime;
    logger.info({
      phase: 'batch_runner',
      taskId: task.taskId,
      symbol: task.symbol,
      tf: task.tf,
      rowsWritten,
      tradesClosed,
      durationMs: duration,
    }, 'Task completed');
    
    return { success: true, rowsWritten, tradesClosed };
    
  } catch (error) {
    return {
      success: false,
      rowsWritten: 0,
      tradesClosed: 0,
      error: (error as Error).message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// BATCH WORKER
// ═══════════════════════════════════════════════════════════════

let workerRunning = false;

export async function startWorker(runId: string, seed: number): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  
  logger.info({ phase: 'batch_worker', runId, workerId: WORKER_ID }, 'Worker started');
  
  while (workerRunning) {
    const task = await storage.claimNextTask(runId, WORKER_ID);
    
    if (!task) {
      // No more tasks, check if run is complete
      const stats = await storage.getTaskStats(runId);
      
      if (stats.pending === 0 && stats.running === 0) {
        // All done
        await storage.updateRunStatus(runId, 'DONE');
        await storage.updateRunProgress(runId, {
          doneTasks: stats.done,
          failedTasks: stats.failed,
          rowsWritten: stats.rowsWritten,
          tradesClosed: stats.tradesClosed,
        });
        break;
      }
      
      // Wait for other workers
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    
    // Run the task
    const result = await runTask(task, seed);
    
    // Update task status
    await storage.completeTask(
      task.taskId,
      result.success,
      { rowsWritten: result.rowsWritten, tradesClosed: result.tradesClosed },
      result.error
    );
    
    // Update run progress
    const stats = await storage.getTaskStats(runId);
    await storage.updateRunProgress(runId, {
      doneTasks: stats.done,
      failedTasks: stats.failed,
      rowsWritten: stats.rowsWritten,
      tradesClosed: stats.tradesClosed,
    });
  }
  
  workerRunning = false;
  logger.info({ phase: 'batch_worker', runId }, 'Worker stopped');
}

export function stopWorker(): void {
  workerRunning = false;
}

export function isWorkerRunning(): boolean {
  return workerRunning;
}
