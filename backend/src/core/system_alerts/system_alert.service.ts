/**
 * System Alerts V2 - Service
 * 
 * Alert Generator Service that listens to real events:
 * - ML events (Kill Switch, Mode Change, Drift, Gates)
 * - System events (RPC, Indexer, Chain)
 * - Market events (Bridge, Liquidity)
 */
import { v4 as uuidv4 } from 'uuid';
import {
  SystemAlertModel,
  ISystemAlert,
  SystemAlertType,
  AlertSeverity,
  AlertStatus,
  AlertCategory,
  ALERT_CATEGORY_MAP,
  ALERT_SOURCE_MAP,
  ALERT_DEFAULT_SEVERITY,
} from './system_alert.model.js';
import { sendTelegramMessage, TelegramConnectionModel } from '../notifications/telegram.service.js';
import { TelegramLinkModel } from '../d1_signals/d1_telegram_link.service.js';

// Telegram notification thresholds
const TELEGRAM_SEVERITY_THRESHOLD: AlertSeverity[] = ['HIGH', 'CRITICAL'];

interface CreateAlertInput {
  type: SystemAlertType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  severity?: AlertSeverity;
  chain?: string;
}

interface AlertSummary {
  total: number;
  active: number;
  critical: number;
  resolved24h: number;
  byCategory: {
    SYSTEM: number;
    ML: number;
    MARKET: number;
  };
  bySeverity: {
    INFO: number;
    LOW: number;
    MEDIUM: number;
    HIGH: number;
    CRITICAL: number;
  };
}

interface AlertFilters {
  status?: AlertStatus;
  severity?: AlertSeverity;
  category?: AlertCategory;
  type?: SystemAlertType;
  source?: string;
  chain?: string;
  limit?: number;
  offset?: number;
}

class SystemAlertService {
  /**
   * Create a new system alert
   */
  async createAlert(input: CreateAlertInput): Promise<ISystemAlert> {
    const alertId = `alert_${uuidv4()}`;
    const category = ALERT_CATEGORY_MAP[input.type];
    const source = ALERT_SOURCE_MAP[input.type];
    const severity = input.severity || ALERT_DEFAULT_SEVERITY[input.type];

    const alert = await SystemAlertModel.create({
      alertId,
      type: input.type,
      category,
      source,
      severity,
      title: input.title,
      message: input.message,
      metadata: input.metadata || {},
      status: 'OPEN',
      chain: input.chain,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      telegramSent: false,
    });

    console.log(`[SystemAlerts] Created alert: ${alertId} [${severity}] ${input.type}`);

    // Send Telegram notification for HIGH/CRITICAL
    if (TELEGRAM_SEVERITY_THRESHOLD.includes(severity)) {
      await this.sendTelegramNotification(alert);
    }

    return alert;
  }

  /**
   * Get alerts with filters
   */
  async getAlerts(filters: AlertFilters = {}): Promise<ISystemAlert[]> {
    const query: any = {};

    if (filters.status) query.status = filters.status;
    if (filters.severity) query.severity = filters.severity;
    if (filters.category) query.category = filters.category;
    if (filters.type) query.type = filters.type;
    if (filters.source) query.source = filters.source;
    if (filters.chain) query.chain = filters.chain;

    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const alerts = await SystemAlertModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    // Remove _id from response
    return alerts.map(alert => {
      const { _id, ...rest } = alert as any;
      return rest;
    });
  }

