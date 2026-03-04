/**
 * HORIZON META TESTS — Validation Suite
 * 
 * Tests:
 * 1. Determinism (same input → same output)
 * 2. No realized data → decay=1
 * 3. div > thr → decay < 1
 * 4. Decay clamped >= 0.35
 * 5. Weights sum == 1
 * 6. Consensus threshold mapping
 */

import {
  HorizonMetaService,
  type HorizonMetaInput,
  type HorizonKey,
} from './index.js';

// ═══════════════════════════════════════════════════════════════
// TEST UTILITIES
// ═══════════════════════════════════════════════════════════════

function createTestInput(overrides: Partial<HorizonMetaInput> = {}): HorizonMetaInput {
  return {
    asset: 'DXY',
    asOf: '2024-01-01',
    spotCloseAsOf: 100,
    predSeriesByHorizon: {
      30: Array(31).fill(0).map((_, i) => i * 0.001), // +3% over 30 days
      90: Array(91).fill(0).map((_, i) => i * 0.0005),
      180: Array(181).fill(0).map((_, i) => i * 0.0003),
      365: Array(366).fill(0).map((_, i) => i * 0.0002),
    },
    predSeriesType: 'cumReturn',
    baseConfidenceByHorizon: { 30: 0.7, 90: 0.8, 180: 0.85, 365: 0.9 },
    stabilityByHorizon: { 30: 0.9, 90: 0.95, 180: 0.95, 365: 1.0 },
    biasByHorizon: { 30: 1, 90: 1, 180: 0, 365: -1 }, // Mixed signals
    ...overrides,
  };
}

function generateRealizedPrices(
  spotClose: number,
  days: number,
  dailyReturn: number
): number[] {
  const prices: number[] = [spotClose];
  for (let i = 1; i <= days; i++) {
    prices.push(prices[i - 1] * (1 + dailyReturn));
  }
  return prices;
}

// ═══════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════

export function runHorizonMetaTests(): {
  passed: number;
  failed: number;
  results: Array<{ name: string; passed: boolean; error?: string }>;
} {
  const results: Array<{ name: string; passed: boolean; error?: string }> = [];
  
  // Test 1: Determinism
  try {
    const service = new HorizonMetaService();
    const input = createTestInput();
    const result1 = service.compute(input);
    const result2 = service.compute(input);
    
    const eq = JSON.stringify(result1) === JSON.stringify(result2);
    results.push({
      name: 'Determinism',
      passed: eq,
      error: eq ? undefined : 'Results differ for same input',
    });
  } catch (err: any) {
    results.push({ name: 'Determinism', passed: false, error: err.message });
  }
  
  // Test 2: No realized data → decay=1
  try {
    const service = new HorizonMetaService();
    const input = createTestInput({ realizedClosesAfterAsOf: undefined });
    const result = service.compute(input);
    
    // Should have no divergences but consensus should exist
    const noDivergences = !result.divergences || result.divergences.length === 0;
    const hasConsensus = !!result.consensus;
    
    results.push({
      name: 'No realized data → no divergences',
      passed: noDivergences && hasConsensus,
      error: noDivergences ? undefined : 'Divergences computed without realized data',
    });
  } catch (err: any) {
    results.push({ name: 'No realized data', passed: false, error: err.message });
  }
  
  // Test 3: div > thr → decay < 1
  try {
    const service = new HorizonMetaService();
    // Create realized prices that diverge significantly from prediction
    // Prediction: +0.1% daily, Realized: -0.5% daily
    const spotClose = 100;
    const realizedPrices = generateRealizedPrices(spotClose, 50, -0.005); // -0.5% daily
    
    const input = createTestInput({
      realizedClosesAfterAsOf: realizedPrices,
    });
    
    const result = service.compute(input);
    
    // At least one horizon should have decay < 1
    const hasDecay = result.divergences?.some(d => d.decay < 0.99);
    
    results.push({
      name: 'Divergence causes decay',
      passed: !!hasDecay,
      error: hasDecay ? undefined : 'No decay despite divergence',
    });
  } catch (err: any) {
    results.push({ name: 'Divergence decay', passed: false, error: err.message });
  }
  
  // Test 4: Decay clamped >= 0.35
  try {
    const service = new HorizonMetaService();
    // Extreme divergence
    const spotClose = 100;
    const realizedPrices = generateRealizedPrices(spotClose, 50, -0.02); // -2% daily!
    
    const input = createTestInput({
      realizedClosesAfterAsOf: realizedPrices,
    });
    
    const result = service.compute(input);
    
    // All decays should be >= 0.35
    const allClamped = result.divergences?.every(d => d.decay >= 0.35) ?? true;
    
    results.push({
      name: 'Decay floor at 0.35',
      passed: allClamped,
      error: allClamped ? undefined : 'Decay below 0.35 floor',
    });
  } catch (err: any) {
    results.push({ name: 'Decay clamp', passed: false, error: err.message });
  }
  
  // Test 5: Weights sum == 1
  try {
    const service = new HorizonMetaService();
    const input = createTestInput();
    const result = service.compute(input);
    
    if (!result.consensus) throw new Error('No consensus');
    
    const sum = (Object.values(result.consensus.weightsEff) as number[])
      .reduce((a, b) => a + b, 0);
    
    const isOne = Math.abs(sum - 1.0) < 0.001;
    
    results.push({
      name: 'Weights sum to 1',
      passed: isOne,
      error: isOne ? undefined : `Weights sum to ${sum.toFixed(4)}`,
    });
  } catch (err: any) {
    results.push({ name: 'Weights sum', passed: false, error: err.message });
  }
  
  // Test 6: Consensus threshold mapping
  try {
    const service = new HorizonMetaService();
    
    // All bullish → BULLISH
    const bullishInput = createTestInput({
      biasByHorizon: { 30: 1, 90: 1, 180: 1, 365: 1 },
    });
    const bullishResult = service.compute(bullishInput);
    const isBullish = bullishResult.consensus?.consensusState === 'BULLISH';
    
    // All bearish → BEARISH
    const bearishInput = createTestInput({
      biasByHorizon: { 30: -1, 90: -1, 180: -1, 365: -1 },
    });
    const bearishResult = service.compute(bearishInput);
    const isBearish = bearishResult.consensus?.consensusState === 'BEARISH';
    
    // Mixed → HOLD
    const mixedInput = createTestInput({
      biasByHorizon: { 30: 1, 90: -1, 180: 1, 365: -1 },
    });
    const mixedResult = service.compute(mixedInput);
    const isHold = mixedResult.consensus?.consensusState === 'HOLD';
    
    results.push({
      name: 'Consensus BULLISH',
      passed: isBullish,
      error: isBullish ? undefined : `Got ${bullishResult.consensus?.consensusState}`,
    });
    
    results.push({
      name: 'Consensus BEARISH',
      passed: isBearish,
      error: isBearish ? undefined : `Got ${bearishResult.consensus?.consensusState}`,
    });
    
    results.push({
      name: 'Consensus HOLD (mixed)',
      passed: isHold,
      error: isHold ? undefined : `Got ${mixedResult.consensus?.consensusState}`,
    });
  } catch (err: any) {
    results.push({ name: 'Consensus mapping', passed: false, error: err.message });
  }
  
  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log('\n═══ HORIZON META TESTS ═══');
  for (const r of results) {
    const status = r.passed ? '✅' : '❌';
    console.log(`${status} ${r.name}${r.error ? `: ${r.error}` : ''}`);
  }
  console.log(`\nTotal: ${passed}/${passed + failed} passed\n`);
  
  return { passed, failed, results };
}
