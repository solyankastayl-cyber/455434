/**
 * SPX REGIME ENGINE — Configuration
 * 
 * BLOCK B6.11 — Regime Decomposition Engine
 * 
 * All thresholds and windows are fixed constants.
 * No ML, fully deterministic and reproducible.
 */

export const REGIME_CONFIG = {
  // Volatility windows (days)
  VOL_WINDOW_SHORT: 20,
  VOL_WINDOW_LONG: 60,
  
  // Drawdown windows
  DD_WINDOW: 60,
  
  // Trend windows
  TREND_LOOKBACK: 30,
  SMA_PERIOD: 50,
  SLOPE_WINDOW: 10,
  
  // Shock/rebound detection
  SHOCK_WINDOW: 5,
  REBOUND_WINDOW: 10,
  
  // Trading days per year
  TRADING_DAYS: 252,
};

// Volatility percentile thresholds (will be computed from data)
export const VOL_PERCENTILES = {
  P33: 0.12,  // ~12% annualized vol
  P66: 0.18,  // ~18% annualized vol
};

// Regime classification thresholds
export const REGIME_THRESHOLDS = {
  // Drawdown severity
  DD_SEVERE: -0.12,        // -12% drawdown = severe
  
  // Shock detection
  SHOCK_THRESHOLD: -0.07,   // -7% in 5 days = fast shock
  
  // V-shape detection  
  VSHAPE_REBOUND: 0.07,     // +7% rebound after shock
  
  // Trend slope threshold
  SLOPE_THRESHOLD: 0.001,   // SMA50 daily change threshold
  
  // Drawdown speed (% per day)
  DD_SPEED_FAST: 0.015,     // 1.5% per day = fast
  DD_SPEED_SLOW: 0.005,     // 0.5% per day = slow
  
  // Persistence threshold
  PERSISTENCE_HIGH: 0.7,    // 70% days same direction = persistent
};

// Regime Tags
export enum RegimeTag {
  LOWVOL_TREND_UP = 'LOWVOL_TREND_UP',
  LOWVOL_TREND_DOWN = 'LOWVOL_TREND_DOWN',
  LOWVOL_RANGE = 'LOWVOL_RANGE',
  MEDVOL_TREND_UP = 'MEDVOL_TREND_UP',
  MEDVOL_TREND_DOWN = 'MEDVOL_TREND_DOWN',
  MEDVOL_RANGE = 'MEDVOL_RANGE',
  // B6.13.2: Crisis Typology 2.0 — more granular HIGHVOL regimes
  HIGHVOL_FAST_SHOCK_VSHAPE = 'HIGHVOL_FAST_SHOCK_VSHAPE',   // 2020s COVID-like
  HIGHVOL_FAST_SHOCK_NONV = 'HIGHVOL_FAST_SHOCK_NONV',       // Fast crash, no recovery
  HIGHVOL_SLOW_DRAWDOWN = 'HIGHVOL_SLOW_DRAWDOWN',           // 2000s GFC-like
  HIGHVOL_RECOVERY = 'HIGHVOL_RECOVERY',
  // Legacy HIGHVOL (for backwards compat)
  HIGHVOL_FAST_SHOCK = 'HIGHVOL_FAST_SHOCK',
  HIGHVOL_VSHAPE = 'HIGHVOL_VSHAPE',
  // B6.13.1: TRANSITION Split subtypes
  TRANSITION_VOL_UP = 'TRANSITION_VOL_UP',       // Vol expanding (MED→HIGH or LOW→MED)
  TRANSITION_VOL_DOWN = 'TRANSITION_VOL_DOWN',   // Vol contracting (HIGH→MED or MED→LOW)
  TRANSITION_TREND_FLIP = 'TRANSITION_TREND_FLIP', // SMA50 slope sign change
  TRANSITION_RANGE_BREAK = 'TRANSITION_RANGE_BREAK', // Range → Trend or vice versa
  TRANSITION = 'TRANSITION', // Fallback for other transitions
}

// Vol bucket classification
export enum VolBucket {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

// Trend direction
export enum TrendDir {
  UP = 'UP',
  DOWN = 'DOWN',
  FLAT = 'FLAT',
}

export default REGIME_CONFIG;
