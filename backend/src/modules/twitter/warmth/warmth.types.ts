// P1: Warmth Types
// Session warmth = keeping cookies alive by simulating activity

export type WarmthAction = 'PING_VIEWER' | 'PING_HOME';

export interface WarmthResult {
  success: boolean;
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
  checkedAt: Date;
}

export interface WarmthPlan {
  sessionId: string;
  action: WarmthAction;
  notBeforeTs: number;
  jitterMs: number;
  attemptsToday: number;
  maxAttemptsPerDay: number;
}

export interface WarmthConfig {
  // How often to run warmth checks (ms)
  intervalMs: number;
  // Max warmth attempts per day per session
  maxAttemptsPerDay: number;
  // Jitter range to avoid detection (ms)
  jitterMinMs: number;
  jitterMaxMs: number;
  // Timeout for warmth request (ms)
  requestTimeoutMs: number;
}

// Default config - conservative to avoid detection
export const DEFAULT_WARMTH_CONFIG: WarmthConfig = {
  intervalMs: 30 * 60 * 1000,      // 30 minutes
  maxAttemptsPerDay: 2,            // 2 per day max
  jitterMinMs: 5 * 60 * 1000,      // 5 min
  jitterMaxMs: 15 * 60 * 1000,     // 15 min
  requestTimeoutMs: 30 * 1000,     // 30 sec
};
