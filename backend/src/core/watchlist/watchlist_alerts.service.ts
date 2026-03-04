/**
 * Watchlist → Alerts Integration Service
 * 
 * Automatically converts watchlist_events → system_alerts
 * 
 * Severity mapping:
 * - ACCUMULATION → MEDIUM
 * - DISTRIBUTION → MEDIUM/HIGH (by volume)
 * - LARGE_TRANSFER → HIGH
 * - BRIDGE_IN / BRIDGE_OUT → HIGH
 * - ACTOR_ACTIVITY → LOW
 * 
 * Features:
 * - Idempotency: 1 event = 1 alert (no duplicates)
 * - Telegram for HIGH/CRITICAL
 * - Entity reference linking
 */
import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  SystemAlertModel,
  ISystemAlert,
  SystemAlertType,
  AlertSeverity,
  ALERT_CATEGORY_MAP,
  ALERT_SOURCE_MAP,
  ALERT_DEFAULT_SEVERITY,
} from '../system_alerts/system_alert.model.js';
import {
  WatchlistEventModel,
  IWatchlistEvent,
  WatchlistEventType,
} from './watchlist_event.model.js';
import {
  WatchlistItemModel,
  IWatchlistItem,
} from './watchlist.model.js';
import { sendTelegramMessage, TelegramConnectionModel } from '../notifications/telegram.service.js';
import { TelegramLinkModel } from '../d1_signals/d1_telegram_link.service.js';

// Telegram notification thresholds
const TELEGRAM_SEVERITY_THRESHOLD: AlertSeverity[] = ['HIGH', 'CRITICAL'];

// Event type to alert type mapping
const EVENT_TO_ALERT_TYPE: Record<WatchlistEventType, SystemAlertType> = {
  'ACCUMULATION': 'WATCHLIST_ACCUMULATION',
  'DISTRIBUTION': 'WATCHLIST_DISTRIBUTION',
  'LARGE_TRANSFER': 'WATCHLIST_LARGE_TRANSFER',
  'BRIDGE_IN': 'WATCHLIST_BRIDGE_IN',
  'BRIDGE_OUT': 'WATCHLIST_BRIDGE_OUT',
  'ACTOR_ACTIVITY': 'WATCHLIST_ACTOR_ACTIVITY',
};

// Get severity based on event type and metadata
function getSeverityForEvent(event: IWatchlistEvent): AlertSeverity {
  const baseType = EVENT_TO_ALERT_TYPE[event.eventType];
  const baseSeverity = ALERT_DEFAULT_SEVERITY[baseType];
  
  // Adjust severity based on event severity field
  if (event.severity === 'HIGH') {
    // For HIGH events, check if should be CRITICAL (e.g., confirmed bridges)
    if (event.eventType === 'BRIDGE_IN' || event.eventType === 'BRIDGE_OUT') {
      if (event.metadata?.confirmed) {
        return 'CRITICAL';
      }
    }
    return 'HIGH';
  }
  
  if (event.severity === 'MEDIUM') {
    return 'MEDIUM';
  }
  
  return baseSeverity;
}

// Generate alert title based on event
function generateAlertTitle(event: IWatchlistEvent, item?: IWatchlistItem): string {
  const entityName = item?.target?.symbol || item?.target?.name || 
    (item?.target?.address ? `${item.target.address.slice(0, 6)}...` : 'Unknown');
  
  switch (event.eventType) {
    case 'ACCUMULATION':
      return `Accumulation Pattern: ${entityName}`;
    case 'DISTRIBUTION':
      return `Distribution Pattern: ${entityName}`;
    case 'LARGE_TRANSFER':
      return `Large Transfer: ${entityName}`;
    case 'BRIDGE_IN':
      return `Bridge In: ${entityName} (${event.chainFrom} → ${event.chain})`;
    case 'BRIDGE_OUT':
      return `Bridge Out: ${entityName} (${event.chain} → ${event.chainTo})`;
    case 'ACTOR_ACTIVITY':
      return `Actor Activity Spike: ${entityName}`;
    default:
      return `Watchlist Event: ${entityName}`;
  }
}

// Generate alert message
function generateAlertMessage(event: IWatchlistEvent, item?: IWatchlistItem): string {
  const entityType = item?.type?.toUpperCase() || 'ITEM';
  let message = event.description || event.title;
  
  // Add value info if available
  if (event.metadata?.valueUsd) {
    const valueFormatted = new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(event.metadata.valueUsd);
    message += ` Value: ${valueFormatted}.`;
  }
  
  // Add percent change if available
  if (event.metadata?.percentChange) {
    const sign = event.metadata.percentChange > 0 ? '+' : '';
    message += ` Change: ${sign}${event.metadata.percentChange}%.`;
  }
  
  return message;
}

/**
 * Create alert from watchlist event
 * Idempotent: checks for existing alert by watchlistEventId
 */
