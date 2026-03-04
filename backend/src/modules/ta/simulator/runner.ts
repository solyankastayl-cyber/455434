/**
 * Phase 3.0: Execution Simulator - Runner
 * 
 * Main simulation loop that:
 * 1. Steps through candles (replay)
 * 2. Gets decision at each step
 * 3. Creates/fills orders
 * 4. Manages positions
 * 5. Records outcomes
 * 
 * CRITICAL: No lookahead bias - only uses candles <= nowTs
 */

import { v4 as uuid } from 'uuid';
import {
  SimRunSpec,
  SimOrder,
  SimPosition,
  SimScenario,
  SimCandle,
  SimEvent,
} from './domain.js';
import { SimConfig, getSimConfig } from './config.js';
import { SimStorage } from './storage.js';
import {
  createEntryOrder,
  tryFillOrder,
  createPosition,
  updatePositionOnCandle,
  decisionToSimScenario,
} from './execution.js';
import {
  onPositionClose,
  storeScenarioContext,
  getDatasetHookConfig,
} from './dataset_hook.js';

// ═══════════════════════════════════════════════════════════════
// RUNNER INTERFACES
// ═══════════════════════════════════════════════════════════════

export interface MarketDataProvider {
  getCandles(symbol: string, tf: string, toTs: number, limit: number): Promise<SimCandle[]>;
}

export interface DecisionProvider {
  getDecision(symbol: string, tf: string, nowTs: number, candles: SimCandle[]): Promise<any>;
}

export interface SimRunParams {
  symbol: string;
  tf: string;
  fromTs: number;
  toTs: number;
  warmupBars: number;
  seed: number;
  mode: 'TOP1' | 'TOP3' | 'PORTFOLIO';
}

// ═══════════════════════════════════════════════════════════════
// RUNNER CLASS
// ═══════════════════════════════════════════════════════════════

export class SimRunner {
  private storage: SimStorage;
  private market: MarketDataProvider;
  private decision: DecisionProvider;
  
  constructor(
    storage: SimStorage,
    market: MarketDataProvider,
    decision: DecisionProvider
  ) {
    this.storage = storage;
    this.market = market;
    this.decision = decision;
  }
  
