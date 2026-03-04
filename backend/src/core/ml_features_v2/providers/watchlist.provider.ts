/**
 * Watchlist Feature Provider (P0.6)
 * 
 * Extracts ML features from Watchlist module.
 */

import {
  ProviderContext,
  ProviderResult,
  WatchlistFeatureKey,
  FeatureValue
} from '../types/feature.types.js';
import { WatchlistItemModel } from '../../watchlist/watchlist.model.js';
import { SystemAlertModel } from '../../system_alerts/system_alert.model.js';

// ============================================
// Types
// ============================================

export type WatchlistFeatures = Partial<Record<WatchlistFeatureKey, FeatureValue>>;

// Severity mapping
const SEVERITY_MAP: Record<string, number> = {
  'INFO': 0,
  'LOW': 1,
  'MEDIUM': 2,
  'HIGH': 3,
  'CRITICAL': 3
};

// ============================================
// Watchlist Provider
// ============================================

export async function extractWatchlistFeatures(
  ctx: ProviderContext
): Promise<ProviderResult<WatchlistFeatures>> {
  const startTime = Date.now();
  const errors: string[] = [];
  const features: WatchlistFeatures = {};
  
  try {
    // Check if entity is on watchlist
    const watchlistItem = await WatchlistItemModel.findOne({
      'target.address': { $regex: new RegExp(`^${ctx.entityId}$`, 'i') }
    }).lean();
    
    features.watchlist_isTracked = !!watchlistItem;
    
    if (!watchlistItem) {
      // Not on watchlist
      features.watchlist_alertCount = 0;
      features.watchlist_lastAlertSeverity = null;
      features.watchlist_trackingSince = null;
      
      return {
        features,
        source: 'WATCHLIST',
        timestamp: new Date(),
        errors: [],
        durationMs: Date.now() - startTime
      };
    }
    
    // Get alerts for this entity
    const alerts = await SystemAlertModel.find({
      $or: [
        { 'entityRef.address': { $regex: new RegExp(`^${ctx.entityId}$`, 'i') } },
        { 'entityRef.entityId': watchlistItem._id?.toString() }
      ],
      createdAt: {
        $gte: ctx.windowStart,
        $lte: ctx.windowEnd
      }
    })
    .sort({ createdAt: -1 })
    .lean();
    
    features.watchlist_alertCount = alerts.length;
    
    // Last alert severity
    if (alerts.length > 0) {
      const lastAlert = alerts[0];
      features.watchlist_lastAlertSeverity = SEVERITY_MAP[lastAlert.severity] ?? 0;
    } else {
      features.watchlist_lastAlertSeverity = null;
    }
    
    // Days since added to watchlist
    if (watchlistItem.createdAt) {
      const addedAt = new Date(watchlistItem.createdAt);
      const daysSince = Math.floor((Date.now() - addedAt.getTime()) / (24 * 60 * 60 * 1000));
      features.watchlist_trackingSince = daysSince;
    } else {
      features.watchlist_trackingSince = null;
    }
    
  } catch (err) {
    errors.push(`Watchlist provider error: ${(err as Error).message}`);
    return {
      features: createNullWatchlistFeatures(),
      source: 'WATCHLIST',
      timestamp: new Date(),
      errors,
      durationMs: Date.now() - startTime
    };
  }
  
  return {
    features,
    source: 'WATCHLIST',
    timestamp: new Date(),
    errors,
    durationMs: Date.now() - startTime
  };
}

// ============================================
// Helpers
// ============================================

function createNullWatchlistFeatures(): WatchlistFeatures {
  return {
    watchlist_isTracked: false,
    watchlist_alertCount: null,
    watchlist_lastAlertSeverity: null,
    watchlist_trackingSince: null
  };
}

/**
 * Get feature count for watchlist
 */
export function getWatchlistFeatureCount(): number {
  return 4;
}
