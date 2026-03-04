/**
 * Labs Alerting Service
 * 
 * Monitors Labs for critical states and generates alerts:
 * - Critical state detection
 * - Threshold breaches
 * - Sudden changes
 * - Conflict escalation
 */

import { MongoClient, Db, Collection } from 'mongodb';
import { LabName, AnyLabResult, LabsSnapshot } from './labs-canonical.types.js';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'intelligence_engine';

let db: Db | null = null;

async function getDb(): Promise<Db> {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

// Alert severity levels
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';

// Alert types
export type AlertType = 
  | 'CRITICAL_STATE'
  | 'THRESHOLD_BREACH'
  | 'RAPID_CHANGE'
  | 'CONFLICT_ESCALATION'
  | 'DATA_QUALITY'
  | 'CASCADE_WARNING'
  | 'MANIPULATION_DETECTED';

// Alert structure
export interface LabAlert {
  id: string;
  symbol: string;
  labName: LabName;
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  labState: string;
  labConfidence: number;
  threshold?: number;
  actualValue?: number;
  previousState?: string;
  timestamp: number;
  acknowledged: boolean;
  expiresAt: number;
}

// Alert rules configuration
const ALERT_RULES: Array<{
  labName: LabName;
  condition: (lab: AnyLabResult) => boolean;
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  getMessage: (lab: AnyLabResult) => string;
}> = [
  // Critical States
  {
    labName: 'dataQuality',
    condition: (lab) => lab.state === 'UNTRUSTED' || lab.state === 'DEGRADED',
    alertType: 'DATA_QUALITY',
    severity: 'CRITICAL',
    title: 'Data Quality Degraded',
    getMessage: (lab) => `Data quality is ${lab.state}. Decisions may be unreliable.`,
  },
  {
    labName: 'marketStress',
    condition: (lab) => lab.state === 'PANIC' || lab.state === 'FORCED_LIQUIDATIONS',
    alertType: 'CRITICAL_STATE',
    severity: 'EMERGENCY',
    title: 'Market Stress Critical',
    getMessage: (lab) => `Market is in ${lab.state} mode. Extreme caution required.`,
  },
  {
    labName: 'liquidation',
    condition: (lab) => lab.state === 'CASCADE_RISK',
    alertType: 'CASCADE_WARNING',
    severity: 'EMERGENCY',
    title: 'Liquidation Cascade Risk',
    getMessage: (lab) => `Liquidation cascade detected. High volatility imminent.`,
  },
  {
    labName: 'manipulation',
    condition: (lab) => lab.state !== 'CLEAN',
    alertType: 'MANIPULATION_DETECTED',
    severity: 'WARNING',
    title: 'Manipulation Risk Detected',
    getMessage: (lab) => `Potential manipulation: ${lab.state}. Exercise caution.`,
  },
  {
    labName: 'signalConflict',
    condition: (lab) => lab.state === 'STRONG_CONFLICT',
    alertType: 'CONFLICT_ESCALATION',
    severity: 'WARNING',
    title: 'Strong Signal Conflict',
    getMessage: (lab) => `Labs are showing conflicting signals. Wait for clarity.`,
  },
  {
    labName: 'liquidity',
    condition: (lab) => lab.state === 'THIN_LIQUIDITY' || lab.state === 'LIQUIDITY_GAPS',
    alertType: 'THRESHOLD_BREACH',
    severity: 'WARNING',
    title: 'Liquidity Warning',
    getMessage: (lab) => `Liquidity is ${lab.state}. Slippage risk elevated.`,
  },
  {
    labName: 'volatility',
    condition: (lab) => lab.state === 'HIGH_VOL',
    alertType: 'THRESHOLD_BREACH',
    severity: 'INFO',
    title: 'High Volatility',
    getMessage: (lab) => `Volatility is elevated. Consider position sizing.`,
  },
  {
    labName: 'momentum',
    condition: (lab) => lab.state === 'REVERSAL_RISK',
    alertType: 'RAPID_CHANGE',
    severity: 'INFO',
    title: 'Reversal Risk',
    getMessage: (lab) => `Momentum indicates potential reversal. Watch for confirmation.`,
  },
  {
    labName: 'stability',
    condition: (lab) => lab.state === 'UNSTABLE' || lab.state === 'BREAK_RISK',
    alertType: 'CRITICAL_STATE',
    severity: 'WARNING',
    title: 'Market Stability Concern',
    getMessage: (lab) => `Market structure is ${lab.state}. Breakout possible.`,
  },
];

// In-memory alert store (would be MongoDB in production)
const activeAlerts: Map<string, LabAlert> = new Map();
const alertHistory: LabAlert[] = [];

// Generate unique alert ID
function generateAlertId(symbol: string, labName: string, alertType: string): string {
  return `${symbol}_${labName}_${alertType}_${Date.now()}`;
}

// Check if similar alert already exists (deduplication)
function hasActiveAlert(symbol: string, labName: LabName, alertType: AlertType): boolean {
  for (const alert of activeAlerts.values()) {
    if (alert.symbol === symbol && 
        alert.labName === labName && 
        alert.alertType === alertType &&
        !alert.acknowledged &&
        alert.expiresAt > Date.now()) {
      return true;
    }
  }
  return false;
}

// Process Labs snapshot and generate alerts
export function processLabsForAlerts(snapshot: LabsSnapshot): LabAlert[] {
  const newAlerts: LabAlert[] = [];
  const { symbol, labs } = snapshot;

  for (const rule of ALERT_RULES) {
    const lab = labs[rule.labName];
    if (!lab) continue;

    if (rule.condition(lab) && !hasActiveAlert(symbol, rule.labName, rule.alertType)) {
      const alert: LabAlert = {
        id: generateAlertId(symbol, rule.labName, rule.alertType),
        symbol,
        labName: rule.labName,
        alertType: rule.alertType,
        severity: rule.severity,
        title: rule.title,
        message: rule.getMessage(lab),
        labState: lab.state,
        labConfidence: lab.confidence,
        timestamp: Date.now(),
        acknowledged: false,
        expiresAt: Date.now() + getAlertTTL(rule.severity),
      };

      activeAlerts.set(alert.id, alert);
      alertHistory.push(alert);
      newAlerts.push(alert);
    }
  }

  // Clean up expired alerts
  for (const [id, alert] of activeAlerts.entries()) {
    if (alert.expiresAt < Date.now()) {
      activeAlerts.delete(id);
    }
  }

  return newAlerts;
}

// Get TTL based on severity
function getAlertTTL(severity: AlertSeverity): number {
  switch (severity) {
    case 'EMERGENCY': return 30 * 60 * 1000;  // 30 minutes
    case 'CRITICAL': return 15 * 60 * 1000;   // 15 minutes
    case 'WARNING': return 10 * 60 * 1000;    // 10 minutes
    case 'INFO': return 5 * 60 * 1000;        // 5 minutes
    default: return 5 * 60 * 1000;
  }
}

// Get all active alerts for a symbol
export function getActiveAlerts(symbol?: string): LabAlert[] {
  const alerts = Array.from(activeAlerts.values())
    .filter(a => !a.acknowledged && a.expiresAt > Date.now());
  
  if (symbol) {
    return alerts.filter(a => a.symbol === symbol);
  }
  return alerts;
}

// Get alert counts by severity
export function getAlertCounts(symbol?: string): Record<AlertSeverity, number> {
  const alerts = getActiveAlerts(symbol);
  return {
    EMERGENCY: alerts.filter(a => a.severity === 'EMERGENCY').length,
    CRITICAL: alerts.filter(a => a.severity === 'CRITICAL').length,
    WARNING: alerts.filter(a => a.severity === 'WARNING').length,
    INFO: alerts.filter(a => a.severity === 'INFO').length,
  };
}

// Acknowledge an alert
export function acknowledgeAlert(alertId: string): boolean {
  const alert = activeAlerts.get(alertId);
  if (alert) {
    alert.acknowledged = true;
    return true;
  }
  return false;
}

// Get alert history
export function getAlertHistory(symbol?: string, limit = 50): LabAlert[] {
  let history = [...alertHistory].reverse();
  if (symbol) {
    history = history.filter(a => a.symbol === symbol);
  }
  return history.slice(0, limit);
}

// Save alerts to MongoDB (for persistence)
export async function saveAlertsToDb(): Promise<void> {
  const database = await getDb();
  const collection = database.collection('lab_alerts');
  
  const alerts = Array.from(activeAlerts.values());
  if (alerts.length > 0) {
    await collection.insertMany(alerts.map(a => ({ ...a, _id: a.id })), { ordered: false }).catch(() => {});
  }
}

console.log('[LABS.ALERTING] Service loaded with', ALERT_RULES.length, 'alert rules');
