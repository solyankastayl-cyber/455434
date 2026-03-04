/**
 * Bridge Detection Service
 * 
 * Detects cross-chain liquidity migrations by correlating watchlist events
 * 
 * Bridge Match Rule (MVP):
 * - Same wallet
 * - Different chains
 * - Token match (or wrapped equivalent)
 * - Amount similarity ≤ 3%
 * - Time window ≤ 15 minutes
 * 
 * Confidence Score = 
 *   amount_similarity * 0.5 +
 *   time_proximity * 0.3 +
 *   token_match * 0.2
 */
import { v4 as uuidv4 } from 'uuid';
import {
  BridgeMigrationModel,
  IBridgeMigration,
  migrationExistsForEvents,
} from './bridge_migration.model.js';
import {
  WatchlistEventModel,
  IWatchlistEvent,
  createWatchlistEvent,
  WatchlistEventType,
} from '../watchlist/watchlist_event.model.js';
import {
  WatchlistItemModel,
} from '../watchlist/watchlist.model.js';
import {
  createAlertFromWatchlistEvent,
} from '../watchlist/watchlist_alerts.service.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Time window for matching events (in seconds)
const MAX_TIME_WINDOW_SECONDS = 15 * 60; // 15 minutes

// Amount similarity threshold (percentage)
const MAX_AMOUNT_DELTA_PCT = 3; // 3%

// Minimum confidence for detection
const MIN_CONFIDENCE_THRESHOLD = 0.7;

// Supported chains
const SUPPORTED_CHAINS = ['ETH', 'ARB', 'BASE', 'OP', 'POLYGON', 'BNB'];

// Token normalization (wrapped equivalents)
const TOKEN_EQUIVALENTS: Record<string, string> = {
  'ETH': 'ETH',
  'WETH': 'ETH',
  'USDC': 'USDC',
  'USDC.e': 'USDC',
  'USDbC': 'USDC',
  'USDT': 'USDT',
  'DAI': 'DAI',
};

// Event types that indicate bridge activity
const BRIDGE_EVENT_TYPES: WatchlistEventType[] = [
  'BRIDGE_IN',
  'BRIDGE_OUT',
  'LARGE_TRANSFER',
];

// ============================================================================
// CORE DETECTION LOGIC
// ============================================================================

/**
 * Normalize token symbol
 */
function normalizeToken(token: string): string {
  const upper = token?.toUpperCase() || '';
  return TOKEN_EQUIVALENTS[upper] || upper;
}

/**
 * Check if two events can be a bridge pair
 */
function canBeBridgePair(eventA: IWatchlistEvent, eventB: IWatchlistEvent): boolean {
  // Must be different chains
  if (eventA.chain === eventB.chain) return false;
  
  // Must have wallet/address info in metadata
  const walletA = eventA.metadata?.wallet || eventA.metadata?.from || eventA.metadata?.address;
  const walletB = eventB.metadata?.wallet || eventB.metadata?.from || eventB.metadata?.address;
  
  // If we can identify wallets, they must match
  // But for watchlist items, they're already on the same item = same entity
  
  // Must have amount info
  const amountA = eventA.metadata?.valueUsd || eventA.metadata?.amount || 0;
  const amountB = eventB.metadata?.valueUsd || eventB.metadata?.amount || 0;
  
  if (!amountA || !amountB) return false;
  
  // Amount similarity check
  const deltaPct = Math.abs(amountA - amountB) / Math.max(amountA, amountB) * 100;
  if (deltaPct > MAX_AMOUNT_DELTA_PCT) return false;
  
  // Time window check
  const timeA = new Date(eventA.timestamp).getTime();
  const timeB = new Date(eventB.timestamp).getTime();
  const windowSeconds = Math.abs(timeA - timeB) / 1000;
  if (windowSeconds > MAX_TIME_WINDOW_SECONDS) return false;
  
  // Token match (if available)
  const tokenA = eventA.metadata?.token || eventA.metadata?.symbol || '';
  const tokenB = eventB.metadata?.token || eventB.metadata?.symbol || '';
  
  if (tokenA && tokenB) {
    if (normalizeToken(tokenA) !== normalizeToken(tokenB)) return false;
  }
  
  return true;
}

/**
 * Calculate confidence score for a bridge migration
 */
