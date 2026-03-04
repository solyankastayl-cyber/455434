/**
 * Job Scheduler
 * Runs periodic tasks (indexer, score recalculations, bundle detection, etc.)
 */
import { env } from '../config/env.js';
import { EthereumRpc, syncERC20Transfers, getSyncStatus } from '../onchain/ethereum/index.js';
import { buildTransfersFromERC20, getBuildStatus } from './build_transfers.job.js';
import { buildRelations, getBuildRelationsStatus } from './build_relations.job.js';
import { buildBundles, getBuildBundlesStatus } from './build_bundles.job.js';
import { buildSignals, getBuildSignalsStatus } from './build_signals.job.js';
import { buildScores, getBuildScoresStatus } from './build_scores.job.js';
import { buildStrategyProfiles, getBuildStrategyProfilesStatus } from './build_strategy_profiles.job.js';
import { buildStrategySignals, getBuildStrategySignalsStatus } from './build_strategy_signals.job.js';
import { dispatchFollowEvents, getDispatchFollowEventsStatus } from './dispatch_follow_events.job.js';
import { dispatchAlerts, getDispatchAlertsStatus } from './dispatch_alerts.job.js';
import { buildActorProfiles, getBuildActorProfilesStatus } from './build_actor_profiles.job.js';
import { buildDecisions, getBuildDecisionsStatus } from './build_decisions.job.js';
import { buildActions, getBuildActionsStatus } from './build_actions.job.js';
import { updateTrustScores, getUpdateTrustStatus } from './update_trust_scores.job.js';

// Phase 12A - Adaptive Intelligence Jobs
import { updateAdaptiveWeights, getUpdateAdaptiveWeightsStatus } from './update_adaptive_weights.job.js';
import { recalibrateConfidence, getRecalibrateConfidenceStatus } from './recalibrate_confidence.job.js';
import { updateStrategyReliability, getUpdateStrategyReliabilityStatus } from './update_strategy_reliability.job.js';

// Phase 12B - Personalized Intelligence Jobs
import { updateUserBias, getUpdateUserBiasStatus } from './update_user_bias.job.js';
import { recomputePersonalizedScores, getRecomputePersonalizedScoresStatus } from './recompute_personalized_scores.job.js';

// Phase 12C - Learning Control Jobs
import { checkLearningHealth, getLearningHealthStatus } from './check_learning_health.job.js';

// Phase 13 - Automation Jobs
import { dispatchActions, getDispatchActionsStatus } from './dispatch_actions.job.js';
import { buildActionSuggestions, getBuildActionSuggestionsStatus } from './build_action_suggestions.job.js';
import { simulateCopy, getSimulateCopyStatus } from './simulate_copy.job.js';

// P0 FIX - Alert Evaluation Job
import { evaluateAlertRules, getEvaluateAlertRulesStatus } from './evaluate_alert_rules.job.js';

// Phase 14A - Market Reality Layer Jobs
import { buildPricePoints, getBuildPricePointsStatus } from './build_price_points.job.js';
import { buildMarketMetrics, getBuildMarketMetricsStatus } from './build_market_metrics.job.js';

// Phase 14B - Signal Reactions Jobs
import { buildSignalReactions, getBuildSignalReactionsStatus } from './build_signal_reactions.job.js';

// Phase 14C - Market Regimes Jobs
import { buildMarketRegimes, getBuildMarketRegimesStatus } from './build_market_regimes.job.js';

// Phase 15 - Trust, Reputation & Public Confidence Jobs
import { buildSignalReputation, getBuildSignalReputationStatus } from './build_signal_reputation.job.js';
import { buildStrategyReputation, getBuildStrategyReputationStatus } from './build_strategy_reputation.job.js';
import { buildActorReputation, getBuildActorReputationStatus } from './build_actor_reputation.job.js';
import { buildTrustSnapshots, getBuildTrustSnapshotsStatus } from './build_trust_snapshots.job.js';

// P0 Memory Optimization - Actors Graph Cache Job
import { buildActorsGraph as buildActorsGraphJob, getBuildActorsGraphStatus } from './build_actors_graph.job.js';

// Sprint 3 - Actor Signals v2
import { buildActorSignals, getBuildActorSignalsStatus } from './build_actor_signals.job.js';

// Sprint 3 - Signal Context Aggregation
import { buildSignalContexts, getBuildSignalContextsStatus } from './build_signal_contexts.job.js';

// Signal Reweighting v1.1 (between ETAP 3-4 and ETAP 5)
import { runSignalReweighting, getSignalReweightingJobStatus } from './run_signal_reweighting.job.js';

// ETAP 5.1 - Self-Learning Retrain (Guards + Dataset Freeze + Orchestrator)
import { runSelfLearningJob, getSelfLearningJobStatus } from './self_learning_retrain.job.js';

// ETAP 6.1 - Raw Data Ingest
import { runIngestJob, getIngestJobStatus } from './ingest_transfers.job.js';

// ETAP 6.2/6.3 - Aggregation & Snapshot Jobs
import { runAggregationAndSnapshotJob } from './aggregation_snapshot.job.js';

// BLOCK 2.1 - Bridge Detection Cron
import { runBridgeScan, getBridgeScanStatus } from './bridge_scan.job.js';

// ETAP D2 - Node Analytics Cron
import { runNodeAnalyticsJob, getNodeAnalyticsJobStatus } from './node_analytics.job.js';

// ML v2.1 STEP 2 - Accuracy & Drift Jobs
import { runAccuracySnapshotJob } from './ml_accuracy_snapshot.job.js';
import { runDriftDetectionJob } from './ml_drift_detection.job.js';

// V3.0 Pack A - Feature Builder Jobs
import { runV3FeatureBuilderJob } from './v3_feature_builder.job.js';

interface ScheduledJob {
  name: string;
  interval: number; // ms
  handler: () => Promise<void>;
  lastRun?: Date;
  running: boolean;
}

class Scheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Register a new job
   */
  register(name: string, intervalMs: number, handler: () => Promise<void>): void {
    this.jobs.set(name, {
      name,
      interval: intervalMs,
      handler,
      running: false,
    });
    console.log(`[Scheduler] Job registered: ${name} (every ${intervalMs}ms)`);
  }

  /**
   * Start all jobs
   */
  startAll(): void {
    for (const job of this.jobs.values()) {
      this.startJob(job.name);
    }
  }

  /**
   * Start a specific job
   */
  startJob(name: string): void {
    const job = this.jobs.get(name);
    if (!job) return;

    // Run immediately first time
    this.runJob(job);

    const timer = setInterval(() => this.runJob(job), job.interval);
    this.timers.set(name, timer);
    console.log(`[Scheduler] Job started: ${name}`);
  }

  /**
   * Run a job
   */
  private async runJob(job: ScheduledJob): Promise<void> {
    if (job.running) {
      console.log(`[Scheduler] Job ${job.name} still running, skipping`);
      return;
    }

    job.running = true;
    try {
      await job.handler();
      job.lastRun = new Date();
    } catch (err) {
      console.error(`[Scheduler] Job ${job.name} failed:`, err);
    } finally {
      job.running = false;
    }
  }

  /**
   * Stop all jobs
   */
  stopAll(): void {
    for (const [name, timer] of this.timers) {
      clearInterval(timer);
      console.log(`[Scheduler] Job stopped: ${name}`);
    }
    this.timers.clear();
  }

  /**
   * Stop a specific job
   */
  stopJob(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(name);
      console.log(`[Scheduler] Job stopped: ${name}`);
    }
  }

  /**
   * Get job status
   */
  getStatus(): Record<string, { running: boolean; lastRun?: Date }> {
    const status: Record<string, { running: boolean; lastRun?: Date }> = {};
    for (const [name, job] of this.jobs) {
      status[name] = { running: job.running, lastRun: job.lastRun };
    }
    return status;
  }
}

export const scheduler = new Scheduler();

// Global RPC instance (initialized in registerDefaultJobs)
let ethereumRpc: EthereumRpc | null = null;

/**
 * Get Ethereum RPC instance
 */
export function getEthereumRpc(): EthereumRpc | null {
  return ethereumRpc;
}

/**
 * Register default jobs
 * Call this after DB connection
 */
