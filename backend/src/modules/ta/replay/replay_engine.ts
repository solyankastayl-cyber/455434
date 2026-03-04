/**
 * Phase V: Replay Engine
 * 
 * Runs TA engine on historical data step by step.
 * Collects decisions and outcomes for ML training dataset.
 */

import { ReplayProvider, createReplayProvider, ReplayState } from './replay_provider.js';
import { Candle } from '../data/market.provider.js';
import { getBinanceProviderV2 } from '../market/binance_spot_v2.provider.js';
import { logger } from '../infra/logger.js';
import { getMetrics } from '../infra/metrics.js';
import { v4 as uuidv4 } from 'uuid';

export interface ReplayConfig {
  symbol: string;
  timeframe: string;
  startTime: number;  // Unix timestamp ms
  endTime: number;    // Unix timestamp ms
  stepSize: number;   // How many candles to step each iteration
  lookback: number;   // Candles to feed TA engine
  batchSize: number;  // How many steps before saving
}

export interface ReplayStep {
  stepIndex: number;
  timestamp: number;
  candleCount: number;
  decision?: any;
  patterns?: any[];
  scenarios?: any[];
  error?: string;
}

export interface ReplayResult {
  runId: string;
  config: ReplayConfig;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED';
  progress: number;
  totalSteps: number;
  completedSteps: number;
  startedAt: number;
  completedAt?: number;
  steps: ReplayStep[];
  stats: {
    totalDecisions: number;
    winDecisions: number;
    lossDecisions: number;
    noEntryDecisions: number;
    avgProcessingMs: number;
  };
}

export type ReplayCallback = (step: ReplayStep, result: ReplayResult) => Promise<void>;

export class ReplayEngine {
  private provider: ReplayProvider | null = null;
  private currentRun: ReplayResult | null = null;
  private isRunning: boolean = false;
  private shouldStop: boolean = false;
  private metrics = getMetrics();

