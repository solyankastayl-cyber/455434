// P1: Risk Types
// Risk scoring for session health prediction

import { SessionStatus } from '../sessions/session.model.js';

export interface RiskFactors {
  // Cookie age in hours since last sync
  cookieAgeHours: number;
  // Warmth failure rate (0-1)
  warmthFailureRate: number;
  // Parser error rate (0-1)
  parserErrorRate: number;
  // Rate limit pressure (0-1)
  rateLimitPressure: number;
  // Proxy changed recently
  proxyChangedRecently: boolean;
  // Hours since last activity
  idleHours: number;
  // Has required cookies
  hasRequiredCookies: boolean;
}

export interface RiskScore {
  score: number;           // 0-100 (0 = healthy, 100 = dead)
  status: SessionStatus;   // Derived status
  factors: RiskFactors;    // Input factors
  calculatedAt: Date;
}

export interface RiskThresholds {
  okMax: number;           // Score < this = OK
  staleMax: number;        // Score < this = STALE, else INVALID
}

// Default thresholds
export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  okMax: 35,
  staleMax: 70,
};
