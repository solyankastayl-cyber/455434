/**
 * P4: Composite Promote Service
 * 
 * Main orchestrator for composite lifecycle.
 * 
 * Promote flow:
 * 1. Get active versions for BTC/SPX/DXY
 * 2. Fetch parent snapshots by version
 * 3. Get candles for volatility calculation
 * 4. Calculate smart weights
 * 5. Build composite forecast
 * 6. Save composite snapshot
 * 7. Update lifecycle state
 * 8. Record lifecycle event
 */

import { getMongoDb } from '../../../db/mongoose.js';
import { CompositeStore } from '../store/composite.store.js';
import { calculateVolatilityResults } from './composite.vol.js';
import { calculateSmartWeights } from './composite.weights.js';
import { buildCompositePath } from './composite.builder.js';
import {
  DEFAULT_BLEND_CONFIG,
  type BlendConfig,
  type ParentVersions,
  type ParentSnapshotData,
  type CompositeSnapshotDoc,
  type CompositeAuditResult,
} from '../contracts/composite.contract.js';
import * as crypto from 'crypto';

// Helper to get DB
async function getDb() {
  return getMongoDb();
}

// ═══════════════════════════════════════════════════════════════
// HELPERS: Fetch parent data
// ═══════════════════════════════════════════════════════════════

/**
 * Get active version for an asset
 */
async function getActiveVersion(asset: string): Promise<string | null> {
  const db = await getDb();
  const state = await db.collection('model_lifecycle_state').findOne({ asset });
  return state?.activeVersion || null;
}

/**
 * Get parent snapshot by version and horizon
 */
async function getParentSnapshot(
  asset: string,
  versionId: string,
  horizonDays: number
): Promise<ParentSnapshotData | null> {
  const db = await getDb();
  
  // Try prediction_snapshots first
  const snapshot = await db.collection('prediction_snapshots').findOne({
    asset: asset.toUpperCase(),
    versionId,
    horizonDays,
  });
  
  if (snapshot) {
    return {
      asset: asset.toUpperCase() as any,
      versionId,
      asOf: snapshot.asOf,
      asOfPrice: snapshot.asOfPrice,
      forecastPath: snapshot.forecastPath || snapshot.series?.slice(snapshot.anchorIndex) || [],
      confidence: snapshot.confidence ?? 0.7,
      reliability: snapshot.reliability,
      stance: snapshot.stance || snapshot.verdict,
    };
  }
  
  return null;
}

/**
 * Get candle prices for volatility calculation
 */
async function getCandlePrices(asset: string, lookbackDays: number): Promise<number[]> {
  const db = await getDb();
  let collection = 'fractal_canonical_ohlcv';
  
  if (asset === 'SPX') collection = 'spx_candles';
  if (asset === 'DXY') collection = 'dxy_candles';
  
  const candles = await db.collection(collection)
    .find({})
    .sort({ t: -1 })
    .limit(lookbackDays + 10)
    .toArray();
  
  // Sort ascending and extract close prices
  candles.sort((a, b) => a.t - b.t);
  return candles.map((c) => c.c || c.close);
}

/**
 * Generate version ID for composite
 */
function generateVersionId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `cv${ts}.${ms}`;
}

/**
 * Generate config hash
 */
