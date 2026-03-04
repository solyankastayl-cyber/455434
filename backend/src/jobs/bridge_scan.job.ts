/**
 * Bridge Scan Cron Job
 * 
 * BLOCK 2.1 - Automated Bridge Detection
 * 
 * Runs every 5 minutes to:
 * 1. Scan watchlist events for potential bridge migrations
 * 2. Detect cross-chain liquidity movements
 * 3. Create alerts for detected migrations
 * 4. Trigger actor intelligence analysis
 * 
 * Flow:
 * Bridge Scan → Migrations → Watchlist Events → System Alerts → Telegram
 */
import { scanForMigrations, getMigrationStats } from '../core/bridge_detection/bridge_detection.service.js';
import { scanActors } from '../core/actor_intelligence/actor_pattern_detection.service.js';

export interface BridgeScanResult {
  scanned: number;
  detected: number;
  actorsAnalyzed: number;
  actorEvents: number;
  duration: number;
  timestamp: Date;
}

let lastScanResult: BridgeScanResult | null = null;
let scanRunning = false;

/**
 * Run bridge detection scan
 */
export async function runBridgeScan(): Promise<BridgeScanResult> {
  const startTime = Date.now();
  
  if (scanRunning) {
    console.log('[Bridge Scan] Scan already running, skipping');
    return {
      scanned: 0,
      detected: 0,
      actorsAnalyzed: 0,
      actorEvents: 0,
      duration: 0,
      timestamp: new Date(),
    };
  }
  
  scanRunning = true;
  
  try {
    // Step 1: Scan for bridge migrations
    console.log('[Bridge Scan] Starting bridge migration detection...');
    const migrationResult = await scanForMigrations();
    
    // Step 2: Run actor intelligence analysis on wallets with migrations
    console.log('[Bridge Scan] Starting actor intelligence analysis...');
    const actorResult = await scanActors(7, 50);
    
    const duration = Date.now() - startTime;
    
    const result: BridgeScanResult = {
      scanned: migrationResult.scanned,
      detected: migrationResult.detected,
      actorsAnalyzed: actorResult.scanned,
      actorEvents: actorResult.events,
      duration,
      timestamp: new Date(),
    };
    
    lastScanResult = result;
    
    console.log(
      `[Bridge Scan] Complete: ${result.scanned} events scanned, ` +
      `${result.detected} migrations detected, ` +
      `${result.actorsAnalyzed} actors analyzed, ` +
      `${result.actorEvents} actor events (${duration}ms)`
    );
    
    return result;
  } catch (err) {
    console.error('[Bridge Scan] Error:', err);
    throw err;
  } finally {
    scanRunning = false;
  }
}

/**
 * Get bridge scan status
 */
export async function getBridgeScanStatus(): Promise<{
  running: boolean;
  lastScan: BridgeScanResult | null;
  stats: {
    totalMigrations: number;
    last24h: number;
    avgConfidence: number;
  } | null;
}> {
  try {
    const stats = await getMigrationStats();
    
    return {
      running: scanRunning,
      lastScan: lastScanResult,
      stats: {
        totalMigrations: stats.total,
        last24h: stats.last24h,
        avgConfidence: stats.avgConfidence,
      },
    };
  } catch (err) {
    console.error('[Bridge Scan] Status error:', err);
    return {
      running: scanRunning,
      lastScan: lastScanResult,
      stats: null,
    };
  }
}