  /**
   * Run full simulation
   */
  async run(params: SimRunParams): Promise<{ runId: string; summary: any }> {
    const runId = uuid();
    const config = getSimConfig(params.tf);
    
    // Create run record
    const run: SimRunSpec = {
      runId,
      symbol: params.symbol,
      tf: params.tf,
      fromTs: params.fromTs,
      toTs: params.toTs,
      warmupBars: params.warmupBars,
      stepBars: 1,
      seed: params.seed,
      mode: params.mode,
      createdAt: new Date(),
      status: 'RUNNING',
    };
    
    await this.storage.insertRun(run);
    await this.logEvent(runId, 'RUN_START', 0, { params });
    
    console.log(`[SimRunner] Starting run ${runId}: ${params.symbol} ${params.tf}`);
    
    try {
      // Fetch all candles in range
      const allCandles = await this.market.getCandles(
        params.symbol,
        params.tf,
        params.toTs,
        50_000 // Max fetch
      );
      
      // Filter to our range
      const candles = allCandles.filter(
        c => c.ts >= params.fromTs && c.ts <= params.toTs
      );
      
      if (candles.length < params.warmupBars + 10) {
        throw new Error(`Not enough candles: ${candles.length} (need ${params.warmupBars + 10})`);
      }
      
      console.log(`[SimRunner] Processing ${candles.length} candles`);
      
      // State
      let openPosition: SimPosition | null = null;
      let openOrder: SimOrder | null = null;
      let stepsProcessed = 0;
      
      // Main loop: step through candles
      for (let i = params.warmupBars; i < candles.length; i++) {
        const nowCandle = candles[i];
        const nowTs = nowCandle.ts;
        const stepId = `${runId}:${nowTs}`;
        
        // LEAKAGE GUARD: window is ONLY candles up to and including current
        const window = candles.slice(Math.max(0, i - params.warmupBars), i + 1);
        
        // Verify no future data
        const maxWindowTs = Math.max(...window.map(c => c.ts));
        if (maxWindowTs !== nowTs) {
          console.error(`[LEAKAGE] Max window ts ${maxWindowTs} != nowTs ${nowTs}`);
          throw new Error('LEAKAGE_GUARD_FAILED');
        }
        
        stepsProcessed++;
        
        // === PHASE 1: Try to fill existing order ===
        if (openOrder && openOrder.status === 'OPEN') {
          const fillResult = tryFillOrder(openOrder, nowCandle, config);
          openOrder = fillResult.order;
          
          if (fillResult.filled) {
            await this.storage.updateOrder(runId, openOrder.orderId, openOrder);
            await this.logEvent(runId, 'ORDER_FILLED', nowTs, {
              orderId: openOrder.orderId,
              filledPrice: openOrder.filledPrice,
            });
            
            // Create position
            const scenario = await this.getStoredScenario(openOrder.scenarioId);
            if (scenario) {
              openPosition = createPosition(runId, scenario, openOrder, config);
              await this.storage.insertPosition(openPosition);
              await this.logEvent(runId, 'POSITION_OPENED', nowTs, {
                positionId: openPosition.positionId,
                side: openPosition.side,
                entryPrice: openPosition.entryPrice,
              });
            }
            
            openOrder = null;
          } else if (openOrder.status === 'EXPIRED') {
            await this.storage.updateOrder(runId, openOrder.orderId, openOrder);
            await this.logEvent(runId, 'ORDER_EXPIRED', nowTs, {
              orderId: openOrder.orderId,
            });
            openOrder = null;
          }
        }
        
        // === PHASE 2: Update existing position ===
        if (openPosition && openPosition.status === 'OPEN') {
          const updateResult = updatePositionOnCandle(openPosition, nowCandle, config);
          openPosition = updateResult.position;
          
          await this.storage.updatePosition(runId, openPosition.positionId, openPosition);
          
          if (updateResult.closed) {
            await this.logEvent(runId, 'POSITION_CLOSED', nowTs, {
              positionId: openPosition.positionId,
              exitReason: openPosition.exitReason,
              rMultiple: openPosition.rMultiple,
            });
            
            // Phase 3.1: Auto-write ML dataset row on position close
            try {
              const storedScenario = await this.getStoredScenario(openPosition.scenarioId);
              await onPositionClose({
                position: openPosition,
                runId,
                scenario: storedScenario || undefined,
              });
            } catch (hookErr) {
              console.warn(`[SimRunner] Dataset hook error: ${(hookErr as Error).message}`);
            }
            
            openPosition = null;
          }
        }
        
        // === PHASE 3: If no position and no order, get new decision ===
        if (!openPosition && !openOrder && config.maxOnePosition) {
          try {
            const decisionResult = await this.decision.getDecision(
              params.symbol,
              params.tf,
              nowTs,
              window
            );
            
            const scenario = decisionToSimScenario(decisionResult, params.symbol, params.tf);
            
            if (scenario && this.isValidScenario(scenario, nowCandle)) {
              // Store scenario for later reference
              await this.storeScenario(scenario);
              
              // Create entry order
              openOrder = createEntryOrder(runId, stepId, nowTs, scenario, config);
              await this.storage.insertOrder(openOrder);
              await this.logEvent(runId, 'ORDER_CREATED', nowTs, {
                orderId: openOrder.orderId,
                type: openOrder.type,
                side: openOrder.side,
              });
              
              // Try immediate fill for MARKET orders
              if (openOrder.type === 'MARKET') {
                const fillResult = tryFillOrder(openOrder, nowCandle, config);
                openOrder = fillResult.order;
                
                if (fillResult.filled) {
                  await this.storage.updateOrder(runId, openOrder.orderId, openOrder);
                  await this.logEvent(runId, 'ORDER_FILLED', nowTs, {
                    orderId: openOrder.orderId,
                    filledPrice: openOrder.filledPrice,
                  });
                  
                  openPosition = createPosition(runId, scenario, openOrder, config);
                  await this.storage.insertPosition(openPosition);
                  await this.logEvent(runId, 'POSITION_OPENED', nowTs, {
                    positionId: openPosition.positionId,
                    side: openPosition.side,
                    entryPrice: openPosition.entryPrice,
                  });
                  
                  openOrder = null;
                }
              }
            }
          } catch (e) {
            // Decision engine error - skip this step
            console.warn(`[SimRunner] Decision error at step ${i}: ${(e as Error).message}`);
          }
        }
        
        // Progress logging
        if (stepsProcessed % 100 === 0) {
          console.log(`[SimRunner] Progress: ${stepsProcessed}/${candles.length - params.warmupBars} steps`);
        }
      }
      
      // Complete
      await this.storage.updateRunStatus(runId, 'DONE', { finishedAt: new Date() });
      await this.logEvent(runId, 'RUN_COMPLETE', Date.now(), { stepsProcessed });
      
      // Compute summary
      const summary = await this.storage.computeSummary(runId);
      
      console.log(`[SimRunner] Completed ${runId}: ${summary?.totalTrades || 0} trades`);
      
      return { runId, summary };
      
    } catch (error) {
      await this.storage.updateRunStatus(runId, 'FAILED', { 
        finishedAt: new Date(),
        error: (error as Error).message,
      });
      throw error;
    }
  }
  
  /**
   * Validate scenario has required fields and makes sense
   */
  private isValidScenario(scenario: SimScenario, nowCandle: SimCandle): boolean {
    const { risk } = scenario;
    
    // Must have stop
    if (!risk.stopPrice || risk.stopPrice <= 0) {
      return false;
    }
    
    // Stop must be on correct side
    if (scenario.side === 'LONG') {
      if (risk.stopPrice >= nowCandle.close) {
        return false; // Stop above entry for LONG
      }
    } else {
      if (risk.stopPrice <= nowCandle.close) {
        return false; // Stop below entry for SHORT
      }
    }
    
    // Target (if exists) must be on correct side
    if (risk.target1Price) {
      if (scenario.side === 'LONG' && risk.target1Price <= nowCandle.close) {
        return false;
      }
      if (scenario.side === 'SHORT' && risk.target1Price >= nowCandle.close) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Log simulation event
   */
  private async logEvent(
    runId: string,
    type: SimEvent['type'],
    ts: number,
    data: Record<string, any>
  ): Promise<void> {
    await this.storage.insertEvent({
      eventId: uuid(),
      runId,
      stepId: `${runId}:${ts}`,
      type,
      ts,
      data,
    } as SimEvent);
  }
  
  // Scenario cache (in-memory for now, could be MongoDB)
  private scenarioCache = new Map<string, SimScenario>();
  
  private async storeScenario(scenario: SimScenario): Promise<void> {
    this.scenarioCache.set(scenario.scenarioId, scenario);
  }
  
  private async getStoredScenario(scenarioId: string): Promise<SimScenario | null> {
    return this.scenarioCache.get(scenarioId) || null;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let runnerInstance: SimRunner | null = null;

export function initSimRunner(
  storage: SimStorage,
  market: MarketDataProvider,
  decision: DecisionProvider
): SimRunner {
  runnerInstance = new SimRunner(storage, market, decision);
  return runnerInstance;
}

export function getSimRunner(): SimRunner | null {
  return runnerInstance;
}
