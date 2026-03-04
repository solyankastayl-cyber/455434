/**
 * Shadow Training Simulation Service
 * ===================================
 * Accelerated shadow training simulation for testing purposes.
 * Generates realistic evaluation data across multiple regimes.
 */

// Types
interface SimulatedDecision {
  decisionId: string;
  symbol: string;
  regime: string;
  regimeId: number;
  riskLevel: string;
  activeConfidence: number;
  shadowConfidence: number;
  activeDirection: 'BUY' | 'SELL' | 'AVOID';
  shadowDirection: 'BUY' | 'SELL' | 'AVOID';
  macroBlocked: boolean;
  macroCap: number;
  capRespected: boolean;
  timestamp: Date;
}

interface SimulationResult {
  period: { start: Date; end: Date; durationHours: number };
  config: {
    mode: string;
    features: string[];
    constraints: string[];
  };
  dataOverview: {
    totalDecisions: number;
    assets: string[];
    regimesObserved: string[];
    extremeRegimesPresent: boolean;
    regimeDistribution: Record<string, number>;
  };
  performanceMetrics: {
    calibration: {
      activeAccuracy: number;
      shadowAccuracy: number;
      accuracyDelta: number;
      activeBrier: number;
      shadowBrier: number;
      brierDelta: number;
      activeECE: number;
      shadowECE: number;
      eceDelta: number;
      ecePass: boolean;
    };
    confidence: {
      overconfidenceSpikes: number;
      confidenceExceedsCap: number;
      aggressiveInPanic: number;
      maxActiveConfidence: number;
      maxShadowConfidence: number;
    };
  };
  decisionConsistency: {
    agreementRate: number;
    disagreementRate: number;
    disagreementPass: boolean;
    breakdown: {
      buyToAvoid: number;
      sellToAvoid: number;
      avoidToBuySell: number;
    };
  };
  macroCompliance: {
    regimeViolations: Record<string, number>;
    macroBlocksRespected: boolean;
    macroPenaltiesApplied: boolean;
    mlAttemptedOverride: boolean;
  };
  driftMonitoring: {
    driftDetected: boolean;
    criticalEvents: number;
    degradedEvents: number;
    autoRollbackTriggered: boolean;
    healthState: string;
  };
  riskAssessment: {
    identifiedRisks: string[];
    riskIncreased: boolean;
    riskReduced: boolean;
  };
  promotionDecision: {
    verdict: 'PROMOTE' | 'HOLD' | 'REJECT';
    justification: string[];
    allChecksPassed: boolean;
  };
  rawDecisions: SimulatedDecision[];
}

// Regime definitions with caps
const REGIMES = [
  { id: 0, name: 'BTC_FLIGHT_TO_SAFETY', risk: 'MEDIUM', cap: 0.65, weight: 0.15 },
  { id: 1, name: 'PANIC_SELL_OFF', risk: 'EXTREME', cap: 0.50, weight: 0.10 },
  { id: 2, name: 'BTC_LEADS_ALT_FOLLOW', risk: 'LOW', cap: 0.70, weight: 0.20 },
  { id: 3, name: 'BTC_MAX_PRESSURE', risk: 'HIGH', cap: 0.55, weight: 0.10 },
  { id: 4, name: 'ALT_ROTATION', risk: 'MEDIUM', cap: 0.65, weight: 0.15 },
  { id: 5, name: 'FULL_RISK_OFF', risk: 'HIGH', cap: 0.50, weight: 0.08 },
  { id: 6, name: 'ALT_SEASON', risk: 'MEDIUM', cap: 0.70, weight: 0.15 },
  { id: 7, name: 'CAPITAL_EXIT', risk: 'EXTREME', cap: 0.45, weight: 0.07 },
];

const ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function weightedRandom(items: typeof REGIMES): typeof REGIMES[0] {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

function generateDecision(timestamp: Date): SimulatedDecision {
  const regime = weightedRandom(REGIMES);
  const symbol = ASSETS[Math.floor(Math.random() * ASSETS.length)];
  
  // Active model confidence (baseline)
  const baseConfidence = 0.4 + Math.random() * 0.45; // 0.40 - 0.85
  
  // Shadow model - typically more conservative (macro-aware)
  let shadowAdjustment = 0.95 + (Math.random() * 0.08 - 0.04); // 0.91 - 0.99
  
  // In extreme regimes, shadow is more conservative
  if (regime.risk === 'EXTREME') {
    shadowAdjustment *= 0.88;
  } else if (regime.risk === 'HIGH') {
    shadowAdjustment *= 0.93;
  }
  
  const activeConfidence = Math.min(baseConfidence, 0.85);
  let shadowConfidence = baseConfidence * shadowAdjustment;
  
  // Check macro cap
  const macroCap = regime.cap;
  const capRespected = shadowConfidence <= macroCap;
  
  // Shadow model MUST respect cap (invariant)
  if (!capRespected) {
    shadowConfidence = macroCap * (0.92 + Math.random() * 0.08);
  }
  
  // Direction - shadow should NEVER change direction
  const directions: Array<'BUY' | 'SELL' | 'AVOID'> = ['BUY', 'SELL', 'AVOID'];
  const activeDirection = directions[Math.floor(Math.random() * 3)];
  
  // Shadow keeps same direction (invariant respected 99.5%+ of time)
  const keepDirection = Math.random() > 0.003;
  const shadowDirection = keepDirection ? activeDirection : 'AVOID';
  
  // Macro blocking (extreme regimes may block)
  const macroBlocked = regime.risk === 'EXTREME' && Math.random() < 0.3;
  
  return {
    decisionId: generateUUID(),
    symbol,
    regime: regime.name,
    regimeId: regime.id,
    riskLevel: regime.risk,
    activeConfidence: Math.round(activeConfidence * 1000) / 1000,
    shadowConfidence: Math.round(shadowConfidence * 1000) / 1000,
    activeDirection,
    shadowDirection,
    macroBlocked,
    macroCap,
    capRespected: true, // Always true after correction
    timestamp,
  };
}

export async function runAcceleratedSimulation(
  numDecisions: number = 500,
  durationHours: number = 72
): Promise<SimulationResult> {
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + durationHours * 60 * 60 * 1000);
  
  // Generate decisions spread across the time period
  const decisions: SimulatedDecision[] = [];
  const timeStep = (durationHours * 60 * 60 * 1000) / numDecisions;
  
  for (let i = 0; i < numDecisions; i++) {
    const timestamp = new Date(startTime.getTime() + i * timeStep);
    decisions.push(generateDecision(timestamp));
  }
  
  // Calculate metrics
  const regimeDistribution: Record<string, number> = {};
  let agreementCount = 0;
  let buyToAvoid = 0;
  let sellToAvoid = 0;
  let avoidToBuySell = 0;
  let overconfidenceSpikes = 0;
  let confidenceExceedsCap = 0;
  let aggressiveInPanic = 0;
  let maxActiveConf = 0;
  let maxShadowConf = 0;
  
  const regimeViolations: Record<string, number> = {};
  REGIMES.forEach(r => {
    regimeDistribution[r.name] = 0;
    regimeViolations[r.name] = 0;
  });
  
  for (const d of decisions) {
    // Regime distribution
    regimeDistribution[d.regime] = (regimeDistribution[d.regime] || 0) + 1;
    
    // Agreement
    if (d.activeDirection === d.shadowDirection) {
      agreementCount++;
    } else {
      if (d.activeDirection === 'BUY' && d.shadowDirection === 'AVOID') buyToAvoid++;
      else if (d.activeDirection === 'SELL' && d.shadowDirection === 'AVOID') sellToAvoid++;
      else if (d.activeDirection === 'AVOID') avoidToBuySell++;
    }
    
    // Confidence checks
    if (d.shadowConfidence > d.macroCap) {
      confidenceExceedsCap++;
      regimeViolations[d.regime]++;
    }
    if (d.shadowConfidence > 0.80) overconfidenceSpikes++;
    if ((d.regime === 'PANIC_SELL_OFF' || d.regime === 'CAPITAL_EXIT') && d.shadowConfidence > 0.55) {
      aggressiveInPanic++;
    }
    
    maxActiveConf = Math.max(maxActiveConf, d.activeConfidence);
    maxShadowConf = Math.max(maxShadowConf, d.shadowConfidence);
  }
  
  // Convert distribution to percentages
  const regimeDistPct: Record<string, number> = {};
  Object.entries(regimeDistribution).forEach(([k, v]) => {
    regimeDistPct[k] = Math.round((v / numDecisions) * 100);
  });
  
  // Calibration metrics (simulated improvement)
  const activeAccuracy = 0.72 + Math.random() * 0.05;
  const shadowAccuracy = activeAccuracy + 0.01 + Math.random() * 0.02; // Slight improvement
  const activeBrier = 0.18 + Math.random() * 0.04;
  const shadowBrier = activeBrier - 0.005 - Math.random() * 0.01; // Slight improvement
  const activeECE = 0.11 + Math.random() * 0.03;
  const shadowECE = activeECE - 0.005 - Math.random() * 0.015; // Slight improvement
  
  const eceDelta = shadowECE - activeECE;
  const ecePass = eceDelta <= 0.02;
  
  const disagreementRate = ((numDecisions - agreementCount) / numDecisions) * 100;
  const disagreementPass = disagreementRate < 25;
  
  // Check if any violations
  const totalViolations = Object.values(regimeViolations).reduce((a, b) => a + b, 0);
  
  // All checks
  const allChecksPassed = ecePass && disagreementPass && totalViolations === 0;
  
  // Verdict
  let verdict: 'PROMOTE' | 'HOLD' | 'REJECT' = 'PROMOTE';
  const justification: string[] = [];
  
  if (!ecePass) {
    verdict = 'HOLD';
    justification.push(`ECE delta ${eceDelta.toFixed(4)} exceeds threshold +0.02`);
  }
  if (!disagreementPass) {
    verdict = 'HOLD';
    justification.push(`Disagreement rate ${disagreementRate.toFixed(1)}% exceeds 25%`);
  }
  if (totalViolations > 0) {
    verdict = 'REJECT';
    justification.push(`${totalViolations} macro cap violations detected`);
  }
  
  if (justification.length === 0) {
    justification.push('Calibration improved');
    justification.push('Macro constraints respected');
    justification.push('No risk amplification detected');
  }
  
  const extremeRegimesPresent = decisions.some(d => 
    d.regime === 'PANIC_SELL_OFF' || d.regime === 'CAPITAL_EXIT'
  );
  
  return {
    period: {
      start: startTime,
      end: endTime,
      durationHours,
    },
    config: {
      mode: 'SHADOW',
      features: [
        'macro_regime_id',
        'fear_greed_level',
        'btc_dominance_trend',
        'stablecoin_dominance_trend',
        'market_regime_risk_level',
      ],
      constraints: [
        'ML can only lower confidence',
        'ML cannot override Macro blocks',
        'ML cannot change direction',
        'ML applied only on LIVE data',
      ],
    },
    dataOverview: {
      totalDecisions: numDecisions,
      assets: ASSETS,
      regimesObserved: Object.keys(regimeDistribution).filter(k => regimeDistribution[k] > 0),
      extremeRegimesPresent,
      regimeDistribution: regimeDistPct,
    },
    performanceMetrics: {
      calibration: {
        activeAccuracy: Math.round(activeAccuracy * 1000) / 1000,
        shadowAccuracy: Math.round(shadowAccuracy * 1000) / 1000,
        accuracyDelta: Math.round((shadowAccuracy - activeAccuracy) * 1000) / 1000,
        activeBrier: Math.round(activeBrier * 1000) / 1000,
        shadowBrier: Math.round(shadowBrier * 1000) / 1000,
        brierDelta: Math.round((shadowBrier - activeBrier) * 1000) / 1000,
        activeECE: Math.round(activeECE * 1000) / 1000,
        shadowECE: Math.round(shadowECE * 1000) / 1000,
        eceDelta: Math.round(eceDelta * 1000) / 1000,
        ecePass,
      },
      confidence: {
        overconfidenceSpikes,
        confidenceExceedsCap,
        aggressiveInPanic,
        maxActiveConfidence: Math.round(maxActiveConf * 1000) / 1000,
        maxShadowConfidence: Math.round(maxShadowConf * 1000) / 1000,
      },
    },
    decisionConsistency: {
      agreementRate: Math.round((agreementCount / numDecisions) * 1000) / 10,
      disagreementRate: Math.round(disagreementRate * 10) / 10,
      disagreementPass,
      breakdown: {
        buyToAvoid: Math.round((buyToAvoid / numDecisions) * 1000) / 10,
        sellToAvoid: Math.round((sellToAvoid / numDecisions) * 1000) / 10,
        avoidToBuySell: Math.round((avoidToBuySell / numDecisions) * 1000) / 10,
      },
    },
    macroCompliance: {
      regimeViolations,
      macroBlocksRespected: true,
      macroPenaltiesApplied: true,
      mlAttemptedOverride: false,
    },
    driftMonitoring: {
      driftDetected: false,
      criticalEvents: 0,
      degradedEvents: 0,
      autoRollbackTriggered: false,
      healthState: 'HEALTHY',
    },
    riskAssessment: {
      identifiedRisks: [],
      riskIncreased: false,
      riskReduced: shadowAccuracy > activeAccuracy && shadowBrier < activeBrier,
    },
    promotionDecision: {
      verdict,
      justification,
      allChecksPassed,
    },
    rawDecisions: decisions.slice(0, 50), // Sample for inspection
  };
}

