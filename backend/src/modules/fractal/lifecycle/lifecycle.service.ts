/**
 * P1-A + P2: Lifecycle Service
 * 
 * Core logic for model promotion and snapshot management.
 */

import { ModelConfigStore } from '../config/model-config.store.js';
import { LifecycleStore } from './lifecycle.store.js';
import { hashConfig, generateVersion } from '../config/config-hash.util.js';
import { buildFocusPack } from '../focus/focus-pack.builder.js';
import { AssetKey, PredictionSnapshotDoc, DecisionOutcomeDoc } from './lifecycle.contract.js';
import { HorizonKey } from '../config/horizon.config.js';
import { CanonicalStore } from '../data/canonical.store.js';

// Horizons to snapshot on promote
const SNAPSHOT_HORIZONS: HorizonKey[] = ['7d', '14d', '30d', '90d'];

// Days required for each horizon to resolve
const HORIZON_DAYS: Record<string, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

/**
 * Promote model to new version
 * 
 * 1. Captures current config
 * 2. Creates version with hash
 * 3. Saves lifecycle event
 * 4. Updates lifecycle state
 * 5. Creates snapshots for all horizons (P2)
 */
export async function promoteModel(
  asset: AssetKey, 
  user?: string
): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    // 1. Get current config
    const config = await ModelConfigStore.get(asset);
    
    if (!config) {
      return { ok: false, error: 'No model_config found for asset. Initialize config first.' };
    }

    // 2. Generate version and hash
    const configHash = hashConfig(config);
    const version = generateVersion();

    console.log(`[Lifecycle] Promoting ${asset} to ${version} (hash: ${configHash})`);

    // 3. Insert lifecycle event
    await LifecycleStore.insertEvent({
      asset,
      version,
      type: 'PROMOTE',
      configHash,
      configSnapshot: config,
      createdAt: new Date(),
      createdBy: user || 'system',
    });

    // 4. Update lifecycle state
    await LifecycleStore.setState({
      asset,
      activeVersion: version,
      activeConfigHash: configHash,
      status: 'ACTIVE',
      promotedAt: new Date(),
      promotedBy: user || 'system',
    });

    // 5. P2: Create snapshots for each horizon
    let snapshotCount = 0;
    for (const horizon of SNAPSHOT_HORIZONS) {
      try {
        const pack = await buildFocusPack(asset, horizon);
        const currentPrice = pack.meta.asOf ? 
          pack.forecast?.path?.[0] || 0 : 0;
        
        // Get actual current price from candles
        const canonicalStore = new CanonicalStore();
        const candles = await canonicalStore.getAll(asset, '1d');
        const actualPrice = candles && candles.length > 0 ? 
          candles[candles.length - 1].ohlcv.c : currentPrice;

        const snapshot: PredictionSnapshotDoc = {
          asset,
          version,
          horizon,
          asOf: new Date(),
          asOfPrice: actualPrice,
          forecastPath: pack.forecast?.path || [],
          upperBand: pack.forecast?.upperBand,
          lowerBand: pack.forecast?.lowerBand,
          primaryMatchId: pack.primarySelection?.primaryMatch?.id,
          resolved: false,
        };

        await LifecycleStore.insertSnapshot(snapshot);
        snapshotCount++;
        
        console.log(`[Lifecycle] Created snapshot for ${asset}/${horizon} at price ${actualPrice}`);
      } catch (err) {
        console.error(`[Lifecycle] Failed to create snapshot for ${horizon}:`, err);
      }
    }

    console.log(`[Lifecycle] Promotion complete: ${version}, ${snapshotCount} snapshots created`);

    return { ok: true, version };
  } catch (err: any) {
    console.error('[Lifecycle] Promote error:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * P2: Resolve snapshots that have matured
 * 
 * Checks each unresolved snapshot to see if enough time has passed,
 * then calculates actual vs predicted return.
 */
export async function resolveSnapshots(
  asset?: AssetKey
): Promise<{ resolved: number; outcomes: number; errors: string[] }> {
  const errors: string[] = [];
  let resolved = 0;
  let outcomes = 0;

  try {
    const unresolved = await LifecycleStore.getUnresolvedSnapshots(asset);
    const now = new Date();

    console.log(`[Lifecycle] Found ${unresolved.length} unresolved snapshots`);

    for (const snapshot of unresolved) {
      const horizonDays = HORIZON_DAYS[snapshot.horizon] || 30;
      const snapshotDate = new Date(snapshot.asOf);
      const daysPassed = Math.floor((now.getTime() - snapshotDate.getTime()) / (1000 * 60 * 60 * 24));

      // Check if enough time has passed
      if (daysPassed < horizonDays) {
        continue;
      }

      try {
        // Get current price
        const canonicalStore = new CanonicalStore();
        const candles = await canonicalStore.getAll(snapshot.asset, '1d');
        
        if (!candles || candles.length === 0) {
          errors.push(`No candles for ${snapshot.asset}`);
          continue;
        }

        const currentPrice = candles[candles.length - 1].ohlcv.c;
        const asOfPrice = snapshot.asOfPrice;

        if (!asOfPrice || asOfPrice === 0) {
          errors.push(`Invalid asOfPrice for ${snapshot.asset}/${snapshot.version}/${snapshot.horizon}`);
          continue;
        }

        // Calculate returns
        const realizedReturn = (currentPrice - asOfPrice) / asOfPrice;
        const expectedReturn = snapshot.forecastPath.length > 0 ?
          (snapshot.forecastPath[snapshot.forecastPath.length - 1] - asOfPrice) / asOfPrice : 0;
        const error = realizedReturn - expectedReturn;

        // Resolve snapshot
        await LifecycleStore.resolveSnapshot(
          snapshot.asset,
          snapshot.version,
          snapshot.horizon,
          { realizedReturn, expectedReturn, error }
        );

        resolved++;

        // Create decision outcome
        const predictedDirection = expectedReturn > 0.01 ? 'BULL' : expectedReturn < -0.01 ? 'BEAR' : 'NEUTRAL';
        const actualDirection = realizedReturn > 0.01 ? 'BULL' : realizedReturn < -0.01 ? 'BEAR' : 'NEUTRAL';
        const hit = predictedDirection === actualDirection;

        const outcome: DecisionOutcomeDoc = {
          asset: snapshot.asset,
          version: snapshot.version,
          horizon: snapshot.horizon,
          snapshotId: `${snapshot.asset}_${snapshot.version}_${snapshot.horizon}`,
          predictedDirection,
          actualDirection,
          hit,
          predictedReturn: expectedReturn,
          actualReturn: realizedReturn,
          error,
          resolvedAt: new Date(),
        };

        await LifecycleStore.insertOutcome(outcome);
        outcomes++;

        console.log(`[Lifecycle] Resolved ${snapshot.asset}/${snapshot.horizon}: expected ${(expectedReturn*100).toFixed(2)}%, actual ${(realizedReturn*100).toFixed(2)}%, hit: ${hit}`);
      } catch (err: any) {
        errors.push(`Failed to resolve ${snapshot.asset}/${snapshot.horizon}: ${err.message}`);
      }
    }

    return { resolved, outcomes, errors };
  } catch (err: any) {
    errors.push(`Resolve error: ${err.message}`);
    return { resolved, outcomes, errors };
  }
}

/**
 * Get lifecycle status for asset
 */
export async function getLifecycleStatus(asset: AssetKey): Promise<{
  state: any;
  events: any[];
  snapshots: any[];
  outcomeStats: any;
}> {
  const state = await LifecycleStore.getState(asset);
  const events = await LifecycleStore.getEvents(asset, 10);
  const snapshots = state?.activeVersion ? 
    await LifecycleStore.getSnapshotsByVersion(asset, state.activeVersion) : [];
  const outcomeStats = await LifecycleStore.getOutcomeStats(asset);

  return { state, events, snapshots, outcomeStats };
}

/**
 * P2.5: Rollback to previous version
 * 
 * Does NOT delete snapshots/outcomes - only changes activeVersion
 * and restores config from event snapshot.
 */
export async function rollbackModel(
  asset: AssetKey,
  toVersion?: string,
  steps?: number,
  user?: string
): Promise<{ ok: boolean; fromVersion?: string; toVersion?: string; error?: string }> {
  try {
    // Get current state
    const currentState = await LifecycleStore.getState(asset);
    if (!currentState) {
      return { ok: false, error: 'No lifecycle state found for asset' };
    }

    const fromVersion = currentState.activeVersion;

    // Get all events to find target version
    const events = await LifecycleStore.getEvents(asset, 100);
    const promoteEvents = events.filter(e => e.type === 'PROMOTE');

    if (promoteEvents.length < 2) {
      return { ok: false, error: 'Not enough versions to rollback' };
    }

    let targetVersion: string;
    let targetEvent: any;

    if (toVersion) {
      // Rollback to specific version
      targetEvent = promoteEvents.find(e => e.version === toVersion);
      if (!targetEvent) {
        return { ok: false, error: `Version ${toVersion} not found` };
      }
      targetVersion = toVersion;
    } else if (steps) {
      // Rollback N steps back
      const currentIdx = promoteEvents.findIndex(e => e.version === fromVersion);
      const targetIdx = currentIdx + steps; // events sorted desc, so +steps goes back
      if (targetIdx >= promoteEvents.length) {
        return { ok: false, error: `Cannot rollback ${steps} steps, only ${promoteEvents.length - currentIdx - 1} available` };
      }
      targetEvent = promoteEvents[targetIdx];
      targetVersion = targetEvent.version;
    } else {
      // Default: rollback 1 step
      const currentIdx = promoteEvents.findIndex(e => e.version === fromVersion);
      if (currentIdx + 1 >= promoteEvents.length) {
        return { ok: false, error: 'No previous version to rollback to' };
      }
      targetEvent = promoteEvents[currentIdx + 1];
      targetVersion = targetEvent.version;
    }

    if (targetVersion === fromVersion) {
      return { ok: true, fromVersion, toVersion: targetVersion, error: 'Already at target version (no-op)' };
    }

    console.log(`[Lifecycle] Rolling back ${asset} from ${fromVersion} to ${targetVersion}`);

    // Restore config from event snapshot
    if (targetEvent.configSnapshot) {
      await ModelConfigStore.upsert(asset, {
        windowLen: targetEvent.configSnapshot.windowLen,
        topK: targetEvent.configSnapshot.topK,
        similarityMode: targetEvent.configSnapshot.similarityMode,
        minGapDays: targetEvent.configSnapshot.minGapDays,
        ageDecayLambda: targetEvent.configSnapshot.ageDecayLambda,
        regimeConditioning: targetEvent.configSnapshot.regimeConditioning,
        horizonWeights: targetEvent.configSnapshot.horizonWeights,
        tierWeights: targetEvent.configSnapshot.tierWeights,
        version: targetVersion,
      }, `rollback:${user || 'system'}`);
    }

    // Insert rollback event
    await LifecycleStore.insertEvent({
      asset,
      version: targetVersion,
      type: 'ROLLBACK',
      configHash: targetEvent.configHash,
      configSnapshot: targetEvent.configSnapshot,
      createdAt: new Date(),
      createdBy: user || 'system',
      notes: `Rollback from ${fromVersion} to ${targetVersion}`,
    });

    // Update lifecycle state
    await LifecycleStore.setState({
      asset,
      activeVersion: targetVersion,
      activeConfigHash: targetEvent.configHash,
      status: 'ACTIVE',
      promotedAt: new Date(),
      promotedBy: `rollback:${user || 'system'}`,
    });

    console.log(`[Lifecycle] Rollback complete: ${fromVersion} → ${targetVersion}`);

    return { ok: true, fromVersion, toVersion: targetVersion };
  } catch (err: any) {
    console.error('[Lifecycle] Rollback error:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * P2.5: Force resolve snapshots (for testing)
 * 
 * Resolves ALL unresolved snapshots regardless of time elapsed.
 * Uses mock realized returns based on horizon.
 */
export async function forceResolveSnapshots(
  asset?: AssetKey
): Promise<{ resolved: number; outcomes: number; errors: string[] }> {
  const errors: string[] = [];
  let resolved = 0;
  let outcomes = 0;

  try {
    const unresolved = await LifecycleStore.getUnresolvedSnapshots(asset);

    console.log(`[Lifecycle] Force resolving ${unresolved.length} snapshots`);

    for (const snapshot of unresolved) {
      try {
        // Get current price
        const canonicalStore = new CanonicalStore();
        const candles = await canonicalStore.getAll(snapshot.asset, '1d');
        
        if (!candles || candles.length === 0) {
          errors.push(`No candles for ${snapshot.asset}`);
          continue;
        }

        const currentPrice = candles[candles.length - 1].ohlcv.c;
        const asOfPrice = snapshot.asOfPrice;

        if (!asOfPrice || asOfPrice === 0) {
          errors.push(`Invalid asOfPrice for ${snapshot.asset}/${snapshot.version}/${snapshot.horizon}`);
          continue;
        }

        // Calculate actual returns
        const realizedReturn = (currentPrice - asOfPrice) / asOfPrice;
        const expectedReturn = snapshot.forecastPath.length > 0 ?
          (snapshot.forecastPath[snapshot.forecastPath.length - 1] - asOfPrice) / asOfPrice : 0;
        const error = realizedReturn - expectedReturn;

        // Resolve snapshot
        await LifecycleStore.resolveSnapshot(
          snapshot.asset,
          snapshot.version,
          snapshot.horizon,
          { realizedReturn, expectedReturn, error }
        );

        resolved++;

        // Create decision outcome
        const predictedDirection = expectedReturn > 0.01 ? 'BULL' : expectedReturn < -0.01 ? 'BEAR' : 'NEUTRAL';
        const actualDirection = realizedReturn > 0.01 ? 'BULL' : realizedReturn < -0.01 ? 'BEAR' : 'NEUTRAL';
        const hit = predictedDirection === actualDirection;

        // Check for duplicate outcome
        const existingOutcomes = await LifecycleStore.getOutcomes(snapshot.asset, 1000);
        const isDuplicate = existingOutcomes.some(o => 
          o.version === snapshot.version && 
          o.horizon === snapshot.horizon
        );

        if (!isDuplicate) {
          const outcome: DecisionOutcomeDoc = {
            asset: snapshot.asset,
            version: snapshot.version,
            horizon: snapshot.horizon,
            snapshotId: `${snapshot.asset}_${snapshot.version}_${snapshot.horizon}`,
            predictedDirection,
            actualDirection,
            hit,
            predictedReturn: expectedReturn,
            actualReturn: realizedReturn,
            error,
            resolvedAt: new Date(),
          };

          await LifecycleStore.insertOutcome(outcome);
          outcomes++;
        }

        console.log(`[Lifecycle] Force resolved ${snapshot.asset}/${snapshot.version}/${snapshot.horizon}: hit=${hit}`);
      } catch (err: any) {
        errors.push(`Failed to resolve ${snapshot.asset}/${snapshot.horizon}: ${err.message}`);
      }
    }

    return { resolved, outcomes, errors };
  } catch (err: any) {
    errors.push(`Force resolve error: ${err.message}`);
    return { resolved, outcomes, errors };
  }
}