export function registerDefaultJobs(): void {
  // ========== ERC-20 INDEXER JOB ==========
  if (env.INDEXER_ENABLED && env.INFURA_RPC_URL) {
    // Use both Infura and Ankr for load balancing
    ethereumRpc = new EthereumRpc(env.INFURA_RPC_URL, env.ANKR_RPC_URL);

    scheduler.register('erc20-indexer', env.INDEXER_INTERVAL_MS, async () => {
      if (!ethereumRpc) return;
      
      try {
        const result = await syncERC20Transfers(ethereumRpc);
        
        // Log progress periodically
        if (result.logsCount > 0) {
          console.log(
            `[ERC20 Indexer] Synced blocks ${result.fromBlock}-${result.toBlock}: ` +
            `${result.newLogsCount} new logs (${result.duration}ms)`
          );
        }
      } catch (err) {
        console.error('[ERC20 Indexer] Sync failed:', err);
      }
    });

    console.log('[Scheduler] ERC-20 Indexer job registered (Infura + Ankr load balancing)');
  } else {
    console.log('[Scheduler] ERC-20 Indexer disabled (no INFURA_RPC_URL or INDEXER_ENABLED=false)');
  }

  // ========== BUILD TRANSFERS JOB (L1 → L2) ==========
  if (env.INDEXER_ENABLED) {
    // Run slightly after indexer to ensure logs are available
    const buildInterval = env.INDEXER_INTERVAL_MS + 5000; // 5 seconds after indexer
    
    scheduler.register('build-transfers', buildInterval, async () => {
      try {
        const result = await buildTransfersFromERC20();
        
        if (result.processed > 0) {
          console.log(
            `[Build Transfers] Created ${result.created} transfers from ${result.processed} logs (${result.duration}ms)`
          );
        }
      } catch (err) {
        console.error('[Build Transfers] Job failed:', err);
      }
    });

    console.log('[Scheduler] Build Transfers job registered');
  }

  // ========== BUILD RELATIONS JOB (L2 → L3) ==========
  if (env.INDEXER_ENABLED) {
    // Run after build-transfers to ensure transfers are available
    const relationsInterval = env.INDEXER_INTERVAL_MS + 10000; // 10 seconds after indexer
    
    scheduler.register('build-relations', relationsInterval, async () => {
      try {
        const result = await buildRelations();
        
        if (result.processedTransfers > 0) {
          console.log(
            `[Build Relations] Created ${result.relationsCreated} relations, ` +
            `updated ${result.relationsUpdated} from ${result.processedTransfers} transfers (${result.duration}ms)`
          );
        }
      } catch (err) {
        console.error('[Build Relations] Job failed:', err);
      }
    });

    console.log('[Scheduler] Build Relations job registered');
  }

  // ========== BUILD BUNDLES JOB (L3 → L4) ==========
  if (env.INDEXER_ENABLED) {
    // Run after build-relations
    const bundlesInterval = env.INDEXER_INTERVAL_MS + 20000; // 20 seconds after indexer
    
    scheduler.register('build-bundles', bundlesInterval, async () => {
      try {
        const result = await buildBundles();
        
        if (result.processedPairs > 0) {
          console.log(
            `[Build Bundles] Created ${result.bundlesCreated} bundles, ` +
            `updated ${result.bundlesUpdated} from ${result.processedPairs} pairs (${result.duration}ms)`
          );
        }
      } catch (err) {
        console.error('[Build Bundles] Job failed:', err);
      }
    });

    console.log('[Scheduler] Build Bundles job registered');
  }

  // ========== BUILD SIGNALS JOB (L4 → L5) ==========
  if (env.INDEXER_ENABLED) {
    // Run after build-bundles
    const signalsInterval = env.INDEXER_INTERVAL_MS + 30000; // 30 seconds after indexer
    
    scheduler.register('build-signals', signalsInterval, async () => {
      try {
        const result = await buildSignals();
        
        if (result.signalsGenerated > 0) {
          console.log(
            `[Build Signals] Generated ${result.signalsGenerated} signals ` +
            `from ${result.processedBundles} bundles (${result.duration}ms)`
          );
        }
      } catch (err) {
        console.error('[Build Signals] Job failed:', err);
      }
    });

    console.log('[Scheduler] Build Signals job registered');
  }

  // ========== BUILD SCORES JOB (L5 → L6) ==========
  if (env.INDEXER_ENABLED) {
    // Run every 90 seconds, after signals
    const scoresInterval = 90000; // 90 seconds
    
    scheduler.register('build-scores', scoresInterval, async () => {
      try {
        const result = await buildScores();
        
        if (result.scoresUpdated > 0) {
          console.log(
            `[Build Scores] Updated ${result.scoresUpdated} scores ` +
            `for ${result.processedAddresses} addresses (${result.duration}ms)`
          );
        }
      } catch (err) {
        console.error('[Build Scores] Job failed:', err);
      }
    });

    console.log('[Scheduler] Build Scores job registered');
  }

  // ========== BUILD STRATEGY PROFILES JOB (L6 → L7) ==========
  if (env.INDEXER_ENABLED) {
    // Run every 5 minutes (strategies are not high-frequency)
    const strategyInterval = 5 * 60 * 1000; // 5 minutes
    
    scheduler.register('build-strategy-profiles', strategyInterval, async () => {
      try {
        const result = await buildStrategyProfiles();
        
        if (result.profilesUpdated > 0) {
          console.log(
            `[Build Strategy Profiles] Updated ${result.profilesUpdated} profiles ` +
            `for ${result.processedAddresses} addresses (${result.duration}ms)`
          );
          if (result.strategyShifts > 0) {
            console.log(`[Build Strategy Profiles] Strategy shifts: ${result.strategyShifts}`);
          }
        }
      } catch (err) {
        console.error('[Build Strategy Profiles] Job failed:', err);
      }
    });

    console.log('[Scheduler] Build Strategy Profiles job registered');
  }

  // ========== BUILD STRATEGY SIGNALS JOB (L7 → L7.1) ==========
  // Run every 90 seconds (after strategy profiles)
  const strategySignalsInterval = 90 * 1000; // 90 seconds
  
  scheduler.register('build-strategy-signals', strategySignalsInterval, async () => {
    try {
      const result = await buildStrategySignals();
      
      if (result.signalsGenerated > 0) {
        console.log(
          `[Build Strategy Signals] Generated ${result.signalsGenerated} signals ` +
          `from ${result.processedProfiles} profiles (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Strategy Signals] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Strategy Signals job registered');

  // ========== DISPATCH FOLLOW EVENTS JOB ==========
  // Run every 45 seconds
  const dispatchInterval = 45 * 1000; // 45 seconds
  
  scheduler.register('dispatch-follow-events', dispatchInterval, async () => {
    try {
      const result = await dispatchFollowEvents();
      
      if (result.eventsDispatched > 0) {
        console.log(
          `[Dispatch Follow Events] Dispatched ${result.eventsDispatched} events ` +
          `from ${result.processedSignals} signals (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Dispatch Follow Events] Job failed:', err);
    }
  });

  console.log('[Scheduler] Dispatch Follow Events job registered');

  // ========== DISPATCH ALERTS JOB (L8) ==========
  // Run every 60 seconds
  const dispatchAlertsInterval = 60 * 1000; // 60 seconds
  
  scheduler.register('dispatch-alerts', dispatchAlertsInterval, async () => {
    try {
      const result = await dispatchAlerts();
      
      if (result.alertsCreated > 0) {
        console.log(
          `[Dispatch Alerts] Created ${result.alertsCreated} alerts ` +
          `from ${result.processedSignals} signals (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Dispatch Alerts] Job failed:', err);
    }
  });

  console.log('[Scheduler] Dispatch Alerts job registered');

  // ========== P0 FIX: EVALUATE ALERT RULES JOB ==========
  // This is the MISSING PIECE - evaluates user-created alert rules against blockchain data
  // Run every 60 seconds (1 minute)
  const evaluateRulesInterval = 60 * 1000; // 60 seconds
  
  scheduler.register('evaluate-alert-rules', evaluateRulesInterval, async () => {
    try {
      const result = await evaluateAlertRules();
      
      if (result.eventsTriggered > 0) {
        console.log(
          `[Evaluate Alert Rules] Evaluated ${result.rulesEvaluated} rules, ` +
          `triggered ${result.eventsTriggered} events (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Evaluate Alert Rules] Job failed:', err);
    }
  });

  console.log('[Scheduler] Evaluate Alert Rules job registered (P0 FIX)');

  // ========== BUILD ACTOR PROFILES JOB (L10) ==========
  // Run every 3 minutes
  const buildActorProfilesInterval = 3 * 60 * 1000; // 3 minutes
  
  scheduler.register('build-actor-profiles', buildActorProfilesInterval, async () => {
    try {
      const result = await buildActorProfiles();
      
      if (result.processedActors > 0) {
        console.log(
          `[Build Actor Profiles] Processed ${result.processedActors} actors ` +
          `(${result.newProfiles} new, ${result.updatedProfiles} updated) (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Actor Profiles] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Actor Profiles job registered');

  // ========== PHASE 11 - DECISION & ACTION LAYER JOBS ==========

  // ========== BUILD DECISIONS JOB (L11.1) ==========
  // Run every 5 minutes
  const buildDecisionsInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('build-decisions', buildDecisionsInterval, async () => {
    try {
      const result = await buildDecisions();
      
      if (result.decisionsCreated > 0) {
        console.log(
          `[Build Decisions] Created ${result.decisionsCreated} decisions ` +
          `from ${result.processedActors} actors (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Decisions] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Decisions job registered');

  // ========== BUILD ACTIONS JOB (L11.2) ==========
  // Run every 3 minutes
  const buildActionsInterval = 3 * 60 * 1000; // 3 minutes
  
  scheduler.register('build-actions', buildActionsInterval, async () => {
    try {
      const result = await buildActions();
      
      if (result.actionsCreated > 0 || result.simulationsStarted > 0) {
        console.log(
          `[Build Actions] Created ${result.actionsCreated} actions, ` +
          `started ${result.simulationsStarted} simulations (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Actions] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Actions job registered');

  // ========== UPDATE TRUST SCORES JOB (L11.5) ==========
  // Run every 10 minutes
  const updateTrustInterval = 10 * 60 * 1000; // 10 minutes
  
  scheduler.register('update-trust-scores', updateTrustInterval, async () => {
    try {
      const result = await updateTrustScores();
      
      if (result.trustScoresUpdated > 0 || result.simulationsUpdated > 0) {
        console.log(
          `[Update Trust] Updated ${result.trustScoresUpdated} trust scores, ` +
          `${result.simulationsUpdated} simulations (${result.simulationsCompleted} completed), ` +
          `${result.expiredActions} expired actions (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Update Trust] Job failed:', err);
    }
  });

  console.log('[Scheduler] Update Trust Scores job registered');

  // ========== PHASE 12A - ADAPTIVE INTELLIGENCE JOBS ==========

  // ========== UPDATE ADAPTIVE WEIGHTS JOB (L12A.1 + L12A.2) ==========
  // Run every 10 minutes
  const updateAdaptiveWeightsInterval = 10 * 60 * 1000; // 10 minutes
  
  scheduler.register('update-adaptive-weights', updateAdaptiveWeightsInterval, async () => {
    try {
      const result = await updateAdaptiveWeights();
      
      if (result.processedFeedback > 0 || result.weightsAdjusted > 0) {
        console.log(
          `[Update Adaptive Weights] Processed ${result.processedFeedback} feedback, ` +
          `adjusted ${result.weightsAdjusted} weights, ` +
          `${result.boundaryHits} boundary hits (${result.duration}ms)`
        );
      }
      
      // Log warnings
      for (const warning of result.warnings) {
        console.log(`[Update Adaptive Weights] WARNING: ${warning}`);
      }
    } catch (err) {
      console.error('[Update Adaptive Weights] Job failed:', err);
    }
  });

  console.log('[Scheduler] Update Adaptive Weights job registered');

  // ========== RECALIBRATE CONFIDENCE JOB (L12A.3) ==========
  // Run every 30 minutes
  const recalibrateConfidenceInterval = 30 * 60 * 1000; // 30 minutes
  
  scheduler.register('recalibrate-confidence', recalibrateConfidenceInterval, async () => {
    try {
      const result = await recalibrateConfidence();
      
      if (result.simulationsProcessed > 0 || result.calibrationsUpdated > 0) {
        console.log(
          `[Recalibrate Confidence] Processed ${result.simulationsProcessed} simulations, ` +
          `updated ${result.calibrationsUpdated} calibrations, ` +
          `${result.poorlyCalibrated} poorly calibrated (${result.duration}ms)`
        );
      }
      
      // Log warnings
      for (const warning of result.warnings) {
        console.log(`[Recalibrate Confidence] WARNING: ${warning}`);
      }
    } catch (err) {
      console.error('[Recalibrate Confidence] Job failed:', err);
    }
  });

  console.log('[Scheduler] Recalibrate Confidence job registered');

  // ========== UPDATE STRATEGY RELIABILITY JOB (L12A.4) ==========
  // Run every 60 minutes
  const updateStrategyReliabilityInterval = 60 * 60 * 1000; // 60 minutes
  
  scheduler.register('update-strategy-reliability', updateStrategyReliabilityInterval, async () => {
    try {
      const result = await updateStrategyReliability();
      
      if (result.simulationsProcessed > 0 || result.strategiesUpdated > 0) {
        console.log(
          `[Update Strategy Reliability] Processed ${result.simulationsProcessed} simulations, ` +
          `updated ${result.strategiesUpdated} strategies, ` +
          `${result.copyRecommended} copy-recommended, ` +
          `${result.strategiesWithWarnings} with warnings (${result.duration}ms)`
        );
      }
      
      // Log warnings
      for (const warning of result.warnings) {
        console.log(`[Update Strategy Reliability] WARNING: ${warning}`);
      }
    } catch (err) {
      console.error('[Update Strategy Reliability] Job failed:', err);
    }
  });

  console.log('[Scheduler] Update Strategy Reliability job registered');

  // ========== PHASE 12B - PERSONALIZED INTELLIGENCE JOBS ==========

  // ========== UPDATE USER BIAS JOB (L12B.1) ==========
  // Run every 15 minutes
  const updateUserBiasInterval = 15 * 60 * 1000; // 15 minutes
  
  scheduler.register('update-user-bias', updateUserBiasInterval, async () => {
    try {
      const result = await updateUserBias();
      
      if (result.outcomesProcessed > 0) {
        console.log(
          `[Update User Bias] Processed ${result.outcomesProcessed} outcomes, ` +
          `${result.biasUpdates} bias updates (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Update User Bias] Job failed:', err);
    }
  });

  console.log('[Scheduler] Update User Bias job registered');

  // ========== RECOMPUTE PERSONALIZED SCORES JOB (L12B.2) ==========
  // Run every 5 minutes
  const recomputeScoresInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('recompute-personalized-scores', recomputeScoresInterval, async () => {
    try {
      const result = await recomputePersonalizedScores();
      
      if (result.usersProcessed > 0) {
        console.log(
          `[Recompute Scores] Processed ${result.usersProcessed} users, ` +
          `${result.scoresRecomputed} scores (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Recompute Personalized Scores] Job failed:', err);
    }
  });

  console.log('[Scheduler] Recompute Personalized Scores job registered');

  // ========== PHASE 12C - LEARNING CONTROL JOBS ==========

  // ========== CHECK LEARNING HEALTH JOB (L12C.1) ==========
  // Run every 5 minutes
  const checkHealthInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('check-learning-health', checkHealthInterval, async () => {
    try {
      const result = await checkLearningHealth();
      
      console.log(
        `[Learning Health] Health: ${(result.healthScore * 100).toFixed(0)}%, ` +
        `drift: ${result.maxDrift.toFixed(3)}, frozen: ${result.frozenWeights}, ` +
        `LR: ${result.effectiveLearningRate.toFixed(4)} (${result.duration}ms)`
      );
      
      // Log warnings
      for (const warning of result.warnings) {
        console.log(`[Learning Health] WARNING: ${warning}`);
      }
    } catch (err) {
      console.error('[Check Learning Health] Job failed:', err);
    }
  });

  console.log('[Scheduler] Check Learning Health job registered');

  // ========== PHASE 13 - AUTOMATION JOBS ==========

  // ========== DISPATCH ACTIONS JOB (L13.2) ==========
  // Run every 30-60 seconds
  const dispatchActionsInterval = 45 * 1000; // 45 seconds
  
  scheduler.register('dispatch-actions', dispatchActionsInterval, async () => {
    try {
      const result = await dispatchActions();
      
      if (result.actionsProcessed > 0) {
        console.log(
          `[Dispatch Actions] Processed ${result.actionsProcessed} actions, ` +
          `${result.actionsExecuted} executed, ${result.actionsFailed} failed, ` +
          `${result.actionsExpired} expired (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Dispatch Actions] Job failed:', err);
    }
  });

  console.log('[Scheduler] Dispatch Actions job registered');

  // ========== BUILD ACTION SUGGESTIONS JOB (L13.2) ==========
  // Run every 60-90 seconds
  const buildSuggestionsInterval = 75 * 1000; // 75 seconds
  
  scheduler.register('build-action-suggestions', buildSuggestionsInterval, async () => {
    try {
      const result = await buildActionSuggestions();
      
      if (result.suggestionsCreated > 0) {
        console.log(
          `[Build Suggestions] Processed ${result.signalsProcessed} signals, ` +
          `created ${result.suggestionsCreated} suggestions (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Action Suggestions] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Action Suggestions job registered');

  // ========== SIMULATE COPY JOB (L13.3) ==========
  // Run every 2-5 minutes
  const simulateCopyInterval = 3 * 60 * 1000; // 3 minutes
  
  scheduler.register('simulate-copy', simulateCopyInterval, async () => {
    try {
      const result = await simulateCopy();
      
      if (result.portfoliosProcessed > 0 || result.positionsOpened > 0 || result.positionsClosed > 0) {
        console.log(
          `[Simulate Copy] Processed ${result.portfoliosProcessed} portfolios, ` +
          `${result.positionsOpened} opened, ${result.positionsClosed} closed (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Simulate Copy] Job failed:', err);
    }
  });

  console.log('[Scheduler] Simulate Copy job registered');

  // ========== PHASE 14A - MARKET REALITY LAYER JOBS ==========

  // ========== BUILD PRICE POINTS JOB (L14A.1) ==========
  // Run every 60 seconds (fetch on-chain prices)
  if (env.INFURA_RPC_URL) {
    const buildPricesInterval = 60 * 1000; // 60 seconds
    
    scheduler.register('build-price-points', buildPricesInterval, async () => {
      try {
        const result = await buildPricePoints();
        
        if (result.pricesStored > 0) {
          console.log(
            `[Build Prices] Processed ${result.pairsProcessed} pairs, ` +
            `stored ${result.pricesStored} prices, WETH=$${result.wethPriceUsd.toFixed(2)} (${result.duration}ms)`
          );
        }
        
        if (result.errors > 0) {
          console.log(`[Build Prices] ${result.errors} errors occurred`);
        }
      } catch (err) {
        console.error('[Build Prices] Job failed:', err);
      }
    });

    console.log('[Scheduler] Build Price Points job registered');
  } else {
    console.log('[Scheduler] Build Price Points disabled (no INFURA_RPC_URL)');
  }

  // ========== BUILD MARKET METRICS JOB (L14A.2) ==========
  // Run every 5 minutes (calculate volatility, trend, drawdown)
  const buildMetricsInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('build-market-metrics', buildMetricsInterval, async () => {
    try {
      const result = await buildMarketMetrics();
      
      if (result.metricsCalculated > 0) {
        console.log(
          `[Build Metrics] Processed ${result.assetsProcessed} assets, ` +
          `calculated ${result.metricsCalculated} metrics (${result.duration}ms)`
        );
      }
      
      if (result.errors > 0) {
        console.log(`[Build Metrics] ${result.errors} errors occurred`);
      }
    } catch (err) {
      console.error('[Build Metrics] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Market Metrics job registered');

  // ========== PHASE 14B - SIGNAL REACTIONS JOBS ==========

  // ========== BUILD SIGNAL REACTIONS JOB (L14B.2) ==========
  // Run every 3-5 minutes (validate signals against market)
  const buildReactionsInterval = 3 * 60 * 1000; // 3 minutes
  
  scheduler.register('build-signal-reactions', buildReactionsInterval, async () => {
    try {
      const result = await buildSignalReactions();
      
      if (result.reactionsComputed > 0 || result.confidenceUpdates > 0) {
        console.log(
          `[Build Reactions] Processed ${result.signalsProcessed} signals, ` +
          `computed ${result.reactionsComputed} reactions, ` +
          `${result.confidenceUpdates} confidence updates (${result.duration}ms)`
        );
      }
      
      if (result.errors > 0) {
        console.log(`[Build Reactions] ${result.errors} errors occurred`);
      }
    } catch (err) {
      console.error('[Build Reactions] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Signal Reactions job registered');

  // ========== PHASE 14C - MARKET REGIMES JOBS ==========

  // ========== BUILD MARKET REGIMES JOB (L14C.2) ==========
  // Run every 5 minutes (detect regime changes)
  const buildRegimesInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('build-market-regimes', buildRegimesInterval, async () => {
    try {
      const result = await buildMarketRegimes();
      
      if (result.regimesDetected > 0) {
        console.log(
          `[Build Regimes] Processed ${result.assetsProcessed} assets, ` +
          `detected ${result.regimesDetected} regimes, ` +
          `${result.regimeChanges} changes (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Regimes] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Market Regimes job registered');

  // ========== PHASE 15 - TRUST, REPUTATION & PUBLIC CONFIDENCE JOBS ==========

  // ========== BUILD SIGNAL REPUTATION JOB (L15.1) ==========
  // Run every 10 minutes
  const signalReputationInterval = 10 * 60 * 1000; // 10 minutes
  
  scheduler.register('build-signal-reputation', signalReputationInterval, async () => {
    try {
      const result = await buildSignalReputation();
      
      if (result.processed > 0) {
        console.log(
          `[Build Signal Reputation] Processed ${result.processed} signals, ` +
          `${result.errors} errors (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Signal Reputation] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Signal Reputation job registered');

  // ========== BUILD STRATEGY REPUTATION JOB (L15.2) ==========
  // Run every 15 minutes
  const strategyReputationInterval = 15 * 60 * 1000; // 15 minutes
  
  scheduler.register('build-strategy-reputation', strategyReputationInterval, async () => {
    try {
      const result = await buildStrategyReputation();
      
      if (result.processed > 0) {
        console.log(
          `[Build Strategy Reputation] Processed ${result.processed} strategies, ` +
          `${result.errors} errors (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Strategy Reputation] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Strategy Reputation job registered');

  // ========== BUILD ACTOR REPUTATION JOB (L15.3) ==========
  // Run every 20 minutes
  const actorReputationInterval = 20 * 60 * 1000; // 20 minutes
  
  scheduler.register('build-actor-reputation', actorReputationInterval, async () => {
    try {
      const result = await buildActorReputation();
      
      if (result.processed > 0) {
        console.log(
          `[Build Actor Reputation] Processed ${result.processed} actors, ` +
          `${result.errors} errors (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Actor Reputation] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Actor Reputation job registered');

  // ========== BUILD TRUST SNAPSHOTS JOB (L15.4) ==========
  // Run every 5 minutes
  const trustSnapshotsInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('build-trust-snapshots', trustSnapshotsInterval, async () => {
    try {
      const result = await buildTrustSnapshots();
      
      if (result.signals > 0 || result.strategies > 0 || result.actors > 0) {
        console.log(
          `[Build Trust Snapshots] Signals: ${result.signals}, ` +
          `Strategies: ${result.strategies}, Actors: ${result.actors}, ` +
          `${result.errors} errors (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Build Trust Snapshots] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Trust Snapshots job registered');

  // ========== P0 MEMORY OPTIMIZATION - ACTORS GRAPH CACHE ==========
  // Pre-computes actor graphs in background and stores in MongoDB
  // Run every 5 minutes (cache expires in 10 minutes for overlap)
  const buildActorsGraphInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('build-actors-graph', buildActorsGraphInterval, async () => {
    try {
      const result = await buildActorsGraphJob();
      
      if (result.windowsBuilt > 0) {
        console.log(
          `[Build Actors Graph] Built ${result.windowsBuilt} windows (${result.duration}ms)`
        );
      }
      
      if (result.errors.length > 0) {
        console.log(`[Build Actors Graph] Errors: ${result.errors.join(', ')}`);
      }
    } catch (err) {
      console.error('[Build Actors Graph] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Actors Graph job registered (P0 Memory Optimization)');

  // ========== SPRINT 3 - ACTOR SIGNALS V2 ==========
  // Detects deviations from actor baselines
  // Run every 10 minutes
  const buildActorSignalsInterval = 10 * 60 * 1000; // 10 minutes
  
  scheduler.register('build-actor-signals', buildActorSignalsInterval, async () => {
    try {
      const result = await buildActorSignals();
      
      if (result.signalsGenerated > 0 || result.baselinesUpdated > 0) {
        console.log(
          `[Build Actor Signals] Baselines: ${result.baselinesUpdated}, ` +
          `Signals: ${result.signalsGenerated}, Expired: ${result.expiredCleaned} (${result.duration}ms)`
        );
      }
      
      if (result.errors.length > 0) {
        console.log(`[Build Actor Signals] Errors: ${result.errors.join(', ')}`);
      }
    } catch (err) {
      console.error('[Build Actor Signals] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Actor Signals job registered (Sprint 3 - Signals v2)');

  // ========== SPRINT 3 - SIGNAL CONTEXT AGGREGATION ==========
  // Aggregates isolated signals into contextual situations
  // Run every 15 minutes
  const buildSignalContextsInterval = 15 * 60 * 1000; // 15 minutes
  
  scheduler.register('build-signal-contexts', buildSignalContextsInterval, async () => {
    try {
      const result = await buildSignalContexts();
      
      if (result.contextsCreated > 0 || result.expiredCleaned > 0) {
        console.log(
          `[Build Signal Contexts] Created: ${result.contextsCreated}, ` +
          `Cleaned: ${result.expiredCleaned} (${result.duration}ms)`
        );
      }
      
      if (result.errors.length > 0) {
        console.log(`[Build Signal Contexts] Errors: ${result.errors.join(', ')}`);
      }
    } catch (err) {
      console.error('[Build Signal Contexts] Job failed:', err);
    }
  });

  console.log('[Scheduler] Build Signal Contexts job registered (Sprint 3 - Context Layer)');

  // ========== SIGNAL REWEIGHTING V1.1 ==========
  // Adaptive calibration of signal weights based on outcomes
  // Run every 6 hours
  const signalReweightingInterval = 6 * 60 * 60 * 1000; // 6 hours
  
  scheduler.register('signal-reweighting', signalReweightingInterval, async () => {
    try {
      const result = await runSignalReweighting();
      
      if (result.adjustments > 0 || result.errors > 0) {
        console.log(
          `[Signal Reweighting] Processed: ${result.processed} outcomes, ` +
          `Adjustments: ${result.adjustments}, Errors: ${result.errors} (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Signal Reweighting] Job failed:', err);
    }
  });

  console.log('[Scheduler] Signal Reweighting job registered (v1.1 - Adaptive Calibration)');

  // ========== ETAP 5.1 - SELF-LEARNING RETRAIN ==========
  // Attempts model retraining if guards pass
  // Run every 6 hours (configurable via config)
  const selfLearningInterval = 6 * 60 * 60 * 1000; // 6 hours
  
  scheduler.register('self-learning-retrain', selfLearningInterval, async () => {
    try {
      const result = await runSelfLearningJob();
      
      if (result.executed) {
        console.log(
          `[Self-Learning Retrain] Job executed: ` +
          `7d=${result.results['7d']?.success ? 'OK' : 'BLOCKED'}, ` +
          `30d=${result.results['30d']?.success ? 'OK' : 'BLOCKED'} ` +
          `(${result.duration}ms)`
        );
      } else {
        console.log(`[Self-Learning Retrain] Skipped: ${result.reason}`);
      }
    } catch (err) {
      console.error('[Self-Learning Retrain] Job failed:', err);
    }
  });

  console.log('[Scheduler] Self-Learning Retrain job registered (ETAP 5.1 - Guards + Dataset Freeze)');

  // ========== ETAP 6.1 - RAW DATA INGEST ==========

  // Ingest 24h - Every 5 minutes
  if (ethereumRpc) {
    const ingest24hInterval = 5 * 60 * 1000; // 5 minutes
    
    scheduler.register('ingest-24h', ingest24hInterval, async () => {
      if (!ethereumRpc) return;
      try {
        const result = await runIngestJob(ethereumRpc, '24h');
        
        if (result.inserted > 0) {
          console.log(
            `[Ingest 24h] Inserted ${result.inserted}, skipped ${result.skippedDuplicates} (${result.duration}ms)`
          );
        }
        
        if (result.errors > 0) {
          console.log(`[Ingest 24h] ${result.errors} errors: ${result.message}`);
        }
      } catch (err) {
        console.error('[Ingest 24h] Job failed:', err);
      }
    });

    console.log('[Scheduler] Ingest 24h job registered (ETAP 6.1)');

    // Ingest 7d - Every 15 minutes
    const ingest7dInterval = 15 * 60 * 1000; // 15 minutes
    
    scheduler.register('ingest-7d', ingest7dInterval, async () => {
      if (!ethereumRpc) return;
      try {
        const result = await runIngestJob(ethereumRpc, '7d');
        
        if (result.inserted > 0) {
          console.log(
            `[Ingest 7d] Inserted ${result.inserted}, skipped ${result.skippedDuplicates} (${result.duration}ms)`
          );
        }
      } catch (err) {
        console.error('[Ingest 7d] Job failed:', err);
      }
    });

    console.log('[Scheduler] Ingest 7d job registered (ETAP 6.1)');

    // Ingest 30d - Every hour
    const ingest30dInterval = 60 * 60 * 1000; // 1 hour
    
    scheduler.register('ingest-30d', ingest30dInterval, async () => {
      if (!ethereumRpc) return;
      try {
        const result = await runIngestJob(ethereumRpc, '30d');
        
        if (result.inserted > 0) {
          console.log(
            `[Ingest 30d] Inserted ${result.inserted}, skipped ${result.skippedDuplicates} (${result.duration}ms)`
          );
        }
      } catch (err) {
        console.error('[Ingest 30d] Job failed:', err);
      }
    });

    console.log('[Scheduler] Ingest 30d job registered (ETAP 6.1)');
  }

  // ========== ETAP 6.2/6.3 - AGGREGATION & SNAPSHOT JOBS ==========

  // Aggregation + Snapshot 24h - Every 5 minutes (after ingest completes)
  const agg24hInterval = 5 * 60 * 1000 + 30000; // 5 min + 30s offset
  
  scheduler.register('aggregation-24h', agg24hInterval, async () => {
    try {
      const result = await runAggregationAndSnapshotJob('24h');
      
      if (result.executed) {
        console.log(
          `[Aggregation 24h] Flows=${result.actorFlowsUpdated}, Activity=${result.actorActivitiesUpdated}, Bridges=${result.bridgesUpdated}, Snapshot=${result.snapshotCreated} (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Aggregation 24h] Job failed:', err);
    }
  });

  console.log('[Scheduler] Aggregation 24h job registered (ETAP 6.2/6.3)');

  // Aggregation + Snapshot 7d - Every 15 minutes
  const agg7dInterval = 15 * 60 * 1000 + 30000; // 15 min + 30s offset
  
  scheduler.register('aggregation-7d', agg7dInterval, async () => {
    try {
      const result = await runAggregationAndSnapshotJob('7d');
      
      if (result.executed) {
        console.log(
          `[Aggregation 7d] Flows=${result.actorFlowsUpdated}, Activity=${result.actorActivitiesUpdated}, Bridges=${result.bridgesUpdated}, Snapshot=${result.snapshotCreated} (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Aggregation 7d] Job failed:', err);
    }
  });

  console.log('[Scheduler] Aggregation 7d job registered (ETAP 6.2/6.3)');

  // Aggregation + Snapshot 30d - Every hour
  const agg30dInterval = 60 * 60 * 1000 + 60000; // 1 hour + 1min offset
  
  scheduler.register('aggregation-30d', agg30dInterval, async () => {
    try {
      const result = await runAggregationAndSnapshotJob('30d');
      
      if (result.executed) {
        console.log(
          `[Aggregation 30d] Flows=${result.actorFlowsUpdated}, Activity=${result.actorActivitiesUpdated}, Bridges=${result.bridgesUpdated}, Snapshot=${result.snapshotCreated} (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Aggregation 30d] Job failed:', err);
    }
  });

  console.log('[Scheduler] Aggregation 30d job registered (ETAP 6.2/6.3)');

  // ========== BLOCK 2.1 - BRIDGE SCAN CRON ==========
  const bridgeScanInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('bridge-scan', bridgeScanInterval, async () => {
    try {
      const result = await runBridgeScan();
      
      if (result.detected > 0 || result.actorEvents > 0) {
        console.log(
          `[Bridge Scan] Detected ${result.detected} migrations, ` +
          `${result.actorEvents} actor events (${result.duration}ms)`
        );
      }
    } catch (err) {
      console.error('[Bridge Scan] Job failed:', err);
    }
  });

  console.log('[Scheduler] Bridge Scan job registered (BLOCK 2.1 - Every 5 minutes)');

  // ========== ETAP D2 - NODE ANALYTICS JOB ==========
  // Pre-calculates influence scores for all nodes
  // Run every 15 minutes
  const nodeAnalyticsInterval = 15 * 60 * 1000; // 15 minutes
  
  scheduler.register('node-analytics', nodeAnalyticsInterval, async () => {
    try {
      const result = await runNodeAnalyticsJob();
      
      if (result.executed) {
        const totalProcessed = Object.values(result.results).reduce((sum, r) => sum + r.processed, 0);
        const totalErrors = Object.values(result.results).reduce((sum, r) => sum + r.errors, 0);
        
        console.log(
          `[Node Analytics] Processed ${totalProcessed} nodes across ${Object.keys(result.results).length} networks, ` +
          `${totalErrors} errors (${result.duration}ms)`
        );
      }
      
      if (result.errors.length > 0) {
        console.log(`[Node Analytics] Errors: ${result.errors.join(', ')}`);
      }
    } catch (err) {
      console.error('[Node Analytics] Job failed:', err);
    }
  });

  console.log('[Scheduler] Node Analytics job registered (ETAP D2 - Every 15 minutes)');

  // ========== ML v2.1 STEP 2 - ACCURACY & DRIFT JOBS ==========

  // ML Accuracy Snapshot Job - Every 6 hours
  const accuracySnapshotInterval = 6 * 60 * 60 * 1000; // 6 hours
  
  scheduler.register('ml-accuracy-snapshot', accuracySnapshotInterval, async () => {
    try {
      const result = await runAccuracySnapshotJob();
      
      if (result.computed > 0) {
        console.log(
          `[ML Accuracy Snapshot] Computed ${result.computed} snapshots (${result.duration}ms)`
        );
      }
      
      if (result.errors.length > 0) {
        console.log(`[ML Accuracy Snapshot] Errors: ${result.errors.join(', ')}`);
      }
    } catch (err) {
      console.error('[ML Accuracy Snapshot] Job failed:', err);
    }
  });

  console.log('[Scheduler] ML Accuracy Snapshot job registered (ML v2.1 STEP 2 - Every 6 hours)');

  // ML Drift Detection Job - Every 12 hours
  const driftDetectionInterval = 12 * 60 * 60 * 1000; // 12 hours
  
  scheduler.register('ml-drift-detection', driftDetectionInterval, async () => {
    try {
      const result = await runDriftDetectionJob();
      
      if (result.checked > 0) {
        console.log(
          `[ML Drift Detection] Checked ${result.checked} networks, found ${result.drifts} drifts (${result.duration}ms)`
        );
      }
      
      if (result.errors.length > 0) {
        console.log(`[ML Drift Detection] Errors: ${result.errors.join(', ')}`);
      }
    } catch (err) {
      console.error('[ML Drift Detection] Job failed:', err);
    }
  });

  console.log('[Scheduler] ML Drift Detection job registered (ML v2.1 STEP 2 - Every 12 hours)');

  // ========== V3.0 PACK A - FEATURE BUILDER JOBS ==========

  // V3 Feature Builder Job - Every 5 minutes
  // Runs market features (CEX + Zones) every 5 min, corridor features every hour
  const v3FeatureInterval = 5 * 60 * 1000; // 5 minutes
  
  scheduler.register('v3-feature-builder', v3FeatureInterval, async () => {
    try {
      const result = await runV3FeatureBuilderJob();
      
      if (result.market.spikes > 0) {
        console.log(
          `[V3 Features] ⚠️ ${result.market.spikes} CEX spikes detected across ${result.market.networks} networks!`
        );
      }
      
      if (result.corridor) {
        console.log(
          `[V3 Features] Corridor features: ${result.corridor.corridors} corridors across ${result.corridor.networks} networks`
        );
      }
    } catch (err) {
      console.error('[V3 Features] Job failed:', err);
    }
  });

  console.log('[Scheduler] V3 Feature Builder job registered (Pack A - Every 5 minutes)');

  // ========== FUTURE JOBS ==========

  // scheduler.register('cleanup-old-transfers', 3600_000, async () => {
  //   // await transfersService.cleanupOld();
  // });

  console.log('[Scheduler] Default jobs registered');
}

/**
 * Get indexer status (for API)
 */
export async function getIndexerStatus(): Promise<{
  enabled: boolean;
  rpcUrl: string | null;
  syncStatus: {
    syncedBlock: number;
    latestBlock: number;
    blocksBehind: number;
    totalLogs: number;
  } | null;
  buildStatus: {
    lastProcessedBlock: number;
    pendingLogs: number;
    totalTransfers: number;
  } | null;
  relationsStatus: {
    unprocessedTransfers: number;
    totalRelations: number;
    byWindow: Record<string, number>;
  } | null;
  bundlesStatus: {
    totalBundles: number;
    byType: Record<string, number>;
    byWindow: Record<string, number>;
  } | null;
  signalsStatus: {
    totalSignals: number;
    last24h: number;
    unacknowledged: number;
    byType: Record<string, number>;
  } | null;
  scoresStatus: {
    totalScores: number;
    byTier: Record<string, number>;
    avgComposite: number;
    lastCalculated: string | null;
  } | null;
  strategyProfilesStatus: {
    totalProfiles: number;
    byStrategy: Record<string, number>;
    avgConfidence: number;
    avgStability: number;
  } | null;
  decisionsStatus: {
    totalDecisions: number;
    activeDecisions: number;
    byType: Record<string, number>;
  } | null;
  actionsStatus: {
    totalActions: number;
    suggestedActions: number;
    acceptedActions: number;
    activeSimulations: number;
  } | null;
  trustStatus: {
    totalTrustRecords: number;
    byLevel: Record<string, number>;
    avgTrustScore: number;
    activeSimulations: number;
  } | null;
  // Phase 12A - Adaptive Intelligence
  adaptiveWeightsStatus: {
    totalWeights: number;
    avgDrift: number;
    weightsAtBoundary: number;
    lastProcessedAt: Date | null;
  } | null;
  confidenceCalibrationStatus: {
    totalCalibrations: number;
    avgCalibrationFactor: number;
    poorlyCalibratedCount: number;
    lastProcessedAt: Date | null;
  } | null;
  strategyReliabilityStatus: {
    totalStrategies: number;
    copyRecommendedCount: number;
    strategiesWithWarnings: number;
    lastProcessedAt: Date | null;
  } | null;
}> {
  if (!ethereumRpc || !env.INDEXER_ENABLED) {
    return {
      enabled: false,
      rpcUrl: null,
      syncStatus: null,
      buildStatus: null,
      relationsStatus: null,
      bundlesStatus: null,
      signalsStatus: null,
      scoresStatus: null,
      strategyProfilesStatus: null,
      decisionsStatus: null,
      actionsStatus: null,
      trustStatus: null,
      adaptiveWeightsStatus: null,
      confidenceCalibrationStatus: null,
      strategyReliabilityStatus: null,
    };
  }

  try {
    const [
      syncStatus, 
      buildStatus, 
      relationsStatus, 
      bundlesStatus, 
      signalsStatus, 
      scoresStatus, 
      strategyProfilesStatus,
      decisionsStatus,
      actionsStatus,
      trustStatus,
      adaptiveWeightsStatus,
      confidenceCalibrationStatus,
      strategyReliabilityStatus,
    ] = await Promise.all([
      getSyncStatus(ethereumRpc),
      getBuildStatus(),
      getBuildRelationsStatus(),
      getBuildBundlesStatus(),
      getBuildSignalsStatus(),
      getBuildScoresStatus(),
      getBuildStrategyProfilesStatus(),
      getBuildDecisionsStatus(),
      getBuildActionsStatus(),
      getUpdateTrustStatus(),
      getUpdateAdaptiveWeightsStatus(),
      getRecalibrateConfidenceStatus(),
      getUpdateStrategyReliabilityStatus(),
    ]);

    return {
      enabled: true,
      rpcUrl: env.INFURA_RPC_URL ? '[configured]' : null,
      syncStatus,
      buildStatus,
      relationsStatus,
      bundlesStatus,
      signalsStatus,
      scoresStatus,
      strategyProfilesStatus,
      decisionsStatus,
      actionsStatus,
      trustStatus,
      adaptiveWeightsStatus,
      confidenceCalibrationStatus,
      strategyReliabilityStatus,
    };
  } catch (err) {
    console.error('[Scheduler] Failed to get indexer status:', err);
    return {
      enabled: true,
      rpcUrl: env.INFURA_RPC_URL ? '[configured]' : null,
      syncStatus: null,
      buildStatus: null,
      relationsStatus: null,
      bundlesStatus: null,
      signalsStatus: null,
      scoresStatus: null,
      strategyProfilesStatus: null,
      decisionsStatus: null,
      actionsStatus: null,
      trustStatus: null,
      adaptiveWeightsStatus: null,
      confidenceCalibrationStatus: null,
      strategyReliabilityStatus: null,
    };
  }
}