function generateConfigHash(parentVersions: ParentVersions, config: BlendConfig): string {
  const data = JSON.stringify({ parentVersions, config });
  return crypto.createHash('md5').update(data).digest('hex').slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════
// MAIN PROMOTE FUNCTION
// ═══════════════════════════════════════════════════════════════

export interface PromoteResult {
  ok: boolean;
  versionId?: string;
  parentVersions?: ParentVersions;
  configHash?: string;
  error?: string;
}

export async function promoteComposite(
  horizonDays: number,
  blendConfig?: Partial<BlendConfig>,
  promotedBy: string = 'admin'
): Promise<PromoteResult> {
  const config: BlendConfig = { ...DEFAULT_BLEND_CONFIG, ...blendConfig };
  
  try {
    // 1. Get active versions
    const btcVersion = await getActiveVersion('BTC');
    const spxVersion = await getActiveVersion('SPX');
    const dxyVersion = await getActiveVersion('DXY');
    
    if (!btcVersion || !spxVersion || !dxyVersion) {
      return {
        ok: false,
        error: `Missing active versions: BTC=${btcVersion}, SPX=${spxVersion}, DXY=${dxyVersion}`,
      };
    }
    
    const parentVersions: ParentVersions = {
      BTC: btcVersion,
      SPX: spxVersion,
      DXY: dxyVersion,
    };
    
    // 2. Fetch parent snapshots
    const btcSnapshot = await getParentSnapshot('BTC', btcVersion, horizonDays);
    const spxSnapshot = await getParentSnapshot('SPX', spxVersion, horizonDays);
    const dxySnapshot = await getParentSnapshot('DXY', dxyVersion, horizonDays);
    
    // If no snapshots exist, create synthetic ones from focus-pack data
    const btc = btcSnapshot || await createSyntheticSnapshot('BTC', btcVersion, horizonDays);
    const spx = spxSnapshot || await createSyntheticSnapshot('SPX', spxVersion, horizonDays);
    const dxy = dxySnapshot || await createSyntheticSnapshot('DXY', dxyVersion, horizonDays);
    
    if (!btc || !spx || !dxy) {
      return {
        ok: false,
        error: 'Could not fetch parent snapshots',
      };
    }
    
    // 3. Get candles for volatility
    const btcPrices = await getCandlePrices('BTC', config.volLookbackDays);
    const spxPrices = await getCandlePrices('SPX', config.volLookbackDays);
    const dxyPrices = await getCandlePrices('DXY', config.volLookbackDays);
    
    // 4. Calculate volatility results
    const volResults = calculateVolatilityResults(
      btcPrices,
      spxPrices,
      dxyPrices,
      config.volLookbackDays,
      config.volRefSigma,
      config.volPenaltyPower
    );
    
    // 5. Calculate smart weights
    const weights = calculateSmartWeights({
      btc,
      spx,
      dxy,
      volResults,
      config,
    });
    
    // 6. Build composite forecast (P5.1: now async with health check)
    const compositePath = await buildCompositePath(btc, spx, dxy, weights, config);
    
    // 7. Generate version ID and config hash
    const versionId = generateVersionId();
    const configHash = generateConfigHash(parentVersions, config);
    
    // 8. Create composite snapshot document
    const snapshotDoc: CompositeSnapshotDoc = {
      asset: 'CROSS_ASSET',
      versionId,
      horizonDays,
      parentVersions,
      blendConfig: config,
      computedWeights: weights,
      asOf: new Date().toISOString(),
      anchorPrice: compositePath.anchorPrice,
      forecastPath: compositePath.forecastPath,
      forecastReturns: compositePath.forecastReturns,
      upperBand: compositePath.upperBand,
      lowerBand: compositePath.lowerBand,
      expectedReturn: compositePath.expectedReturn,
      confidence: compositePath.confidence,
      stance: compositePath.stance,
      createdAt: new Date(),
      createdBy: promotedBy,
      resolved: false,
    };
    
    // 9. Save snapshot
    await CompositeStore.saveSnapshot(snapshotDoc);
    
    // 10. Update lifecycle state
    await CompositeStore.updateState({
      activeVersion: versionId,
      activeConfigHash: configHash,
      promotedAt: new Date(),
      promotedBy,
      status: 'ACTIVE',
    });
    
    // 11. Record lifecycle event
    await CompositeStore.addEvent({
      asset: 'CROSS_ASSET',
      version: versionId,
      type: 'PROMOTE',
      parentVersions,
      blendConfig: config,
      createdAt: new Date(),
      createdBy: promotedBy,
      reason: `Horizon ${horizonDays}d promote`,
    });
    
    console.log(`[Composite] Promoted version ${versionId} for horizon ${horizonDays}d`);
    
    return {
      ok: true,
      versionId,
      parentVersions,
      configHash,
    };
  } catch (err: any) {
    console.error('[Composite] Promote error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Create synthetic snapshot from current data if no version-specific snapshot exists
 */
async function createSyntheticSnapshot(
  asset: string,
  versionId: string,
  horizonDays: number
): Promise<ParentSnapshotData | null> {
  const db = await getDb();
  
  // Get model config
  const config = await db.collection('model_config').findOne({ asset });
  
  // Get latest candles
  let collection = 'fractal_canonical_ohlcv';
  if (asset === 'SPX') collection = 'spx_candles';
  if (asset === 'DXY') collection = 'dxy_candles';
  
  const candles = await db.collection(collection)
    .find({})
    .sort({ t: -1 })
    .limit(horizonDays + 30)
    .toArray();
  
  if (candles.length === 0) return null;
  
  candles.sort((a, b) => a.t - b.t);
  const latestPrice = candles[candles.length - 1].c || candles[candles.length - 1].close;
  
  // Create simple synthetic forecast (last N days trend extended)
  const forecastPath: number[] = [latestPrice];
  const trend = candles.length > 10 
    ? (candles[candles.length - 1].c - candles[candles.length - 10].c) / candles[candles.length - 10].c / 10
    : 0;
  
  for (let i = 1; i <= horizonDays; i++) {
    forecastPath.push(forecastPath[forecastPath.length - 1] * (1 + trend));
  }
  
  return {
    asset: asset as any,
    versionId,
    asOf: new Date().toISOString(),
    asOfPrice: latestPrice,
    forecastPath,
    confidence: 0.5, // Low confidence for synthetic
    stance: trend > 0.001 ? 'BULL' : trend < -0.001 ? 'BEAR' : 'NEUTRAL',
  };
}

// ═══════════════════════════════════════════════════════════════
// AUDIT FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function auditCompositeInvariants(versionId?: string): Promise<CompositeAuditResult> {
  const state = await CompositeStore.getState();
  const version = versionId || state?.activeVersion;
  
  if (!version) {
    return {
      ok: false,
      checks: {} as any,
      errors: ['No active composite version'],
    };
  }
  
  const snapshot = await CompositeStore.getSnapshot(version, 90); // Default 90d
  
  if (!snapshot) {
    return {
      ok: false,
      checks: {} as any,
      errors: [`Snapshot not found for version ${version}`],
    };
  }
  
  const weights = snapshot.computedWeights;
  const errors: string[] = [];
  
  // Check weights sum
  const weightsSum = weights.BTC + weights.SPX + weights.DXY;
  const weightsSumOk = Math.abs(weightsSum - 1.0) < 0.001;
  
  // Check weights bounded
  const MIN_W = 0.05;
  const MAX_W = 0.90;
  const weightsBoundedViolations: string[] = [];
  if (weights.BTC < MIN_W || weights.BTC > MAX_W) weightsBoundedViolations.push(`BTC=${weights.BTC}`);
  if (weights.SPX < MIN_W || weights.SPX > MAX_W) weightsBoundedViolations.push(`SPX=${weights.SPX}`);
  if (weights.DXY < MIN_W || weights.DXY > MAX_W) weightsBoundedViolations.push(`DXY=${weights.DXY}`);
  
  // Check NaN/Inf
  const nanFound: string[] = [];
  if (!isFinite(weights.BTC)) nanFound.push('weights.BTC');
  if (!isFinite(weights.SPX)) nanFound.push('weights.SPX');
  if (!isFinite(weights.DXY)) nanFound.push('weights.DXY');
  for (let i = 0; i < snapshot.forecastPath.length; i++) {
    if (!isFinite(snapshot.forecastPath[i])) nanFound.push(`forecastPath[${i}]`);
  }
  
  // Check vol penalties
  const volViolations: string[] = [];
  if (weights.volPenalties.BTC <= 0 || weights.volPenalties.BTC > 1) volViolations.push('BTC');
  if (weights.volPenalties.SPX <= 0 || weights.volPenalties.SPX > 1) volViolations.push('SPX');
  if (weights.volPenalties.DXY <= 0 || weights.volPenalties.DXY > 1) volViolations.push('DXY');
  
  // Check conf factors
  const confViolations: string[] = [];
  if (weights.confFactors.BTC <= 0 || weights.confFactors.BTC > 1) confViolations.push('BTC');
  if (weights.confFactors.SPX <= 0 || weights.confFactors.SPX > 1) confViolations.push('SPX');
  if (weights.confFactors.DXY <= 0 || weights.confFactors.DXY > 1) confViolations.push('DXY');
  
  // Check daily return cap
  const maxReturn = Math.max(...snapshot.forecastReturns.map(Math.abs));
  const dailyReturnCapped = maxReturn <= snapshot.blendConfig.dailyReturnCap;
  
  // Check parent versions exist
  const missingParents: string[] = [];
  const db = await getDb();
  for (const asset of ['BTC', 'SPX', 'DXY'] as const) {
    const parentVersion = snapshot.parentVersions[asset];
    const exists = await db.collection('model_lifecycle_state').findOne({
      asset,
      activeVersion: parentVersion,
    });
    // Note: We don't require activeVersion to match, just that lifecycle exists
    const lifecycleExists = await db.collection('model_lifecycle_events').findOne({
      asset,
      version: parentVersion,
    });
    if (!lifecycleExists) missingParents.push(`${asset}:${parentVersion}`);
  }
  
  const allOk =
    weightsSumOk &&
    weightsBoundedViolations.length === 0 &&
    nanFound.length === 0 &&
    volViolations.length === 0 &&
    confViolations.length === 0 &&
    dailyReturnCapped &&
    missingParents.length === 0;
  
  return {
    ok: allOk,
    checks: {
      weightsSum: { ok: weightsSumOk, value: weightsSum },
      weightsBounded: { ok: weightsBoundedViolations.length === 0, violations: weightsBoundedViolations },
      noNaN: { ok: nanFound.length === 0, found: nanFound },
      volPenaltyBounded: { ok: volViolations.length === 0, violations: volViolations },
      confFactorBounded: { ok: confViolations.length === 0, violations: confViolations },
      dailyReturnCapped: { ok: dailyReturnCapped, maxReturn },
      parentVersionsExist: { ok: missingParents.length === 0, missing: missingParents },
    },
    errors,
  };
}

export default {
  promoteComposite,
  auditCompositeInvariants,
};
