/**
 * S10.6I.0 — Indicator Registry
 * 
 * Central registry for all indicator calculators.
 * Manages definitions, dependencies, and calculation order.
 */

import {
  IndicatorCalculator,
  IndicatorDefinition,
  IndicatorCategory,
  IndicatorValue,
  IndicatorSnapshot,
  IndicatorInput,
  INDICATOR_IDS,
} from './indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// REGISTRY STATE
// ═══════════════════════════════════════════════════════════════

const calculators: Map<string, IndicatorCalculator> = new Map();
const definitions: Map<string, IndicatorDefinition> = new Map();

// ═══════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════

export function registerCalculator(calculator: IndicatorCalculator): void {
  const { id } = calculator.definition;
  
  if (calculators.has(id)) {
    console.warn(`[S10.6I] Overwriting calculator: ${id}`);
  }
  
  calculators.set(id, calculator);
  definitions.set(id, calculator.definition);
  
  console.log(`[S10.6I] Registered indicator: ${id} (${calculator.definition.category})`);
}

export function registerCalculators(calcs: IndicatorCalculator[]): void {
  for (const calc of calcs) {
    registerCalculator(calc);
  }
}

// ═══════════════════════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════════════════════

export function getCalculator(id: string): IndicatorCalculator | undefined {
  return calculators.get(id);
}

export function getDefinition(id: string): IndicatorDefinition | undefined {
  return definitions.get(id);
}

export function getAllDefinitions(): IndicatorDefinition[] {
  return Array.from(definitions.values());
}

export function getDefinitionsByCategory(category: IndicatorCategory): IndicatorDefinition[] {
  return getAllDefinitions().filter(d => d.category === category);
}

export function getRegisteredCount(): number {
  return calculators.size;
}

// ═══════════════════════════════════════════════════════════════
// CALCULATE ALL
// ═══════════════════════════════════════════════════════════════

export function calculateAll(input: IndicatorInput): IndicatorSnapshot {
  const startTime = Date.now();
  const indicators: IndicatorValue[] = [];
  
  // Calculate in dependency order (price structure first, then momentum, etc.)
  const order: IndicatorCategory[] = [
    'PRICE_STRUCTURE',
    'MOMENTUM',
    'VOLUME',
    'ORDER_BOOK',
    'POSITIONING',
    'WHALE_POSITIONING', // S10.W — Whale indicators last (depend on positioning)
  ];
  
  for (const category of order) {
    const categoryCalcs = Array.from(calculators.values())
      .filter(c => c.definition.category === category);
    
    for (const calc of categoryCalcs) {
      try {
        const value = calc.calculate(input);
        indicators.push(value);
      } catch (error) {
        console.error(`[S10.6I] Error calculating ${calc.definition.id}:`, error);
        // Continue with other indicators
      }
    }
  }
  
  // Build snapshot
  const byCategory: Record<IndicatorCategory, IndicatorValue[]> = {
    PRICE_STRUCTURE: [],
    MOMENTUM: [],
    VOLUME: [],
    ORDER_BOOK: [],
    POSITIONING: [],
    WHALE_POSITIONING: [],
  };
  
  const byId: Record<string, IndicatorValue> = {};
  
  for (const ind of indicators) {
    byCategory[ind.category].push(ind);
    byId[ind.id] = ind;
  }
  
  return {
    symbol: input.symbol,
    timestamp: Date.now(),
    indicators,
    byCategory,
    byId,
    calculatedAt: Date.now(),
    calculationMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════
// CALCULATE BY CATEGORY
// ═══════════════════════════════════════════════════════════════

export function calculateByCategory(
  input: IndicatorInput,
  category: IndicatorCategory
): IndicatorValue[] {
  const values: IndicatorValue[] = [];
  
  const categoryCalcs = Array.from(calculators.values())
    .filter(c => c.definition.category === category);
  
  for (const calc of categoryCalcs) {
    try {
      const value = calc.calculate(input);
      values.push(value);
    } catch (error) {
      console.error(`[S10.6I] Error calculating ${calc.definition.id}:`, error);
    }
  }
  
  return values;
}

// ═══════════════════════════════════════════════════════════════
// CALCULATE SINGLE
// ═══════════════════════════════════════════════════════════════

export function calculateSingle(
  input: IndicatorInput,
  indicatorId: string
): IndicatorValue | null {
  const calc = calculators.get(indicatorId);
  
  if (!calc) {
    console.warn(`[S10.6I] Unknown indicator: ${indicatorId}`);
    return null;
  }
  
  try {
    return calc.calculate(input);
  } catch (error) {
    console.error(`[S10.6I] Error calculating ${indicatorId}:`, error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY STATUS
// ═══════════════════════════════════════════════════════════════

export interface RegistryStatus {
  totalRegistered: number;
  byCategory: Record<IndicatorCategory, number>;
  missing: string[];
  ready: boolean;
}

export function getRegistryStatus(): RegistryStatus {
  const byCategory: Record<IndicatorCategory, number> = {
    PRICE_STRUCTURE: 0,
    MOMENTUM: 0,
    VOLUME: 0,
    ORDER_BOOK: 0,
    POSITIONING: 0,
    WHALE_POSITIONING: 0,
  };
  
  for (const calc of calculators.values()) {
    byCategory[calc.definition.category]++;
  }
  
  // Check for missing indicators
  const allIds = [
    ...Object.values(INDICATOR_IDS.PRICE_STRUCTURE),
    ...Object.values(INDICATOR_IDS.MOMENTUM),
    ...Object.values(INDICATOR_IDS.VOLUME),
    ...Object.values(INDICATOR_IDS.ORDER_BOOK),
    ...Object.values(INDICATOR_IDS.POSITIONING),
    ...Object.values(INDICATOR_IDS.WHALE_POSITIONING),
  ];
  
  const missing = allIds.filter(id => !calculators.has(id));
  
  return {
    totalRegistered: calculators.size,
    byCategory,
    missing,
    ready: missing.length === 0,
  };
}

console.log('[S10.6I] Indicator Registry loaded');