function calculateConfidence(
  eventA: IWatchlistEvent,
  eventB: IWatchlistEvent
): { confidence: number; factors: { amountSimilarity: number; timeProximity: number; tokenMatch: number } } {
  const amountA = eventA.metadata?.valueUsd || eventA.metadata?.amount || 0;
  const amountB = eventB.metadata?.valueUsd || eventB.metadata?.amount || 0;
  
  // Amount similarity (0-1): 1.0 = exact match, 0.0 = 3% diff
  const deltaPct = Math.abs(amountA - amountB) / Math.max(amountA, amountB) * 100;
  const amountSimilarity = Math.max(0, 1 - (deltaPct / MAX_AMOUNT_DELTA_PCT));
  
  // Time proximity (0-1): 1.0 = same time, 0.0 = 15 min apart
  const timeA = new Date(eventA.timestamp).getTime();
  const timeB = new Date(eventB.timestamp).getTime();
  const windowSeconds = Math.abs(timeA - timeB) / 1000;
  const timeProximity = Math.max(0, 1 - (windowSeconds / MAX_TIME_WINDOW_SECONDS));
  
  // Token match (0 or 1)
  const tokenA = eventA.metadata?.token || eventA.metadata?.symbol || '';
  const tokenB = eventB.metadata?.token || eventB.metadata?.symbol || '';
  const tokenMatch = (!tokenA || !tokenB || normalizeToken(tokenA) === normalizeToken(tokenB)) ? 1 : 0;
  
  // Weighted confidence
  const confidence = 
    amountSimilarity * 0.5 +
    timeProximity * 0.3 +
    tokenMatch * 0.2;
  
  return {
    confidence: Math.round(confidence * 100) / 100, // Round to 2 decimals
    factors: {
      amountSimilarity: Math.round(amountSimilarity * 100) / 100,
      timeProximity: Math.round(timeProximity * 100) / 100,
      tokenMatch,
    },
  };
}

/**
 * Determine direction (which is OUT, which is IN)
 */
function determineDirection(
  eventA: IWatchlistEvent,
  eventB: IWatchlistEvent
): { outEvent: IWatchlistEvent; inEvent: IWatchlistEvent } {
  // BRIDGE_OUT is always the source
  if (eventA.eventType === 'BRIDGE_OUT') {
    return { outEvent: eventA, inEvent: eventB };
  }
  if (eventB.eventType === 'BRIDGE_OUT') {
    return { outEvent: eventB, inEvent: eventA };
  }
  
  // For LARGE_TRANSFER, earlier is OUT
  const timeA = new Date(eventA.timestamp).getTime();
  const timeB = new Date(eventB.timestamp).getTime();
  
  if (timeA <= timeB) {
    return { outEvent: eventA, inEvent: eventB };
  }
  return { outEvent: eventB, inEvent: eventA };
}

/**
 * Create bridge migration from matched events
 */
async function createBridgeMigration(
  outEvent: IWatchlistEvent,
  inEvent: IWatchlistEvent,
  confidence: number,
  confidenceFactors: { amountSimilarity: number; timeProximity: number; tokenMatch: number }
): Promise<IBridgeMigration> {
  const migrationId = `mig_${uuidv4()}`;
  
  const amountFrom = outEvent.metadata?.valueUsd || outEvent.metadata?.amount || 0;
  const amountTo = inEvent.metadata?.valueUsd || inEvent.metadata?.amount || 0;
  const amountDeltaPct = ((amountTo - amountFrom) / amountFrom) * 100;
  
  const startedAt = new Date(outEvent.timestamp);
  const completedAt = new Date(inEvent.timestamp);
  const windowSeconds = Math.abs(completedAt.getTime() - startedAt.getTime()) / 1000;
  
  const token = outEvent.metadata?.token || outEvent.metadata?.symbol || 'UNKNOWN';
  
  // Get wallet from watchlist item
  const watchlistItem = await WatchlistItemModel.findById(outEvent.watchlistItemId);
  const wallet = watchlistItem?.target?.address || outEvent.metadata?.wallet || 'unknown';
  
  const migration = await BridgeMigrationModel.create({
    migrationId,
    wallet,
    actorId: watchlistItem?.type === 'actor' ? watchlistItem._id.toString() : undefined,
    token,
    tokenNormalized: normalizeToken(token),
    fromChain: outEvent.chain || outEvent.chainFrom || 'ETH',
    toChain: inEvent.chain || inEvent.chainTo || 'ETH',
    amountFrom,
    amountTo,
    amountDeltaPct: Math.round(amountDeltaPct * 100) / 100,
    startedAt,
    completedAt,
    windowSeconds: Math.round(windowSeconds),
    confidence,
    confidenceFactors,
    sourceEventIds: [outEvent._id.toString(), inEvent._id.toString()],
    sourceEventTypes: [outEvent.eventType, inEvent.eventType],
    status: 'DETECTED',
  });
  
  console.log(`[BridgeDetection] Created migration ${migrationId}: ${migration.fromChain} → ${migration.toChain}, confidence: ${confidence}`);
  
  return migration;
}

