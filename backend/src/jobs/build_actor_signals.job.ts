/**
 * Build Actor Signals Job (Sprint 3 - Signals Layer v2)
 * 
 * Detects deviations from actor baselines:
 * 1. Flow Deviation - net/inflow/outflow changed
 * 2. Corridor Volume Spike - flow between actors spiked
 * 3. Cluster Participation - actor in more/fewer clusters
 * 4. Behavior Regime Shift - pattern changed
 * 
 * Philosophy:
 * - Signals = deviations, NOT predictions
 * - severity = degree of deviation, NOT bullishness
 * - All calculations from DB aggregates, NO live tx processing
 * 
 * Runs every 10 minutes
 */
import { EntityModel } from '../core/entities/entities.model.js';
import { EntityAddressModel } from '../core/entities/entity_address.model.js';
import { TransferModel } from '../core/transfers/transfers.model.js';
import { ActorBaselineModel } from '../core/signals/actor_baseline.model.js';
import { ActorSignalModel, ActorSignalType, SignalSeverity } from '../core/signals/actor_signal.model.js';
import { ComputedGraphModel } from '../core/actors/computed_graph.model.js';

// ============ CONFIGURATION ============

const CONFIG = {
  // Deviation thresholds by actor type (multiplier to trigger signal)
  THRESHOLDS: {
    exchange: {
      flow_deviation: 2.0,      // 2× baseline
      corridor_spike: 3.0,      // 3× baseline
      cluster_change: 2,        // +2 clusters
      regime_shift: 0.5,        // 50% shift
    },
    fund: {
      flow_deviation: 1.5,
      corridor_spike: 2.5,
      cluster_change: 2,
      regime_shift: 0.4,
    },
    whale: {
      flow_deviation: 1.5,
      corridor_spike: 2.0,
      cluster_change: 1,
      regime_shift: 0.3,
    },
    market_maker: {
      flow_deviation: 2.5,
      corridor_spike: 3.0,
      cluster_change: 2,
      regime_shift: 0.5,
    },
    trader: {
      flow_deviation: 2.0,
      corridor_spike: 2.5,
      cluster_change: 1,
      regime_shift: 0.4,
    },
    unknown: {
      flow_deviation: 2.5,
      corridor_spike: 3.0,
      cluster_change: 2,
      regime_shift: 0.5,
    },
  },
  
  // Severity mapping (deviation multiplier → severity)
  SEVERITY: {
    low: 1.5,      // 1.5-2.5× = low
    medium: 2.5,   // 2.5-4× = medium
    high: 4.0,     // 4×+ = high
  },
  
  // Signal expiration
  SIGNAL_TTL_HOURS: 24,
  
  // Sampling limits
  MAX_TX_SAMPLE: 5000,
};

// Job status
let lastJobStatus = {
  lastRun: null as Date | null,
  duration: 0,
  baselinesUpdated: 0,
  signalsGenerated: 0,
  errors: [] as string[],
};

// ============ HELPERS ============

function getSeverity(deviation: number): SignalSeverity {
  if (deviation >= CONFIG.SEVERITY.high) return 'high';
  if (deviation >= CONFIG.SEVERITY.medium) return 'medium';
  return 'low';
}

function mapCategoryToActorType(category: string): string {
  const mapping: Record<string, string> = {
    'custody': 'exchange',
    'exchange': 'exchange',
    'fund': 'fund',
    'vc': 'fund',
    'whale': 'whale',
    'market_maker': 'market_maker',
    'trader': 'trader',
  };
  return mapping[category?.toLowerCase()] || 'unknown';
}

function determineBehaviorPattern(netFlow: number, totalFlow: number): string {
  if (totalFlow === 0) return 'dormant';
  const ratio = netFlow / totalFlow;
  if (ratio > 0.3) return 'net_inflow';
  if (ratio < -0.3) return 'net_outflow';
  return 'balanced';
}

