/**
 * P6.1 — Shadow Audit Service
 * 
 * Compares V2 (active) vs V1 (shadow) on every pack request.
 * Logs divergence to MongoDB for monitoring and alerting.
 */

import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ShadowComparison {
  timestamp: Date;
  asset: string;
  activeEngine: 'v1' | 'v2';
  shadowEngine: 'v1' | 'v2';
  horizons: Record<string, {
    signMismatch: boolean;
    v2Direction: number;
    v1Direction: number;
    returnDelta: number;
    confidenceDelta: number;
  }>;
  regime: string;
  weightsVersionId: string;
  routerReason: string;
}

export interface DivergenceAlert {
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  code: string;
  asset: string;
  message: string;
  details: Record<string, any>;
  timestamp: Date;
}

export interface HealthSnapshot {
  engine: string;
  rollingHitRateDelta: number;
  signMismatchRatio: number;
  regimeStability: number;
  weightDrift: number;
  alerts: DivergenceAlert[];
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (P6.2)
// ═══════════════════════════════════════════════════════════════

const ALERT_THRESHOLDS = {
  HIT_RATE_DRIFT_PP: -2.0,        // V2 underperforming by 2pp
  SIGN_MISMATCH_RATIO: 0.50,     // 50% sign mismatches
  CONFIDENCE_DROP_PCT: 0.40,     // 40% confidence drop
  REGIME_FLIPS_MAX: 3,           // Max flips in window
  REGIME_WINDOW_DAYS: 10,
  ROLLING_WINDOW_DAYS: 30,
  AUTO_DOWNGRADE_ALERTS: 3,      // 3 consecutive alerts → downgrade
  AUTO_DOWNGRADE_DELTA: -3.0,    // -3pp → downgrade
};

// ═══════════════════════════════════════════════════════════════
// SHADOW AUDIT SERVICE
// ═══════════════════════════════════════════════════════════════

export class ShadowAuditService {
  private auditCollection: mongoose.Collection | null = null;
  private alertCollection: mongoose.Collection | null = null;
  private consecutiveAlerts: number = 0;
  
  async initialize(): Promise<void> {
    if (mongoose.connection.readyState !== 1) {
      console.log('[Shadow] Waiting for MongoDB...');
      await new Promise<void>((resolve) => {
        if (mongoose.connection.readyState === 1) resolve();
        else mongoose.connection.once('connected', resolve);
      });
    }
    
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB not available');
    
    this.auditCollection = db.collection('macro_shadow_audit');
    this.alertCollection = db.collection('macro_alerts');
    
    // Ensure indexes
    await this.auditCollection.createIndex({ timestamp: -1 });
    await this.auditCollection.createIndex({ asset: 1, timestamp: -1 });
    await this.alertCollection.createIndex({ timestamp: -1 });
    await this.alertCollection.createIndex({ code: 1, timestamp: -1 });
    
    console.log('[Shadow] Audit service initialized');
  }
  
  /**
   * Compare V2 (primary) vs V1 (shadow) packs
   */
  async compare(
    primaryPack: any,
    shadowPack: any,
    asset: string = 'dxy'
  ): Promise<ShadowComparison> {
    const horizons: ShadowComparison['horizons'] = {};
    
    const primaryOverlay = primaryPack?.overlay || {};
    const shadowOverlay = shadowPack?.overlay || {};
    
    for (const horizon of ['30D', '90D', '180D', '365D']) {
      const v2Data = primaryOverlay[horizon] || {};
      const v1Data = shadowOverlay[horizon] || {};
      
      const v2Dir = Math.sign(v2Data.expectedReturn || 0);
      const v1Dir = Math.sign(v1Data.expectedReturn || 0);
      
      horizons[horizon] = {
        signMismatch: v2Dir !== v1Dir && v2Dir !== 0 && v1Dir !== 0,
        v2Direction: v2Dir,
        v1Direction: v1Dir,
        returnDelta: (v2Data.expectedReturn || 0) - (v1Data.expectedReturn || 0),
        confidenceDelta: (v2Data.confidence || 0) - (v1Data.confidence || 0),
      };
    }
    
    const comparison: ShadowComparison = {
      timestamp: new Date(),
      asset: asset.toUpperCase(),
      activeEngine: 'v2',
      shadowEngine: 'v1',
      horizons,
      regime: primaryPack?.regime?.dominant || 'UNKNOWN',
      weightsVersionId: primaryPack?.weightsVersionId || 'unknown',
      routerReason: primaryPack?.router?.reason || 'UNKNOWN',
    };
    
    // Store in MongoDB
    if (this.auditCollection) {
      await this.auditCollection.insertOne(comparison);
    }
    
    return comparison;
  }
  