/**
 * Create watchlist event and alert for detected migration
 */
async function emitMigrationEvent(migration: IBridgeMigration): Promise<void> {
  // Get watchlist item from source event
  const sourceEvent = await WatchlistEventModel.findById(migration.sourceEventIds[0]);
  if (!sourceEvent) return;
  
  // Create watchlist event
  const event = await createWatchlistEvent({
    watchlistItemId: sourceEvent.watchlistItemId,
    eventType: 'BRIDGE_OUT' as WatchlistEventType, // Use BRIDGE_OUT for migration events
    severity: 'HIGH',
    chain: migration.fromChain,
    chainFrom: migration.fromChain,
    chainTo: migration.toChain,
    title: `Bridge Migration: ${migration.fromChain} → ${migration.toChain}`,
    description: `Liquidity migration detected. ${formatAmount(migration.amountFrom)} moved from ${migration.fromChain} to ${migration.toChain}. Confidence: ${(migration.confidence * 100).toFixed(0)}%`,
    metadata: {
      migrationId: migration.migrationId,
      token: migration.token,
      amountFrom: migration.amountFrom,
      amountTo: migration.amountTo,
      amountDeltaPct: migration.amountDeltaPct,
      windowSeconds: migration.windowSeconds,
      confidence: migration.confidence,
      wallet: migration.wallet,
      isBridgeMigration: true,
    },
    timestamp: migration.completedAt,
  });
  
  // Create system alert
  await createAlertFromWatchlistEvent(event);
  
  console.log(`[BridgeDetection] Emitted migration event and alert for ${migration.migrationId}`);
}

function formatAmount(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Scan for bridge migrations in recent events
 */
export async function scanForMigrations(
  windowMinutes = 60 // Look at events from last hour
): Promise<{ scanned: number; detected: number; migrations: IBridgeMigration[] }> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  
  // Get recent bridge-related events
  const events = await WatchlistEventModel.find({
    eventType: { $in: BRIDGE_EVENT_TYPES },
    timestamp: { $gte: since },
  }).sort({ timestamp: -1 });
  
  console.log(`[BridgeDetection] Scanning ${events.length} events from last ${windowMinutes} minutes`);
  
  const detectedMigrations: IBridgeMigration[] = [];
  const processedPairs = new Set<string>();
  
  // Get watchlist items for wallet matching
  const itemIds = [...new Set(events.map(e => e.watchlistItemId.toString()))];
  const items = await WatchlistItemModel.find({ _id: { $in: itemIds } });
  const itemMap = new Map(items.map(i => [i._id.toString(), i]));
  
  // Group events by wallet address (for cross-item matching)
  const eventsByWallet = new Map<string, IWatchlistEvent[]>();
  for (const event of events) {
    const item = itemMap.get(event.watchlistItemId.toString());
    const wallet = item?.target?.address?.toLowerCase() || event.metadata?.wallet?.toLowerCase() || '';
    
    if (wallet) {
      if (!eventsByWallet.has(wallet)) {
        eventsByWallet.set(wallet, []);
      }
      eventsByWallet.get(wallet)!.push(event);
    }
  }
  
  // Also group by watchlist item (same entity)
  const eventsByItem = new Map<string, IWatchlistEvent[]>();
  for (const event of events) {
    const itemId = event.watchlistItemId.toString();
    if (!eventsByItem.has(itemId)) {
      eventsByItem.set(itemId, []);
    }
    eventsByItem.get(itemId)!.push(event);
  }
  
  // Merge both groupings
  const allEventGroups = [...eventsByItem.values(), ...eventsByWallet.values()];
  
  // For each group, look for cross-chain pairs
  for (const itemEvents of allEventGroups) {
    if (itemEvents.length < 2) continue;
    
    // Try to match events on different chains
    for (let i = 0; i < itemEvents.length; i++) {
      for (let j = i + 1; j < itemEvents.length; j++) {
        const eventA = itemEvents[i];
        const eventB = itemEvents[j];
        
        // Create pair key for deduplication
        const pairKey = [eventA._id.toString(), eventB._id.toString()].sort().join('_');
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);
        
        // Check if can be bridge pair
        if (!canBeBridgePair(eventA, eventB)) continue;
        
        // Calculate confidence
        const { confidence, factors } = calculateConfidence(eventA, eventB);
        
        // Check minimum threshold
        if (confidence < MIN_CONFIDENCE_THRESHOLD) continue;
        
        // Check if migration already exists
        const eventIds = [eventA._id.toString(), eventB._id.toString()];
        if (await migrationExistsForEvents(eventIds)) {
          console.log(`[BridgeDetection] Migration already exists for events ${pairKey}`);
          continue;
        }
        
        // Determine direction
        const { outEvent, inEvent } = determineDirection(eventA, eventB);
        
        // Create migration
        const migration = await createBridgeMigration(outEvent, inEvent, confidence, factors);
        detectedMigrations.push(migration);
        
        // Emit event and alert
        await emitMigrationEvent(migration);
      }
    }
  }
  
  return {
    scanned: events.length,
    detected: detectedMigrations.length,
    migrations: detectedMigrations,
  };
}