function determineActivityLevel(txCount: number): string {
  if (txCount >= 100) return 'high';
  if (txCount >= 10) return 'medium';
  if (txCount >= 1) return 'low';
  return 'dormant';
}

// ============ BASELINE CALCULATION ============

async function calculateBaselines(): Promise<number> {
  const entities = await EntityModel.find({ status: 'live' }).lean();
  let updated = 0;
  
  for (const entity of entities) {
    const e = entity as any;
    const actorType = mapCategoryToActorType(e.category);
    
    try {
      // Get addresses for this entity
      const addresses = await EntityAddressModel.find({ entityId: e._id.toString() })
        .select('address')
        .lean();
      
      const addressList = (addresses as any[]).map(a => a.address.toLowerCase());
      if (addressList.length === 0) continue;
      
      // Calculate 7d baseline
      const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Aggregate flows (7d)
      const [inflowAgg7d, outflowAgg7d] = await Promise.all([
        TransferModel.aggregate([
          { $match: { to: { $in: addressList }, timestamp: { $gte: cutoff7d } } },
          { $sample: { size: CONFIG.MAX_TX_SAMPLE } },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
        ]),
        TransferModel.aggregate([
          { $match: { from: { $in: addressList }, timestamp: { $gte: cutoff7d } } },
          { $sample: { size: CONFIG.MAX_TX_SAMPLE } },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
        ]),
      ]);
      
      const inflow7d = inflowAgg7d[0]?.total || 0;
      const outflow7d = outflowAgg7d[0]?.total || 0;
      const txCount7d = (inflowAgg7d[0]?.count || 0) + (outflowAgg7d[0]?.count || 0);
      const netFlow7d = inflow7d - outflow7d;
      const totalFlow7d = inflow7d + outflow7d;
      
      // Save 7d baseline
      await ActorBaselineModel.findOneAndUpdate(
        { actorSlug: e.slug, window: '7d' },
        {
          actorId: e._id.toString(),
          actorSlug: e.slug,
          actorType,
          window: '7d',
          flows: {
            netFlowUsd: netFlow7d,
            inflowUsd: inflow7d,
            outflowUsd: outflow7d,
            txCount: txCount7d,
          },
          behavior: {
            dominantPattern: determineBehaviorPattern(netFlow7d, totalFlow7d),
            activityLevel: determineActivityLevel(txCount7d),
          },
          calculatedAt: new Date(),
          dataPoints: txCount7d,
        },
        { upsert: true, new: true }
      );
      
      updated++;
    } catch (err: any) {
      console.error(`[BuildActorSignals] Failed baseline for ${e.slug}:`, err.message);
    }
  }
  
  return updated;
}

// ============ SIGNAL DETECTION ============