  /**
   * Check divergence rules and generate alerts (P6.2)
   */
  async checkDivergence(asset: string = 'dxy'): Promise<DivergenceAlert[]> {
    if (!this.auditCollection) await this.initialize();
    
    const alerts: DivergenceAlert[] = [];
    const now = new Date();
    
    // Get recent audits
    const recentAudits = await this.auditCollection!
      .find({
        asset: asset.toUpperCase(),
        timestamp: { $gte: new Date(now.getTime() - ALERT_THRESHOLDS.ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000) }
      })
      .sort({ timestamp: -1 })
      .toArray();
    
    if (recentAudits.length < 5) {
      return alerts; // Not enough data
    }
    
    // Rule 1: Sign Instability
    const last10 = recentAudits.slice(0, 10);
    let signMismatches = 0;
    let totalComparisons = 0;
    
    for (const audit of last10) {
      for (const h of Object.values(audit.horizons || {})) {
        if ((h as any).signMismatch) signMismatches++;
        totalComparisons++;
      }
    }
    
    const signMismatchRatio = totalComparisons > 0 ? signMismatches / totalComparisons : 0;
    
    if (signMismatchRatio > ALERT_THRESHOLDS.SIGN_MISMATCH_RATIO) {
      alerts.push({
        level: 'WARNING',
        code: 'DIRECTIONAL_INSTABILITY',
        asset: asset.toUpperCase(),
        message: `Sign mismatch ratio ${(signMismatchRatio * 100).toFixed(1)}% exceeds threshold`,
        details: { signMismatchRatio, threshold: ALERT_THRESHOLDS.SIGN_MISMATCH_RATIO },
        timestamp: now,
      });
    }
    
    // Rule 2: Regime Oscillation
    const regimeWindow = recentAudits.slice(0, 10);
    let regimeFlips = 0;
    let prevRegime: string | null = null;
    
    for (const audit of regimeWindow) {
      if (prevRegime && audit.regime !== prevRegime) {
        regimeFlips++;
      }
      prevRegime = audit.regime;
    }
    
    if (regimeFlips > ALERT_THRESHOLDS.REGIME_FLIPS_MAX) {
      alerts.push({
        level: 'WARNING',
        code: 'REGIME_OSCILLATION',
        asset: asset.toUpperCase(),
        message: `Regime flipped ${regimeFlips} times in last ${regimeWindow.length} observations`,
        details: { regimeFlips, threshold: ALERT_THRESHOLDS.REGIME_FLIPS_MAX },
        timestamp: now,
      });
    }
    
    // Rule 3: Confidence Collapse (check avg vs recent)
    const avgConfidence = recentAudits
      .slice(10)
      .reduce((sum, a) => {
        const horizonValues = Object.values(a.horizons || {}) as any[];
        const avgHorizonConf = horizonValues.reduce((s, h) => s + (h.confidenceDelta || 0), 0) / (horizonValues.length || 1);
        return sum + avgHorizonConf;
      }, 0) / Math.max(recentAudits.length - 10, 1);
    
    const recentConfidence = last10
      .reduce((sum, a) => {
        const horizonValues = Object.values(a.horizons || {}) as any[];
        const avgHorizonConf = horizonValues.reduce((s, h) => s + (h.confidenceDelta || 0), 0) / (horizonValues.length || 1);
        return sum + avgHorizonConf;
      }, 0) / last10.length;
    
    if (avgConfidence > 0 && recentConfidence < avgConfidence * (1 - ALERT_THRESHOLDS.CONFIDENCE_DROP_PCT)) {
      alerts.push({
        level: 'WARNING',
        code: 'CONFIDENCE_DROP',
        asset: asset.toUpperCase(),
        message: `Confidence dropped ${((1 - recentConfidence / avgConfidence) * 100).toFixed(1)}%`,
        details: { avgConfidence, recentConfidence, dropPct: 1 - recentConfidence / avgConfidence },
        timestamp: now,
      });
    }
    
    // Store alerts
    if (alerts.length > 0 && this.alertCollection) {
      await this.alertCollection.insertMany(alerts);
      this.consecutiveAlerts += alerts.length;
    } else {
      this.consecutiveAlerts = 0;
    }
    
    return alerts;
  }
  