  /**
   * Start a new replay run
   */
  async start(
    config: ReplayConfig,
    onStep?: ReplayCallback,
    taEngine?: (candles: Candle[]) => Promise<any>
  ): Promise<ReplayResult> {
    if (this.isRunning) {
      throw new Error('Replay already running');
    }

    const runId = uuidv4();
    this.isRunning = true;
    this.shouldStop = false;

    logger.info({ phase: 'replay', runId, config }, 'Starting replay run');

    // Initialize result
    this.currentRun = {
      runId,
      config,
      status: 'RUNNING',
      progress: 0,
      totalSteps: 0,
      completedSteps: 0,
      startedAt: Date.now(),
      steps: [],
      stats: {
        totalDecisions: 0,
        winDecisions: 0,
        lossDecisions: 0,
        noEntryDecisions: 0,
        avgProcessingMs: 0,
      },
    };

    try {
      // Fetch historical candles
      const candles = await this.fetchHistoricalData(config);
      
      if (candles.length < config.lookback + 50) {
        throw new Error(`Insufficient historical data: ${candles.length} candles`);
      }

      // Create replay provider
      this.provider = createReplayProvider(candles, config.symbol, config.timeframe);
      
      // Calculate total steps
      const totalSteps = Math.floor((candles.length - config.lookback) / config.stepSize);
      this.currentRun.totalSteps = totalSteps;

      logger.info({ 
        phase: 'replay', 
        runId, 
        totalCandles: candles.length,
        totalSteps 
      }, 'Historical data loaded');

      // Run replay loop
      let stepIndex = 0;
      const processingTimes: number[] = [];

      while (!this.provider.isAtEnd() && !this.shouldStop) {
        const stepStart = Date.now();

        try {
          // Get current candles (what TA engine sees)
          const visibleCandles = await this.provider.getCandles(
            config.symbol,
            config.timeframe,
            config.lookback
          );

          // Run TA engine if provided
          let decision = null;
          let patterns: any[] = [];
          let scenarios: any[] = [];

          if (taEngine && visibleCandles.length >= 50) {
            try {
              const result = await taEngine(visibleCandles);
              decision = result?.decision || result;
              patterns = result?.patterns || [];
              scenarios = result?.scenarios || [];
            } catch (taError) {
              logger.warn({ 
                phase: 'replay', 
                stepIndex, 
                error: (taError as Error).message 
              }, 'TA engine error');
            }
          }

          // Create step result
          const state = this.provider.getState();
          const step: ReplayStep = {
            stepIndex,
            timestamp: state.currentTime,
            candleCount: visibleCandles.length,
            decision,
            patterns,
            scenarios,
          };

          // Callback for custom processing (e.g., outcome evaluation)
          if (onStep) {
            await onStep(step, this.currentRun);
          }

          // Store step (limit to avoid memory issues)
          if (this.currentRun.steps.length < 1000) {
            this.currentRun.steps.push(step);
          }

          // Update stats
          if (decision) {
            this.currentRun.stats.totalDecisions++;
          }

          processingTimes.push(Date.now() - stepStart);

        } catch (stepError) {
          logger.error({ 
            phase: 'replay', 
            stepIndex, 
            error: (stepError as Error).message 
          }, 'Step error');
        }

        // Advance replay
        this.provider.step(config.stepSize);
        stepIndex++;
        this.currentRun.completedSteps = stepIndex;
        this.currentRun.progress = (stepIndex / totalSteps) * 100;

        // Yield to event loop occasionally
        if (stepIndex % 100 === 0) {
          await new Promise(resolve => setImmediate(resolve));
          
          logger.debug({ 
            phase: 'replay', 
            progress: this.currentRun.progress.toFixed(1) + '%',
            steps: stepIndex
          }, 'Replay progress');
        }
      }

      // Calculate final stats
      if (processingTimes.length > 0) {
        this.currentRun.stats.avgProcessingMs = 
          processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
      }

      this.currentRun.status = this.shouldStop ? 'STOPPED' : 'COMPLETED';
      this.currentRun.completedAt = Date.now();

      logger.info({ 
        phase: 'replay', 
        runId,
        status: this.currentRun.status,
        completedSteps: this.currentRun.completedSteps,
        totalDecisions: this.currentRun.stats.totalDecisions,
        avgMs: this.currentRun.stats.avgProcessingMs.toFixed(1)
      }, 'Replay completed');

    } catch (error) {
      this.currentRun.status = 'FAILED';
      this.currentRun.completedAt = Date.now();
      
      logger.error({ 
        phase: 'replay', 
        runId, 
        error: (error as Error).message 
      }, 'Replay failed');
      
      throw error;
    } finally {
      this.isRunning = false;
    }

    return this.currentRun;
  }

  /**
   * Stop current replay
   */
  stop(): void {
    this.shouldStop = true;
  }

  /**
   * Get current status
   */
  getStatus(): ReplayResult | null {
    return this.currentRun;
  }

  /**
   * Check if running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Fetch historical data from Binance
   */
  private async fetchHistoricalData(config: ReplayConfig): Promise<Candle[]> {
    const provider = getBinanceProviderV2();
    const allCandles: Candle[] = [];
    
    // Binance limit is 1000 per request
    const batchSize = 1000;
    let currentStart = config.startTime;
    
    while (currentStart < config.endTime) {
      const candles = await provider.getHistoricalCandles(
        config.symbol,
        config.timeframe,
        currentStart,
        config.endTime,
        batchSize
      );
      
      if (candles.length === 0) break;
      
      allCandles.push(...candles);
      
      // Move to next batch
      const lastCandle = candles[candles.length - 1];
      currentStart = lastCandle.ts + 1;
      
      // Rate limit protection
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return allCandles;
  }
}

// Singleton instance
let replayEngine: ReplayEngine | null = null;

export function getReplayEngine(): ReplayEngine {
  if (!replayEngine) {
    replayEngine = new ReplayEngine();
  }
  return replayEngine;
}
