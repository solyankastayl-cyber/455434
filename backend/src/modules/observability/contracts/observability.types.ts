/**
 * PHASE 2 — Observability Types
 * ==============================
 * Contracts for transparency & diagnostics
 */

export type DataMode = 'LIVE' | 'MIXED' | 'MOCK';
export type ProviderHealth = 'UP' | 'DEGRADED' | 'DOWN';
export type Severity = 'INFO' | 'WARN' | 'CRITICAL';

export type TimelineEventType =
  | 'PROVIDER_HEALTH_CHANGED'
  | 'PROXY_UPDATED'
  | 'WS_STARTED'
  | 'WS_STOPPED'
  | 'WS_RECONNECT'
  | 'DATA_MODE_CHANGED'
  | 'VERDICT_EMITTED'
  | 'CONFIDENCE_DOWNGRADED'
  | 'DIVERGENCE_DETECTED'
  | 'BACKFILL_STARTED'
  | 'BACKFILL_PROGRESS'
  | 'BACKFILL_FINISHED';

export interface TimelineEventDto {
  ts: string;
  type: TimelineEventType;
  severity: Severity;
  symbol?: string;
  providerId?: string;
  message: string;
  data?: Record<string, any>;
}

export interface ProviderStatusDto {
  id: string;
  enabled: boolean;
  priority: number;
  health: ProviderHealth;
  latencyMs?: number;
  lastOkAt?: string;
  lastError?: string;
  dataMode?: DataMode;
}

export interface ProxyStatusDto {
  mode: 'direct' | 'proxy' | 'proxy_pool';
  type?: 'HTTP' | 'SOCKS5';
  host?: string;
  port?: number;
  authEnabled?: boolean;
  lastTestAt?: string;
  latencyMs?: number;
}

export interface WsStatusDto {
  providerId: string;
  running: boolean;
  state: string;
  lastHeartbeatAt?: string;
  reconnects?: number;
  lastError?: string;
}

export interface AlertDto {
  severity: Severity;
  code: string;
  message: string;
}

export interface SystemStatusDto {
  ts: string;
  dataMode: DataMode;
  providers: ProviderStatusDto[];
  proxy: ProxyStatusDto;
  ws: WsStatusDto[];
  alerts: AlertDto[];
}

export interface DataQualityDto {
  symbol: string;
  ts: string;
  dataMode: DataMode;
  completeness: number;
  staleMs: number;
  missingFields: string[];
  downgradeReasons: string[];
  providersUsed: string[];
}

export interface SymbolTruthStats {
  symbol: string;
  confirmedRate: number;
  divergedRate: number;
  neutralRate: number;
  sampleSize: number;
  avgRawConfidence?: number;
  avgAdjustedConfidence?: number;
}

export interface TruthAnalyticsDto {
  ts: string;
  overall: {
    confirmedRate: number;
    divergedRate: number;
    neutralRate: number;
    sampleSize: number;
  };
  bySymbol: SymbolTruthStats[];
}

console.log('[Phase 2] Observability Types loaded');