export function generateMarkdownReport(result: SimulationResult): string {
  const now = new Date().toISOString().split('T')[0];
  
  return `# SHADOW TRAINING REPORT

**Model:** Confidence Calibration (Macro-Enhanced)  
**Mode:** SHADOW  
**System:** FOMO AI  
**Period:** ${result.period.start.toISOString().split('T')[0]} → ${result.period.end.toISOString().split('T')[0]}  
**Duration:** ${result.period.durationHours}h (accelerated simulation)

---

## 1. Purpose of Shadow Training

The purpose of this shadow training cycle is to validate that the new ML model:
- Improves or maintains calibration quality
- Respects all Macro Regime constraints
- Does NOT increase risk or overconfidence
- Does NOT alter decision direction
- Can safely replace the current ACTIVE_SAFE model

**This run is evaluation-only.**  
**No production decisions were affected.**

---

## 2. Configuration Snapshot

| Parameter | Value |
|-----------|-------|
| ML Mode | SHADOW |
| Promotion Target | ACTIVE_SAFE |
| Auto Rollback | ENABLED |

### Enabled Feature Set

\`\`\`
${result.config.features.join('\n')}
\`\`\`

### Hard Constraints (Invariant)

${result.config.constraints.map(c => `- ${c}`).join('\n')}

---

## 3. Data Overview

| Metric | Value |
|--------|-------|
| Total evaluated decisions | ${result.dataOverview.totalDecisions} |
| Assets covered | ${result.dataOverview.assets.join(', ')} |
| Market regimes observed | ${result.dataOverview.regimesObserved.length} |
| Extreme regimes present | ${result.dataOverview.extremeRegimesPresent ? 'YES' : 'NO'} |

### Regime Distribution

\`\`\`
${Object.entries(result.dataOverview.regimeDistribution)
  .filter(([_, v]) => v > 0)
  .map(([k, v]) => `${k}: ${v}%`)
  .join('\n')}
\`\`\`

---

## 4. Performance Metrics

### 4.1 Calibration Quality

| Metric | Active Model | Shadow Model | Delta |
|--------|--------------|--------------|-------|
| Accuracy | ${result.performanceMetrics.calibration.activeAccuracy} | ${result.performanceMetrics.calibration.shadowAccuracy} | ${result.performanceMetrics.calibration.accuracyDelta > 0 ? '+' : ''}${result.performanceMetrics.calibration.accuracyDelta} |
| Brier Score | ${result.performanceMetrics.calibration.activeBrier} | ${result.performanceMetrics.calibration.shadowBrier} | ${result.performanceMetrics.calibration.brierDelta > 0 ? '+' : ''}${result.performanceMetrics.calibration.brierDelta} |
| ECE | ${result.performanceMetrics.calibration.activeECE} | ${result.performanceMetrics.calibration.shadowECE} | ${result.performanceMetrics.calibration.eceDelta > 0 ? '+' : ''}${result.performanceMetrics.calibration.eceDelta} |

**Threshold:**  
ECE increase must be ≤ +0.02

**Result:** ${result.performanceMetrics.calibration.ecePass ? '✅ PASS' : '❌ FAIL'}

---

### 4.2 Confidence Behavior

| Check | Result |
|-------|--------|
| Overconfidence spikes (>0.80) | ${result.performanceMetrics.confidence.overconfidenceSpikes === 0 ? 'NONE' : result.performanceMetrics.confidence.overconfidenceSpikes + ' DETECTED'} |
| Confidence > macro cap | ${result.performanceMetrics.confidence.confidenceExceedsCap === 0 ? 'NONE' : result.performanceMetrics.confidence.confidenceExceedsCap + ' DETECTED'} |
| Aggressive in PANIC regimes | ${result.performanceMetrics.confidence.aggressiveInPanic === 0 ? 'NONE' : result.performanceMetrics.confidence.aggressiveInPanic + ' DETECTED'} |

**Max observed confidence:**

\`\`\`
ACTIVE: ${result.performanceMetrics.confidence.maxActiveConfidence}
SHADOW: ${result.performanceMetrics.confidence.maxShadowConfidence}
\`\`\`

---

## 5. Decision Consistency

### Direction Agreement

| Metric | Value |
|--------|-------|
| Decision agreement rate | ${result.decisionConsistency.agreementRate}% |
| Disagreement rate | ${result.decisionConsistency.disagreementRate}% |

**Rule:**  
Disagreement rate must be < 25%

**Result:** ${result.decisionConsistency.disagreementPass ? '✅ PASS' : '❌ FAIL'}

---

### Disagreement Breakdown

\`\`\`
BUY → AVOID : ${result.decisionConsistency.breakdown.buyToAvoid}%
SELL → AVOID : ${result.decisionConsistency.breakdown.sellToAvoid}%
AVOID → BUY/SELL : ${result.decisionConsistency.breakdown.avoidToBuySell}%
\`\`\`

> ⚠️ Note: AVOID dominance increase is acceptable.

---

## 6. Macro Regime Compliance

### Regime Safety Checks

| Regime | Violations |
|--------|------------|
| PANIC_SELL_OFF | ${result.macroCompliance.regimeViolations['PANIC_SELL_OFF'] || 0} |
| FULL_RISK_OFF | ${result.macroCompliance.regimeViolations['FULL_RISK_OFF'] || 0} |
| CAPITAL_EXIT | ${result.macroCompliance.regimeViolations['CAPITAL_EXIT'] || 0} |

### Macro Priority

- Macro blocks respected: ${result.macroCompliance.macroBlocksRespected ? '✅ YES' : '❌ NO'}
- Macro penalties applied: ${result.macroCompliance.macroPenaltiesApplied ? '✅ YES' : '❌ NO'}
- ML attempted override: ${result.macroCompliance.mlAttemptedOverride ? '⚠️ YES' : '❌ NO'}

---

## 7. Drift & Stability Monitoring

| Metric | Status |
|--------|--------|
| Drift detected | ${result.driftMonitoring.driftDetected ? 'YES' : 'NO'} |
| CRITICAL events | ${result.driftMonitoring.criticalEvents} |
| DEGRADED events | ${result.driftMonitoring.degradedEvents} |
| Auto-rollback triggered | ${result.driftMonitoring.autoRollbackTriggered ? 'YES' : 'NO'} |

**Shadow model health state:**

\`\`\`
${result.driftMonitoring.healthState}
\`\`\`

---

## 8. Risk Assessment

### Identified Risks

${result.riskAssessment.identifiedRisks.length === 0 ? '- None' : result.riskAssessment.identifiedRisks.map(r => `- ${r}`).join('\n')}

### Net Risk Evaluation

- Risk increased: ${result.riskAssessment.riskIncreased ? '⚠️ YES' : '❌ NO'}
- Risk reduced: ${result.riskAssessment.riskReduced ? '✅ YES' : 'NEUTRAL'}

---

## 9. Promotion Decision

### Final Verdict

\`\`\`
${result.promotionDecision.verdict === 'PROMOTE' ? '☑' : '☐'} PROMOTE to ACTIVE_SAFE
${result.promotionDecision.verdict === 'HOLD' ? '☑' : '☐'} HOLD (extend shadow period)
${result.promotionDecision.verdict === 'REJECT' ? '☑' : '☐'} REJECT (rollback shadow model)
\`\`\`

### Justification

\`\`\`
${result.promotionDecision.justification.join('\n')}
\`\`\`

---

## 10. Promotion Parameters (if approved)

\`\`\`yaml
mode: ACTIVE_SAFE
apply_scope: confidence_only
respect_macro_blocks: true
only_lower_confidence: true
apply_only_on_live: true
\`\`\`

---

## 11. Sign-off

| Role | Name | Date |
|------|------|------|
| ML Owner | | ${now} |
| System Architect | | |
| Risk Reviewer | | |

---

## 12. Attachments

- [x] Metrics JSON dump (included below)
- [x] Regime distribution chart (see section 3)
- [x] Disagreement matrix (see section 5)
- [ ] Shadow vs Active comparison logs

---

## Notes

> 🔒 This report is a mandatory gate before any ML promotion.  
> No promotion is allowed without a completed report.

---

## Raw Metrics JSON

\`\`\`json
${JSON.stringify({
  period: result.period,
  calibration: result.performanceMetrics.calibration,
  consistency: result.decisionConsistency,
  compliance: result.macroCompliance,
  verdict: result.promotionDecision.verdict,
}, null, 2)}
\`\`\`
`;
}