  /**
   * Get alert summary stats
   */
  async getSummary(): Promise<AlertSummary> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get counts using aggregation
    const [stats] = await SystemAlertModel.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          active: [
            { $match: { status: 'OPEN' } },
            { $count: 'count' }
          ],
          critical: [
            { $match: { status: 'OPEN', severity: 'CRITICAL' } },
            { $count: 'count' }
          ],
          resolved24h: [
            { $match: { status: 'RESOLVED', resolvedAt: { $gte: twentyFourHoursAgo } } },
            { $count: 'count' }
          ],
          byCategory: [
            { $match: { status: 'OPEN' } },
            { $group: { _id: '$category', count: { $sum: 1 } } }
          ],
          bySeverity: [
            { $match: { status: 'OPEN' } },
            { $group: { _id: '$severity', count: { $sum: 1 } } }
          ],
        }
      }
    ]);

    // Parse aggregation results
    const byCategoryMap: Record<string, number> = {};
    const bySeverityMap: Record<string, number> = {};

    for (const cat of stats.byCategory) {
      byCategoryMap[cat._id] = cat.count;
    }
    for (const sev of stats.bySeverity) {
      bySeverityMap[sev._id] = sev.count;
    }

    return {
      total: stats.total[0]?.count || 0,
      active: stats.active[0]?.count || 0,
      critical: stats.critical[0]?.count || 0,
      resolved24h: stats.resolved24h[0]?.count || 0,
      byCategory: {
        SYSTEM: byCategoryMap['SYSTEM'] || 0,
        ML: byCategoryMap['ML'] || 0,
        MARKET: byCategoryMap['MARKET'] || 0,
      },
      bySeverity: {
        INFO: bySeverityMap['INFO'] || 0,
        LOW: bySeverityMap['LOW'] || 0,
        MEDIUM: bySeverityMap['MEDIUM'] || 0,
        HIGH: bySeverityMap['HIGH'] || 0,
        CRITICAL: bySeverityMap['CRITICAL'] || 0,
      },
    };
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: string, ackedBy: string = 'user'): Promise<boolean> {
    const result = await SystemAlertModel.updateOne(
      { alertId, status: 'OPEN' },
      {
        $set: {
          status: 'ACKED',
          ackedAt: new Date(),
          ackedBy,
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`[SystemAlerts] Alert acknowledged: ${alertId}`);
      return true;
    }
    return false;
  }

  /**
   * Resolve alert
   */
  async resolveAlert(alertId: string, resolvedBy: string = 'system'): Promise<boolean> {
    const result = await SystemAlertModel.updateOne(
      { alertId, status: { $ne: 'RESOLVED' } },
      {
        $set: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedBy,
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`[SystemAlerts] Alert resolved: ${alertId}`);
      return true;
    }
    return false;
  }

  /**
   * Auto-resolve related alerts when condition clears
   * e.g., resolve RPC_DEGRADED when RPC_RECOVERED is created
   */
  async autoResolveRelated(type: SystemAlertType): Promise<number> {
    const resolveMap: Partial<Record<SystemAlertType, SystemAlertType[]>> = {
      'RPC_RECOVERED': ['RPC_DEGRADED'],
      'CHAIN_RESUMED': ['CHAIN_PAUSED', 'CHAIN_LAG'],
      'INDEXER_RESUME': ['INDEXER_PAUSE'],
      'ML_GATE_PASS': ['ML_GATE_BLOCK'],
      'ML_KILL_RESET': ['ML_KILL_SWITCH'],
      'ML_DRIFT_NORMAL': ['ML_DRIFT_HIGH'],
    };

    const typesToResolve = resolveMap[type];
    if (!typesToResolve) return 0;

    const result = await SystemAlertModel.updateMany(
      { type: { $in: typesToResolve }, status: 'OPEN' },
      {
        $set: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedBy: 'auto',
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`[SystemAlerts] Auto-resolved ${result.modifiedCount} alerts for ${type}`);
    }

    return result.modifiedCount;
  }

  /**
   * Send Telegram notification for alert
   */
  private async sendTelegramNotification(alert: ISystemAlert): Promise<void> {
    try {
      // Get all active Telegram connections
      const [d1Links, legacyConnections] = await Promise.all([
        TelegramLinkModel.find({ isActive: true }).lean(),
        TelegramConnectionModel.find({ isActive: true }).lean(),
      ]);

      const chatIds = [
        ...new Set([
          ...d1Links.map((l: any) => l.telegramChatId),
          ...legacyConnections.map((c: any) => c.chatId),
        ])
      ];

      if (chatIds.length === 0) {
        console.log('[SystemAlerts] No Telegram recipients configured');
        return;
      }

      const message = this.formatTelegramMessage(alert);
      let successCount = 0;

      for (const chatId of chatIds) {
        const result = await sendTelegramMessage(chatId, message, { parseMode: 'HTML' });
        if (result.ok) successCount++;
      }

      // Update alert with Telegram status
      await SystemAlertModel.updateOne(
        { alertId: alert.alertId },
        {
          $set: {
            telegramSent: successCount > 0,
            telegramSentAt: new Date(),
          }
        }
      );

      console.log(`[SystemAlerts] Telegram sent to ${successCount}/${chatIds.length} recipients`);
    } catch (error) {
      console.error('[SystemAlerts] Telegram notification error:', error);
    }
  }

  /**
   * Format alert for Telegram
   */
  private formatTelegramMessage(alert: ISystemAlert): string {
    const severityEmoji = this.getSeverityEmoji(alert.severity);
    const categoryEmoji = this.getCategoryEmoji(alert.category);

    return `🚨 <b>SYSTEM ALERT</b>

${severityEmoji} <b>${alert.severity}</b> | ${categoryEmoji} ${alert.category}

<b>Type:</b> ${alert.type.replace(/_/g, ' ')}
<b>Title:</b> ${escapeHtml(alert.title)}

${escapeHtml(alert.message)}
${alert.chain ? `\n<b>Chain:</b> ${alert.chain}` : ''}
<b>Time:</b> ${alert.createdAt.toISOString().replace('T', ' ').slice(0, 19)} UTC

<i>This is an automated system notification.</i>`;
  }

  private getSeverityEmoji(severity: AlertSeverity): string {
    const map: Record<AlertSeverity, string> = {
      'INFO': 'ℹ️',
      'LOW': '🔵',
      'MEDIUM': '🟡',
      'HIGH': '🟠',
      'CRITICAL': '🔴',
    };
    return map[severity] || '⚪';
  }

  private getCategoryEmoji(category: AlertCategory): string {
    const map: Record<AlertCategory, string> = {
      'SYSTEM': '🖥️',
      'ML': '🧠',
      'MARKET': '📊',
    };
    return map[category] || '📋';
  }

  // ==================== EVENT GENERATORS ====================

  /**
   * ML Kill Switch triggered
   */
  async onMLKillSwitch(data: {
    reason: string;
    triggeredBy: string;
    flipRate?: number;
    ece?: number;
  }): Promise<ISystemAlert> {
    const alert = await this.createAlert({
      type: 'ML_KILL_SWITCH',
      title: 'ML Kill Switch Triggered',
      message: `ML system has been disabled. Reason: ${data.reason}`,
      metadata: {
        triggeredBy: data.triggeredBy,
        flipRate: data.flipRate,
        ece: data.ece,
      },
      severity: 'CRITICAL',
    });

    return alert;
  }

  /**
   * ML Kill Switch reset
   */
  async onMLKillReset(data: { triggeredBy: string }): Promise<ISystemAlert> {
    await this.autoResolveRelated('ML_KILL_RESET');

    return this.createAlert({
      type: 'ML_KILL_RESET',
      title: 'ML Kill Switch Reset',
      message: 'ML system has been re-armed and is ready for operation.',
      metadata: { triggeredBy: data.triggeredBy },
      severity: 'INFO',
    });
  }

  /**
   * ML Mode changed
   */
  async onMLModeChange(data: {
    fromMode: string;
    toMode: string;
    triggeredBy: string;
  }): Promise<ISystemAlert> {
    const severity: AlertSeverity = data.toMode === 'OFF' ? 'HIGH' : 'MEDIUM';

    return this.createAlert({
      type: 'ML_MODE_CHANGE',
      title: `ML Mode Changed: ${data.fromMode} → ${data.toMode}`,
      message: `Intelligence mode has been updated from ${data.fromMode} to ${data.toMode}.`,
      metadata: {
        fromMode: data.fromMode,
        toMode: data.toMode,
        triggeredBy: data.triggeredBy,
      },
      severity,
    });
  }

  /**
   * ML Gate blocked
   */
  async onMLGateBlock(data: {
    failedGates: string[];
  }): Promise<ISystemAlert> {
    return this.createAlert({
      type: 'ML_GATE_BLOCK',
      title: 'ML Readiness Gate Blocked',
      message: `ML progression blocked. Failed gates: ${data.failedGates.join(', ')}`,
      metadata: { failedGates: data.failedGates },
      severity: 'MEDIUM',
    });
  }

  /**
   * ML Drift level changed to HIGH
   */
  async onMLDriftHigh(data: {
    driftLevel: string;
    metrics?: Record<string, any>;
  }): Promise<ISystemAlert> {
    return this.createAlert({
      type: 'ML_DRIFT_HIGH',
      title: 'ML Drift Level Elevated',
      message: `Data drift has reached elevated levels. Current: ${data.driftLevel}`,
      metadata: { driftLevel: data.driftLevel, ...data.metrics },
      severity: 'HIGH',
    });
  }

  /**
   * Chain lag detected
   */
  async onChainLag(data: {
    chain: string;
    lagBlocks: number;
    lagSeconds: number;
  }): Promise<ISystemAlert> {
    return this.createAlert({
      type: 'CHAIN_LAG',
      title: `Chain Lag Detected: ${data.chain}`,
      message: `${data.chain} indexing is ${data.lagBlocks} blocks (${Math.round(data.lagSeconds / 60)}min) behind.`,
      metadata: data,
      chain: data.chain,
      severity: data.lagBlocks > 100 ? 'HIGH' : 'MEDIUM',
    });
  }

  /**
   * RPC degraded
   */
  async onRPCDegraded(data: {
    provider: string;
    chain?: string;
    errorRate: number;
  }): Promise<ISystemAlert> {
    return this.createAlert({
      type: 'RPC_DEGRADED',
      title: `RPC Service Degraded: ${data.provider}`,
      message: `RPC provider ${data.provider} is experiencing issues. Error rate: ${(data.errorRate * 100).toFixed(1)}%`,
      metadata: data,
      chain: data.chain,
      severity: 'HIGH',
    });
  }

  /**
   * Bridge activity spike
   */
  async onBridgeSpike(data: {
    bridge: string;
    fromChain: string;
    toChain: string;
    volumeUSD: number;
    changePercent: number;
  }): Promise<ISystemAlert> {
    return this.createAlert({
      type: 'BRIDGE_ACTIVITY_SPIKE',
      title: `Bridge Activity Spike: ${data.fromChain} → ${data.toChain}`,
      message: `Unusual bridge activity detected. Volume: $${formatNumber(data.volumeUSD)} (+${data.changePercent.toFixed(0)}%)`,
      metadata: data,
      severity: data.volumeUSD > 10_000_000 ? 'HIGH' : 'MEDIUM',
    });
  }

  /**
   * Large liquidity move
   */
  async onLiquidityMove(data: {
    fromChain: string;
    toChain: string;
    volumeUSD: number;
    actors: string[];
  }): Promise<ISystemAlert> {
    return this.createAlert({
      type: 'LARGE_LIQUIDITY_MOVE',
      title: `Large Liquidity Movement: ${data.fromChain} → ${data.toChain}`,
      message: `Significant cross-chain liquidity movement detected. Volume: $${formatNumber(data.volumeUSD)}`,
      metadata: data,
      severity: 'MEDIUM',
    });
  }
}

// Helper functions
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export const systemAlertService = new SystemAlertService();
