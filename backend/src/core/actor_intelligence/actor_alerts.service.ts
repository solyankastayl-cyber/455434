/**
 * Actor Events → System Alerts Integration Service
 * 
 * Automatically converts actor_events → system_alerts
 * 
 * Severity mapping:
 * - NEW_STRATEGIC_ACTOR → HIGH (new strategic player detected)
 * - REPEAT_BRIDGE_PATTERN → MEDIUM
 * - ROUTE_DOMINANCE → MEDIUM
 * - LIQUIDITY_ESCALATION → HIGH (size anomaly)
 * - MULTI_CHAIN_PRESENCE → LOW (informational)
 * - STRATEGIC_TIMING → HIGH (potential manipulation)
 * 
 * Features:
 * - Idempotency: 1 actor_event = 1 system_alert
 * - Telegram for HIGH/CRITICAL
 * - Actor profile linking
 */
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import {
  SystemAlertModel,
  ISystemAlert,
  SystemAlertType,
  AlertSeverity,
} from '../system_alerts/system_alert.model.js';
import {
  IActorEvent,
  ActorEventType,
  ActorEventModel,
} from './actor_event.model.js';
import { sendTelegramMessage } from '../notifications/telegram.service.js';
import { TelegramLinkModel } from '../d1_signals/d1_telegram_link.service.js';

// Telegram notification thresholds
const TELEGRAM_SEVERITY_THRESHOLD: AlertSeverity[] = ['HIGH', 'CRITICAL'];

// Actor event type to alert type mapping
const ACTOR_EVENT_TO_ALERT_TYPE: Record<ActorEventType, SystemAlertType> = {
  'REPEAT_BRIDGE_PATTERN': 'ACTOR_REPEAT_BRIDGE',
  'ROUTE_DOMINANCE': 'ACTOR_ROUTE_DOMINANCE',
  'LIQUIDITY_ESCALATION': 'ACTOR_LIQUIDITY_ESCALATION',
  'MULTI_CHAIN_PRESENCE': 'ACTOR_MULTI_CHAIN',
  'STRATEGIC_TIMING': 'ACTOR_STRATEGIC_TIMING',
  'NEW_STRATEGIC_ACTOR': 'ACTOR_NEW_STRATEGIC',
};

// Severity mapping for actor events
const ACTOR_EVENT_SEVERITY: Record<ActorEventType, AlertSeverity> = {
  'REPEAT_BRIDGE_PATTERN': 'MEDIUM',
  'ROUTE_DOMINANCE': 'MEDIUM',
  'LIQUIDITY_ESCALATION': 'HIGH',
  'MULTI_CHAIN_PRESENCE': 'LOW',
  'STRATEGIC_TIMING': 'HIGH',
  'NEW_STRATEGIC_ACTOR': 'HIGH',
};

// Get severity based on event type and confidence
function getSeverityForActorEvent(event: IActorEvent): AlertSeverity {
  const baseSeverity = ACTOR_EVENT_SEVERITY[event.type];
  
  // Upgrade to HIGH for high confidence events
  if (event.confidence >= 0.8 && baseSeverity === 'MEDIUM') {
    return 'HIGH';
  }
  
  // Upgrade to CRITICAL for very high confidence strategic events
  if (event.confidence >= 0.9 && 
      (event.type === 'NEW_STRATEGIC_ACTOR' || event.type === 'STRATEGIC_TIMING')) {
    return 'CRITICAL';
  }
  
  // Use event's own severity if higher
  if (event.severity === 'HIGH' && baseSeverity !== 'CRITICAL') {
    return 'HIGH';
  }
  
  return baseSeverity;
}

// Generate alert title based on actor event
function generateAlertTitle(event: IActorEvent): string {
  const shortAddr = `${event.actorAddress.slice(0, 6)}...${event.actorAddress.slice(-4)}`;
  
  switch (event.type) {
    case 'NEW_STRATEGIC_ACTOR':
      return `🎯 Strategic Actor Detected: ${shortAddr}`;
    case 'REPEAT_BRIDGE_PATTERN':
      return `🔄 Repeat Bridge Pattern: ${shortAddr}`;
    case 'ROUTE_DOMINANCE':
      return `📊 Route Dominance: ${shortAddr}`;
    case 'LIQUIDITY_ESCALATION':
      return `📈 Liquidity Escalation: ${shortAddr}`;
    case 'MULTI_CHAIN_PRESENCE':
      return `🌐 Multi-Chain Actor: ${shortAddr}`;
    case 'STRATEGIC_TIMING':
      return `⏱️ Strategic Timing: ${shortAddr}`;
    default:
      return `Actor Pattern: ${shortAddr}`;
  }
}

// Generate alert message
function generateAlertMessage(event: IActorEvent, profileData?: any): string {
  const confidence = (event.confidence * 100).toFixed(0);
  let msg = event.explanation;
  
  if (profileData) {
    msg += `. Volume: $${(profileData.totalVolumeUsd / 1000).toFixed(0)}K`;
    msg += `, ${profileData.totalMigrations} migrations`;
    msg += `, ${profileData.chainsUsed?.length || 0} chains`;
  }
  
  msg += `. Confidence: ${confidence}%`;
  
  return msg;
}