export async function createAlertFromWatchlistEvent(
  event: IWatchlistEvent
): Promise<ISystemAlert | null> {
  // Check if alert already exists for this event
  const existingAlert = await SystemAlertModel.findOne({
    watchlistEventId: event._id.toString(),
  });
  
  if (existingAlert) {
    console.log(`[WatchlistAlerts] Alert already exists for event ${event._id}`);
    return existingAlert;
  }
  
  // Get watchlist item for entity reference
  const item = await WatchlistItemModel.findById(event.watchlistItemId);
  
  const alertType = EVENT_TO_ALERT_TYPE[event.eventType];
  const severity = getSeverityForEvent(event);
  const category = ALERT_CATEGORY_MAP[alertType];
  const source = ALERT_SOURCE_MAP[alertType];
  
  const alertId = `alert_wl_${uuidv4()}`;
  
  const alert = await SystemAlertModel.create({
    alertId,
    type: alertType,
    category,
    source,
    severity,
    title: generateAlertTitle(event, item || undefined),
    message: generateAlertMessage(event, item || undefined),
    metadata: {
      ...event.metadata,
      watchlistEventType: event.eventType,
      watchlistItemId: event.watchlistItemId?.toString(),
    },
    status: 'OPEN',
    chain: event.chain,
    entityRef: item ? {
      entityType: item.type.toUpperCase() as 'TOKEN' | 'WALLET' | 'ACTOR',
      entityId: item._id.toString(),
      address: item.target?.address,
      chain: item.target?.chain,
      label: item.target?.symbol || item.target?.name,
    } : undefined,
    watchlistEventId: event._id.toString(),
    firstSeenAt: event.timestamp,
    lastSeenAt: event.timestamp,
    telegramSent: false,
  });
  
  console.log(`[WatchlistAlerts] Created alert ${alertId} [${severity}] from event ${event._id}`);
  
  // Send Telegram notification for HIGH/CRITICAL
  if (TELEGRAM_SEVERITY_THRESHOLD.includes(severity)) {
    await sendWatchlistAlertToTelegram(alert, item || undefined);
  }
  
  return alert;
}

/**
 * Send Telegram notification for watchlist alert
 */
async function sendWatchlistAlertToTelegram(
  alert: ISystemAlert,
  item?: IWatchlistItem
): Promise<void> {
  try {
    // Get all linked telegram connections
    const links = await TelegramLinkModel.find({ linked: true });
    const connections = await TelegramConnectionModel.find({ active: true });
    
    const chatIds = [
      ...links.map(l => l.chatId),
      ...connections.map(c => c.chatId),
    ].filter(Boolean);
    
    if (chatIds.length === 0) {
      console.log('[WatchlistAlerts] No Telegram recipients for alert');
      return;
    }
    
    // Build message
    const severityEmoji = alert.severity === 'CRITICAL' ? '🚨' : '⚠️';
    const typeEmoji = getTypeEmoji(alert.entityRef?.entityType);
    
    const message = [
      `${severityEmoji} *WATCHLIST ALERT*`,
      '',
      `*${alert.title}*`,
      '',
      alert.message,
      '',
      `${typeEmoji} Entity: ${alert.entityRef?.label || alert.entityRef?.address || 'Unknown'}`,
      `⛓ Chain: ${alert.chain || 'ETH'}`,
      `📊 Severity: ${alert.severity}`,
      '',
      `View in app: /alerts`,
    ].join('\n');
    
    // Send to all recipients (deduped)
    const uniqueChatIds = [...new Set(chatIds)];
    
    for (const chatId of uniqueChatIds) {
      await sendTelegramMessage(chatId.toString(), message);
    }
    
    // Update alert
    await SystemAlertModel.updateOne(
      { _id: alert._id },
      { telegramSent: true, telegramSentAt: new Date() }
    );
    
    console.log(`[WatchlistAlerts] Sent Telegram notification for ${alert.alertId} to ${uniqueChatIds.length} recipients`);
  } catch (err) {
    console.error('[WatchlistAlerts] Failed to send Telegram:', err);
  }
}

function getTypeEmoji(entityType?: string): string {
  switch (entityType) {
    case 'TOKEN': return '🪙';
    case 'WALLET': return '👛';
    case 'ACTOR': return '👥';
    default: return '📍';
  }
}

/**
 * Process all unprocessed watchlist events and create alerts
 * Useful for batch processing or recovery
 */
export async function processUnprocessedWatchlistEvents(): Promise<number> {
  // Get all event IDs that already have alerts
  const existingAlertEventIds = await SystemAlertModel.distinct('watchlistEventId', {
    watchlistEventId: { $exists: true, $ne: null },
  });
  
  // Find events without alerts
  const unprocessedEvents = await WatchlistEventModel.find({
    _id: { $nin: existingAlertEventIds.map(id => new Types.ObjectId(id)) },
  }).sort({ timestamp: -1 }).limit(100);
  
  let processed = 0;
  
  for (const event of unprocessedEvents) {
    await createAlertFromWatchlistEvent(event);
    processed++;
  }
  
  console.log(`[WatchlistAlerts] Processed ${processed} unprocessed events`);
  return processed;
}

/**
 * Resolve alert when watchlist event is acknowledged
 */
export async function resolveAlertOnEventAck(eventId: string): Promise<boolean> {
  const result = await SystemAlertModel.updateOne(
    { watchlistEventId: eventId, status: { $ne: 'RESOLVED' } },
    { 
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedBy: 'watchlist_ack',
    }
  );
  
  return result.modifiedCount > 0;
}

/**
 * Sync watchlist events with alerts
 * Call this on startup or periodically
 */
export async function syncWatchlistAlerts(): Promise<{ created: number; existing: number }> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
  
  const events = await WatchlistEventModel.find({
    timestamp: { $gte: since },
  });
  
  let created = 0;
  let existing = 0;
  
  for (const event of events) {
    const existingAlert = await SystemAlertModel.findOne({
      watchlistEventId: event._id.toString(),
    });
    
    if (existingAlert) {
      existing++;
    } else {
      await createAlertFromWatchlistEvent(event);
      created++;
    }
  }
  
  console.log(`[WatchlistAlerts] Sync complete: ${created} created, ${existing} existing`);
  return { created, existing };
}