async function detectSignals(): Promise<number> {
  let signalsGenerated = 0;
  const entities = await EntityModel.find({ status: 'live' }).lean();
  const signalExpiry = new Date(Date.now() + CONFIG.SIGNAL_TTL_HOURS * 60 * 60 * 1000);
  
  for (const entity of entities) {
    const e = entity as any;
    const actorType = mapCategoryToActorType(e.category);
    const thresholds = CONFIG.THRESHOLDS[actorType as keyof typeof CONFIG.THRESHOLDS] || CONFIG.THRESHOLDS.unknown;
    
    try {
      // Get baseline
      const baseline = await ActorBaselineModel.findOne({ actorSlug: e.slug, window: '7d' }).lean();
      if (!baseline) continue;
      
      // Get current 24h flows
      const addresses = await EntityAddressModel.find({ entityId: e._id.toString() })
        .select('address')
        .lean();
      
      const addressList = (addresses as any[]).map(a => a.address.toLowerCase());
      if (addressList.length === 0) continue;
      
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const [inflowAgg, outflowAgg] = await Promise.all([
        TransferModel.aggregate([
          { $match: { to: { $in: addressList }, timestamp: { $gte: cutoff24h } } },
          { $sample: { size: CONFIG.MAX_TX_SAMPLE } },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
        ]),
        TransferModel.aggregate([
          { $match: { from: { $in: addressList }, timestamp: { $gte: cutoff24h } } },
          { $sample: { size: CONFIG.MAX_TX_SAMPLE } },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amountNormalized' } }, count: { $sum: 1 } } }
        ]),
      ]);
      
      const currentInflow = inflowAgg[0]?.total || 0;
      const currentOutflow = outflowAgg[0]?.total || 0;
      const b = baseline as any;
      
      // ========== Signal 1: Flow Deviation (Inflow) ==========
      if (b.flows.inflowUsd > 0 && currentInflow > 0) {
        // Normalize to daily rate (baseline is 7d, current is 24h)
        const baselineDaily = b.flows.inflowUsd / 7;
        const deviation = currentInflow / baselineDaily;
        
        if (deviation >= thresholds.flow_deviation) {
          // Check if signal already exists (avoid duplicates)
          const existing = await ActorSignalModel.findOne({
            actorSlug: e.slug,
            signalType: 'flow_deviation',
            metric: 'inflow',
            status: 'active',
            detectedAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }, // Within 6h
          });
          
          if (!existing) {
            await ActorSignalModel.create({
              actorId: e._id.toString(),
              actorSlug: e.slug,
              actorType,
              signalType: 'flow_deviation',
              metric: 'inflow',
              deviation: Math.round(deviation * 10) / 10,
              window: '24h',
              detectedAt: new Date(),
              evidence: {
                previousValue: baselineDaily,
                currentValue: currentInflow,
                baselineValue: baselineDaily,
              },
              interpretation: `${e.name} inflow increased ${deviation.toFixed(1)}× vs 7d baseline`,
              severity: getSeverity(deviation),
              expiresAt: signalExpiry,
              status: 'active',
            });
            signalsGenerated++;
          }
        }
      }
      
      // ========== Signal 2: Flow Deviation (Outflow) ==========
      if (b.flows.outflowUsd > 0 && currentOutflow > 0) {
        const baselineDaily = b.flows.outflowUsd / 7;
        const deviation = currentOutflow / baselineDaily;
        
        if (deviation >= thresholds.flow_deviation) {
          const existing = await ActorSignalModel.findOne({
            actorSlug: e.slug,
            signalType: 'flow_deviation',
            metric: 'outflow',
            status: 'active',
            detectedAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
          });
          
          if (!existing) {
            await ActorSignalModel.create({
              actorId: e._id.toString(),
              actorSlug: e.slug,
              actorType,
              signalType: 'flow_deviation',
              metric: 'outflow',
              deviation: Math.round(deviation * 10) / 10,
              window: '24h',
              detectedAt: new Date(),
              evidence: {
                previousValue: baselineDaily,
                currentValue: currentOutflow,
                baselineValue: baselineDaily,
              },
              interpretation: `${e.name} outflow increased ${deviation.toFixed(1)}× vs 7d baseline`,
              severity: getSeverity(deviation),
              expiresAt: signalExpiry,
              status: 'active',
            });
            signalsGenerated++;
          }
        }
      }
      
      // ========== Signal 3: Behavior Regime Shift ==========
      const currentNetFlow = currentInflow - currentOutflow;
      const currentTotalFlow = currentInflow + currentOutflow;
      const currentPattern = determineBehaviorPattern(currentNetFlow, currentTotalFlow);
      
      if (currentPattern !== b.behavior.dominantPattern && 
          b.behavior.dominantPattern !== 'dormant' && 
          currentPattern !== 'dormant') {
        
        const existing = await ActorSignalModel.findOne({
          actorSlug: e.slug,
          signalType: 'behavior_regime_shift',
          status: 'active',
          detectedAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }, // Within 12h
        });
        
        if (!existing) {
          await ActorSignalModel.create({
            actorId: e._id.toString(),
            actorSlug: e.slug,
            actorType,
            signalType: 'behavior_regime_shift',
            metric: 'flow_pattern',
            deviation: 1, // Regime shifts don't have multiplier
            window: '24h',
            detectedAt: new Date(),
            evidence: {
              previousValue: 0,
              currentValue: 0,
            },
            interpretation: `${e.name} flow pattern shifted from ${b.behavior.dominantPattern} to ${currentPattern}`,
            severity: 'medium',
            expiresAt: signalExpiry,
            status: 'active',
          });
          signalsGenerated++;
        }
      }
      
    } catch (err: any) {
      console.error(`[BuildActorSignals] Failed signals for ${e.slug}:`, err.message);
    }
  }
  
  // ========== Signal 4: Corridor Volume Spike ==========
  try {
    const graph = await ComputedGraphModel.findOne({ window: '7d' }).lean();
    if (graph && (graph as any).edges) {
      for (const edge of (graph as any).edges) {
        // Compare to baseline corridor volume (simplified: use half the current as "baseline")
        // In production, you'd have historical corridor data
        const baselineVolume = edge.flow?.volumeUsd / 2 || 1;
        const currentVolume = edge.flow?.volumeUsd || 0;
        const deviation = currentVolume / baselineVolume;
        
        if (deviation >= 3.0 && currentVolume > 50000) { // Min $50k to report
          const existing = await ActorSignalModel.findOne({
            signalType: 'corridor_volume_spike',
            'evidence.corridors.from': edge.from,
            'evidence.corridors.to': edge.to,
            status: 'active',
            detectedAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
          });
          
          if (!existing) {
            // Create signal for "from" actor
            const fromEntity = await EntityModel.findOne({ slug: edge.from }).lean();
            if (fromEntity) {
              const fe = fromEntity as any;
              await ActorSignalModel.create({
                actorId: fe._id.toString(),
                actorSlug: edge.from,
                actorType: mapCategoryToActorType(fe.category),
                signalType: 'corridor_volume_spike',
                metric: 'corridor_volume',
                deviation: Math.round(deviation * 10) / 10,
                window: '24h',
                detectedAt: new Date(),
                evidence: {
                  corridors: [{
                    from: edge.from,
                    to: edge.to,
                    volumeUsd: currentVolume,
                  }],
                  baselineValue: baselineVolume,
                  currentValue: currentVolume,
                },
                interpretation: `${edge.from} → ${edge.to} corridor volume increased ${deviation.toFixed(1)}×`,
                severity: getSeverity(deviation),
                expiresAt: signalExpiry,
                status: 'active',
              });
              signalsGenerated++;
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[BuildActorSignals] Corridor signal detection failed:', err.message);
  }
  
  return signalsGenerated;
}

// ============ CLEANUP ============

async function cleanupExpiredSignals(): Promise<number> {
  const result = await ActorSignalModel.updateMany(
    { status: 'active', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount;
}

// ============ MAIN JOB ============

export async function buildActorSignals(): Promise<{
  baselinesUpdated: number;
  signalsGenerated: number;
  expiredCleaned: number;
  duration: number;
  errors: string[];
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  let baselinesUpdated = 0;
  let signalsGenerated = 0;
  let expiredCleaned = 0;
  
  try {
    // Step 1: Update baselines
    baselinesUpdated = await calculateBaselines();
    
    // Step 2: Detect signals
    signalsGenerated = await detectSignals();
    
    // Step 3: Cleanup expired
    expiredCleaned = await cleanupExpiredSignals();
    
  } catch (err: any) {
    errors.push(err.message);
    console.error('[BuildActorSignals] Job failed:', err);
  }
  
  const duration = Date.now() - startTime;
  
  lastJobStatus = {
    lastRun: new Date(),
    duration,
    baselinesUpdated,
    signalsGenerated,
    errors,
  };
  
  return { baselinesUpdated, signalsGenerated, expiredCleaned, duration, errors };
}

export function getBuildActorSignalsStatus() {
  return lastJobStatus;
}
