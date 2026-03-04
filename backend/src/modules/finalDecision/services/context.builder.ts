/**
 * PHASE 4 — Context Builder
 * ==========================
 * Build DecisionContext from system state
 */

import { DecisionContext, RiskFlags } from '../contracts/decision.types.js';
import { fetchLiveData } from '../../exchange/data/realdata.service.js';
import { mlInferenceService } from '../../ml/services/ml.inference.service.js';
import { mlDiagnosticsService } from '../../ml/services/ml.diagnostics.service.js';
import { systemStatusService } from '../../observability/services/system.status.service.js';

/**
 * Build complete DecisionContext from current system state
 */
export async function buildDecisionContext(symbol: string): Promise<DecisionContext> {
  const timestamp = Date.now();
  
  // Get live data
  const liveData = await fetchLiveData(symbol);
  
  // Get system status
  const systemStatus = await systemStatusService.getStatus();
  
  // Get ML status
  await mlInferenceService.reload();
  const mlReady = mlInferenceService.isReady();
  const mlHealth = await mlDiagnosticsService.getModelHealth();
  
  // Default values if no live data
  if (!liveData) {
    return {
      symbol,
      timestamp,
      verdict: 'NEUTRAL',
      rawConfidence: 0,
      mlAdjustedConfidence: 0,
      strength: 'WEAK',
      dataMode: 'MOCK',
      completeness: 0,
      mlReady,
      mlDrift: mlHealth.drift.driftDetected,
      risk: {
        whaleRisk: 'LOW',
        marketStress: 'NORMAL',
        contradiction: false,
        liquidationRisk: false,
      },
      drivers: [],
      risks: ['NO_LIVE_DATA'],
    };
  }
  
  // Extract data
  const dataMode = liveData.sourceMeta.dataMode;
  const completeness = liveData.sourceMeta.missing.length === 0 ? 1 : 0.8;
  
  // Determine verdict from price action
  const priceChange = liveData.priceChange1h || 0;
  let verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (priceChange > 0.5) verdict = 'BULLISH';
  else if (priceChange < -0.5) verdict = 'BEARISH';
  
  // Base confidence from data quality
  let rawConfidence = completeness * 0.7;
  if (dataMode === 'LIVE') rawConfidence += 0.2;
  if (Math.abs(priceChange) > 1) rawConfidence += 0.1;
  rawConfidence = Math.min(1, rawConfidence);
  
  // ML calibration
  let mlAdjustedConfidence = rawConfidence;
  if (mlReady) {
    const features = {
      priceChange1h: priceChange,
      priceChange5m: liveData.priceChange5m || 0,
      fundingRate: liveData.fundingRate * 10000, // to bps
      oiChange: liveData.oiChange || 0,
      imbalance: liveData.orderbook.imbalance,
    };
    
    const calibration = await mlInferenceService.calibrateConfidence(
      features,
      rawConfidence
    );
    mlAdjustedConfidence = calibration.calibratedConfidence;
  }
  
  // Risk assessment
  const risk: RiskFlags = {
    whaleRisk: 'LOW',
    marketStress: 'NORMAL',
    contradiction: false,
    liquidationRisk: false,
  };
  
  // Funding rate extremes → whale risk
  const fundingBps = Math.abs(liveData.fundingRate * 10000);
  if (fundingBps > 20) risk.whaleRisk = 'HIGH';
  else if (fundingBps > 10) risk.whaleRisk = 'MEDIUM';
  
  // Volatility → market stress
  const volatility = Math.abs(priceChange);
  if (volatility > 5) risk.marketStress = 'EXTREME';
  else if (volatility > 2) risk.marketStress = 'ELEVATED';
  
  // Orderbook imbalance contradiction
  if (
    (verdict === 'BULLISH' && liveData.orderbook.imbalance < -0.3) ||
    (verdict === 'BEARISH' && liveData.orderbook.imbalance > 0.3)
  ) {
    risk.contradiction = true;
  }
  
  // Drivers
  const drivers: string[] = [];
  if (dataMode === 'LIVE') drivers.push('LIVE_DATA');
  if (mlReady) drivers.push('ML_CALIBRATED');
  if (Math.abs(priceChange) > 1) drivers.push('STRONG_MOMENTUM');
  
  // Risks
  const risks: string[] = [];
  if (risk.whaleRisk !== 'LOW') risks.push(`WHALE_RISK_${risk.whaleRisk}`);
  if (risk.marketStress !== 'NORMAL') risks.push(`STRESS_${risk.marketStress}`);
  if (risk.contradiction) risks.push('SIGNAL_CONTRADICTION');
  if (mlHealth.drift.driftDetected) risks.push('ML_DRIFT');
  
  return {
    symbol,
    timestamp,
    verdict,
    rawConfidence,
    mlAdjustedConfidence,
    strength: mlAdjustedConfidence >= 0.65 ? 'STRONG' : 'WEAK',
    dataMode,
    completeness,
    mlReady,
    mlDrift: mlHealth.drift.driftDetected,
    risk,
    drivers,
    risks,
  };
}

console.log('[Phase 4] Context Builder loaded');
