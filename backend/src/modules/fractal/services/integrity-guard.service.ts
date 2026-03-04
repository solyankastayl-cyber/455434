/**
 * INTEGRITY GUARD SERVICE
 * 
 * Monitors data integrity for SPX/DXY/BTC candles.
 * Triggers bootstrap if data falls below minimum thresholds.
 * 
 * Used by:
 * - Cold Start (app.fractal.ts)
 * - Daily Run (fractal.daily.job.ts)
 * - Health checks
 */

import fs from 'fs';
import { getMongoDb } from '../../../db/mongoose.js';

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS
// ═══════════════════════════════════════════════════════════════

export const INTEGRITY_THRESHOLDS = {
  SPX: {
    MIN_CANDLES: 15000,        // ~60 years of data (1950+)
    SEED_PATH: '/app/backend/data/fractal/bootstrap/spx_stooq_seed.csv',
    COLLECTION: 'spx_candles',
  },
  DXY: {
    MIN_CANDLES: 10000,        // ~40+ years (1973+ extended seed)
    SEED_PATH: '/app/backend/data/fractal/bootstrap/dxy_extended_seed.csv',
    COLLECTION: 'dxy_candles',
  },
  BTC: {
    MIN_CANDLES: 1000,         // ~3 years minimum
    SEED_PATH: null,           // BTC loads via API
    COLLECTION: 'fractal_canonical_ohlcv',
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface IntegrityCheckResult {
  symbol: string;
  count: number;
  minRequired: number;
  status: 'OK' | 'WARNING' | 'CRITICAL';
  bootstrapTriggered: boolean;
  bootstrapResult?: {
    loaded: number;
    errors: string[];
  };
}

export interface IntegrityGuardResult {
  timestamp: string;
  checks: IntegrityCheckResult[];
  allOk: boolean;
}

// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function bootstrapFromCsv(
  symbol: 'SPX' | 'DXY',
  csvPath: string,
  collection: string
): Promise<{ loaded: number; errors: string[] }> {
  const db = getMongoDb();
  const errors: string[] = [];
  let loaded = 0;

  if (!fs.existsSync(csvPath)) {
    errors.push(`Seed file not found: ${csvPath}`);
    return { loaded, errors };
  }

  try {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');
    
    const candles: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 5) {
        const dateStr = parts[0].trim();
        const open = parseFloat(parts[1]);
        const high = parseFloat(parts[2]);
        const low = parseFloat(parts[3]);
        const close = parseFloat(parts[4]);
        const volume = parts[5] ? parseFloat(parts[5]) : 0;
        
        const dateParts = dateStr.split('-');
        const ts = new Date(
          parseInt(dateParts[0]),
          parseInt(dateParts[1]) - 1,
          parseInt(dateParts[2])
        ).getTime();
        
        if (dateStr && !isNaN(close) && !isNaN(ts)) {
          candles.push({
            date: dateStr,
            ts,
            open,
            high,
            low,
            close,
            volume,
            symbol,
            source: 'INTEGRITY_GUARD_BOOTSTRAP',
            insertedAt: new Date()
          });
        }
      }
    }
    
    if (candles.length > 0) {
      const bulkOps = candles.map(c => ({
        updateOne: {
          filter: { date: c.date, symbol },
          update: { $set: c },
          upsert: true
        }
      }));
      
      const result = await db.collection(collection).bulkWrite(bulkOps, { ordered: false });
      loaded = result.upsertedCount + result.modifiedCount;
    }
  } catch (err: any) {
    errors.push(`Bootstrap failed: ${err.message}`);
  }

  return { loaded, errors };
}

// ═══════════════════════════════════════════════════════════════
// INTEGRITY GUARD SERVICE
// ═══════════════════════════════════════════════════════════════

export const integrityGuardService = {
  
  /**
   * Check single asset integrity
   */
  async checkAsset(symbol: 'SPX' | 'DXY' | 'BTC', autoBootstrap = false): Promise<IntegrityCheckResult> {
    const db = getMongoDb();
    const config = INTEGRITY_THRESHOLDS[symbol];
    
    const count = await db.collection(config.COLLECTION).countDocuments();
    
    let status: 'OK' | 'WARNING' | 'CRITICAL';
    if (count >= config.MIN_CANDLES) {
      status = 'OK';
    } else if (count >= config.MIN_CANDLES * 0.5) {
      status = 'WARNING';
    } else {
      status = 'CRITICAL';
    }
    
    const result: IntegrityCheckResult = {
      symbol,
      count,
      minRequired: config.MIN_CANDLES,
      status,
      bootstrapTriggered: false,
    };
    
    // Auto-bootstrap if CRITICAL and seed available
    if (autoBootstrap && status === 'CRITICAL' && config.SEED_PATH) {
      console.log(`[Integrity Guard] ${symbol} CRITICAL (${count} < ${config.MIN_CANDLES}), triggering bootstrap...`);
      result.bootstrapTriggered = true;
      result.bootstrapResult = await bootstrapFromCsv(symbol, config.SEED_PATH, config.COLLECTION);
      
      if (result.bootstrapResult.loaded > 0) {
        console.log(`[Integrity Guard] ✅ ${symbol} bootstrap complete: ${result.bootstrapResult.loaded} candles loaded`);
      } else {
        console.error(`[Integrity Guard] ❌ ${symbol} bootstrap failed:`, result.bootstrapResult.errors);
      }
    }
    
    return result;
  },
  
  /**
   * Check all assets integrity
   */
  async checkAll(autoBootstrap = false): Promise<IntegrityGuardResult> {
    const checks: IntegrityCheckResult[] = [];
    
    for (const symbol of ['SPX', 'DXY', 'BTC'] as const) {
      const check = await this.checkAsset(symbol, autoBootstrap);
      checks.push(check);
    }
    
    return {
      timestamp: new Date().toISOString(),
      checks,
      allOk: checks.every(c => c.status === 'OK'),
    };
  },
  
  /**
   * Run integrity guard with auto-bootstrap (for daily-run)
   */
  async runGuard(): Promise<IntegrityGuardResult> {
    console.log('[Integrity Guard] Running integrity check with auto-bootstrap...');
    const result = await this.checkAll(true);
    
    if (result.allOk) {
      console.log('[Integrity Guard] ✅ All data integrity checks passed');
    } else {
      const issues = result.checks.filter(c => c.status !== 'OK');
      console.warn(`[Integrity Guard] ⚠️ ${issues.length} integrity issues detected`);
    }
    
    return result;
  },
};

export default integrityGuardService;
