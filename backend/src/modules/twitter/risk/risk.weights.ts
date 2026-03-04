// P1: Risk Weights
// Weights for risk calculation factors

export interface RiskWeights {
  cookieAge: number;
  warmth: number;
  parserErrors: number;
  rateLimit: number;
  proxyDrift: number;
  idle: number;
  missingCookies: number;
}

// Default weights - sum should be ~1.0 for normalized scoring
export const RISK_WEIGHTS: RiskWeights = {
  cookieAge: 0.25,        // Cookie freshness is very important
  warmth: 0.20,           // Warmth failures indicate problems
  parserErrors: 0.20,     // Parser errors indicate session issues
  rateLimit: 0.15,        // Rate limits indicate overuse
  proxyDrift: 0.05,       // Proxy changes have minor impact
  idle: 0.05,             // Idle time slightly increases risk
  missingCookies: 0.10,   // Missing required cookies is bad
};

// Age thresholds in hours for risk scoring
export const AGE_THRESHOLDS = {
  fresh: 6,               // < 6h = very fresh
  normal: 24,             // < 24h = normal
  aging: 48,              // < 48h = aging
  old: 72,                // < 72h = old
  critical: 168,          // < 1 week = critical
};