// Helper to get ActorProfile model lazily to avoid circular imports
function getActorProfileModel() {
  return mongoose.models.ActorIntelProfile || mongoose.model('ActorIntelProfile');
}

/**
 * Create a system alert from an actor event
 */
export async function createAlertFromActorEvent(
  event: IActorEvent
): Promise<ISystemAlert | null> {
  // Check if alert already exists for this event
  const existingAlert = await SystemAlertModel.findOne({
    'metadata.actorEventId': event.eventId,
  });
  
  if (existingAlert) {
    console.log(`[ActorAlerts] Alert already exists for event ${event.eventId}`);
    return null;
  }
  
  // Get actor profile for additional context (lazy load to avoid circular import)
  let profile: any = null;
  try {
    const ActorProfileModel = getActorProfileModel();
    profile = await ActorProfileModel.findOne({ actorId: event.actorId }).lean();
  } catch (err) {
    console.log('[ActorAlerts] Could not fetch actor profile, continuing without it');
  }
  
  const alertId = `alert_${uuidv4()}`;
  const alertType = ACTOR_EVENT_TO_ALERT_TYPE[event.type] || 'ACTOR_NEW_STRATEGIC';
  const severity = getSeverityForActorEvent(event);
  
  const alert = await SystemAlertModel.create({
    alertId,
    type: alertType,
    category: 'ACTOR',
    source: 'actor_intelligence',
    severity,
    title: generateAlertTitle(event),
    message: generateAlertMessage(event, profile || undefined),
    metadata: {
      actorEventId: event.eventId,
      actorId: event.actorId,
      actorAddress: event.actorAddress,
      eventType: event.type,
      confidence: event.confidence,
      relatedChains: event.relatedChains,
      relatedMigrations: event.relatedMigrations,
      patternMetadata: event.metadata,
      profileSnapshot: profile ? {
        confidenceScore: profile.confidenceScore,
        confidenceLevel: profile.confidenceLevel,
        totalMigrations: profile.totalMigrations,
        totalVolumeUsd: profile.totalVolumeUsd,
        chainsUsed: profile.chainsUsed,
        dominantRoutes: profile.dominantRoutes?.slice(0, 3),
      } : null,
    },
    status: 'OPEN',
    entityRef: {
      entityType: 'ACTOR',
      entityId: event.actorId,
      address: event.actorAddress,
    },
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    telegramSent: false,
  });
  
  console.log(`[ActorAlerts] Created alert ${alertId} for actor event ${event.eventId} [${severity}]`);
  
  // Send Telegram notification for HIGH/CRITICAL
  if (TELEGRAM_SEVERITY_THRESHOLD.includes(severity)) {
    await sendTelegramNotification(alert);
  }
  
  return alert;
}

/**
 * Send Telegram notification for alert
 */
async function sendTelegramNotification(alert: ISystemAlert): Promise<void> {
  try {
    // Get all linked Telegram users
    const links = await TelegramLinkModel.find({});
    
    if (links.length === 0) {
      console.log('[ActorAlerts] No Telegram links found');
      return;
    }
    
    const severityEmoji = alert.severity === 'CRITICAL' ? '🚨' : '⚠️';
    const message = `${severityEmoji} *Actor Intelligence Alert*\n\n` +
      `*Type:* ${alert.type}\n` +
      `*Severity:* ${alert.severity}\n\n` +
      `${alert.title}\n\n` +
      `${alert.message}\n\n` +
      `_AI-ON Actor Intelligence_`;
    
    for (const link of links) {
      try {
        await sendTelegramMessage(link.chatId, message);
        console.log(`[ActorAlerts] Telegram sent to ${link.chatId}`);
      } catch (err) {
        console.error(`[ActorAlerts] Failed to send Telegram to ${link.chatId}:`, err);
      }
    }
    
    // Mark alert as sent
    await SystemAlertModel.updateOne(
      { alertId: alert.alertId },
      { telegramSent: true, telegramSentAt: new Date() }
    );
  } catch (err) {
    console.error('[ActorAlerts] Telegram notification failed:', err);
  }
}

/**
 * Sync all recent actor events to system alerts
 */
export async function syncActorAlerts(
  windowHours = 24
): Promise<{ synced: number; skipped: number }> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  
  // Get recent actor events without corresponding alerts
  const events = await ActorEventModel.find({
    timestamp: { $gte: since },
  }).sort({ timestamp: -1 });
  
  let synced = 0;
  let skipped = 0;
  
  for (const event of events) {
    const alert = await createAlertFromActorEvent(event);
    if (alert) {
      synced++;
    } else {
      skipped++;
    }
  }
  
  console.log(`[ActorAlerts] Synced ${synced} alerts, skipped ${skipped}`);
  return { synced, skipped };
}

/**
 * Get actor-related alerts
 */
export async function getActorAlerts(filters?: {
  actorId?: string;
  severity?: AlertSeverity;
  limit?: number;
}): Promise<ISystemAlert[]> {
  const query: any = {
    source: 'actor_intelligence',
  };
  
  if (filters?.actorId) {
    query['metadata.actorId'] = filters.actorId;
  }
  if (filters?.severity) {
    query.severity = filters.severity;
  }
  
  return SystemAlertModel.find(query)
    .sort({ createdAt: -1 })
    .limit(filters?.limit || 50);
}