/**
 * Check specific events for bridge match
 */
export async function matchEvents(
  eventIdA: string,
  eventIdB: string
): Promise<{ isMatch: boolean; confidence?: number; reason?: string }> {
  const eventA = await WatchlistEventModel.findById(eventIdA);
  const eventB = await WatchlistEventModel.findById(eventIdB);
  
  if (!eventA || !eventB) {
    return { isMatch: false, reason: 'Events not found' };
  }
  
  if (!canBeBridgePair(eventA, eventB)) {
    return { isMatch: false, reason: 'Events do not match bridge criteria' };
  }
  
  const { confidence } = calculateConfidence(eventA, eventB);
  
  if (confidence < MIN_CONFIDENCE_THRESHOLD) {
    return { isMatch: false, confidence, reason: `Confidence ${confidence} below threshold ${MIN_CONFIDENCE_THRESHOLD}` };
  }
  
  return { isMatch: true, confidence };
}

/**
 * Get migration statistics
 */
export async function getMigrationStats(): Promise<{
  total: number;
  last24h: number;
  byRoute: Array<{ from: string; to: string; count: number }>;
  avgConfidence: number;
}> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const [total, last24h, routeAgg, avgConfidenceAgg] = await Promise.all([
    BridgeMigrationModel.countDocuments(),
    BridgeMigrationModel.countDocuments({ createdAt: { $gte: since24h } }),
    BridgeMigrationModel.aggregate([
      { $group: { _id: { from: '$fromChain', to: '$toChain' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    BridgeMigrationModel.aggregate([
      { $group: { _id: null, avg: { $avg: '$confidence' } } },
    ]),
  ]);
  
  return {
    total,
    last24h,
    byRoute: routeAgg.map(r => ({ from: r._id.from, to: r._id.to, count: r.count })),
    avgConfidence: avgConfidenceAgg[0]?.avg || 0,
  };
}

/**
 * Seed test migrations (for development)
 */
export async function seedTestMigrations(): Promise<{ created: number }> {
  const now = new Date();
  
  // Get existing watchlist events
  const events = await WatchlistEventModel.find({
    eventType: { $in: ['BRIDGE_IN', 'BRIDGE_OUT'] },
  }).limit(4);
  
  if (events.length < 2) {
    console.log('[BridgeDetection] Not enough bridge events to seed');
    return { created: 0 };
  }
  
  // Create a test migration from existing events
  const testMigrations = [
    {
      migrationId: `mig_test_${Date.now()}_1`,
      wallet: '0x742d35cc6634c0532925a3b844bc454e4438f44e',
      token: 'USDC',
      tokenNormalized: 'USDC',
      fromChain: 'ETH',
      toChain: 'ARB',
      amountFrom: 1800000,
      amountTo: 1785000,
      amountDeltaPct: -0.83,
      startedAt: new Date(now.getTime() - 30 * 60 * 1000),
      completedAt: new Date(now.getTime() - 25 * 60 * 1000),
      windowSeconds: 300,
      confidence: 0.92,
      confidenceFactors: {
        amountSimilarity: 0.94,
        timeProximity: 0.89,
        tokenMatch: 1.0,
      },
      sourceEventIds: events.slice(0, 2).map(e => e._id.toString()),
      sourceEventTypes: ['BRIDGE_OUT', 'BRIDGE_IN'],
      status: 'DETECTED',
    },
  ];
  
  let created = 0;
  for (const migData of testMigrations) {
    const existing = await BridgeMigrationModel.findOne({ migrationId: migData.migrationId });
    if (!existing) {
      await BridgeMigrationModel.create(migData);
      created++;
    }
  }
  
  console.log(`[BridgeDetection] Seeded ${created} test migrations`);
  return { created };
}