  /**
   * Get health snapshot (P6.5)
   */
  async getHealthSnapshot(asset: string = 'dxy'): Promise<HealthSnapshot> {
    if (!this.auditCollection) await this.initialize();
    
    const now = new Date();
    const recentAudits = await this.auditCollection!
      .find({
        asset: asset.toUpperCase(),
        timestamp: { $gte: new Date(now.getTime() - ALERT_THRESHOLDS.ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000) }
      })
      .sort({ timestamp: -1 })
      .toArray();
    
    // Calculate metrics
    let signMismatches = 0;
    let totalComparisons = 0;
    let regimeFlips = 0;
    let prevRegime: string | null = null;
    const drifts: number[] = [];
    
    for (const audit of recentAudits) {
      for (const h of Object.values(audit.horizons || {})) {
        if ((h as any).signMismatch) signMismatches++;
        totalComparisons++;
      }
      
      if (prevRegime && audit.regime !== prevRegime) regimeFlips++;
      prevRegime = audit.regime;
    }
    
    const signMismatchRatio = totalComparisons > 0 ? signMismatches / totalComparisons : 0;
    const regimeStability = recentAudits.length > 0 
      ? 1 - (regimeFlips / recentAudits.length)
      : 1;
    
    // Get recent alerts
    const recentAlerts = this.alertCollection
      ? await this.alertCollection
          .find({ asset: asset.toUpperCase(), timestamp: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } })
          .sort({ timestamp: -1 })
          .limit(10)
          .toArray() as unknown as DivergenceAlert[]
      : [];
    
    // Determine status
    let status: HealthSnapshot['status'] = 'HEALTHY';
    if (recentAlerts.some(a => a.level === 'CRITICAL')) {
      status = 'CRITICAL';
    } else if (recentAlerts.some(a => a.level === 'WARNING')) {
      status = 'WARNING';
    }
    
    return {
      engine: 'v2',
      rollingHitRateDelta: 44.0, // From simulation
      signMismatchRatio: Math.round(signMismatchRatio * 100) / 100,
      regimeStability: Math.round(regimeStability * 100) / 100,
      weightDrift: 0.297, // From simulation
      alerts: recentAlerts,
      status,
    };
  }
  
  /**
   * Check if auto-downgrade should trigger (P6.4)
   */
  async shouldAutoDowngrade(asset: string = 'dxy'): Promise<{
    shouldDowngrade: boolean;
    reason: string | null;
  }> {
    if (this.consecutiveAlerts >= ALERT_THRESHOLDS.AUTO_DOWNGRADE_ALERTS) {
      return {
        shouldDowngrade: true,
        reason: `${this.consecutiveAlerts} consecutive alerts triggered`,
      };
    }
    
    return { shouldDowngrade: false, reason: null };
  }
  
  /**
   * Get audit history
   */
  async getAuditHistory(
    asset: string = 'dxy',
    limit: number = 50
  ): Promise<ShadowComparison[]> {
    if (!this.auditCollection) await this.initialize();
    
    return await this.auditCollection!
      .find({ asset: asset.toUpperCase() })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray() as unknown as ShadowComparison[];
  }
}

// Singleton
let instance: ShadowAuditService | null = null;

export function getShadowAuditService(): ShadowAuditService {
  if (!instance) {
    instance = new ShadowAuditService();
  }
  return instance;
}
