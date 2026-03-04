/**
 * VERDICT STABILITY STORE
 * =======================
 * 
 * P3: Smart Caching Layer - Block 5
 * Stores last stable verdict state per symbol for smoothing.
 */

type Direction = 'UP' | 'DOWN' | 'FLAT';
type Action = 'BUY' | 'SELL' | 'HOLD' | 'AVOID';

export type StableVerdictState = {
  symbol: string;
  ts: number;
  direction: Direction;
  confidence: number;
  expectedMovePct: number;
  action: Action;
  positionSize: number;

  // Sticky direction helpers
  pendingDirection?: Direction;
  pendingCount?: number;

  // For shock detection
  lastMacroRegime?: string;
  lastRiskLevel?: string;
  lastFundingCrowdedness?: number;
};

export class VerdictStabilityStore {
  private map = new Map<string, StableVerdictState>();

  get(symbol: string): StableVerdictState | undefined {
    return this.map.get(symbol.toUpperCase());
  }

  set(symbol: string, state: StableVerdictState) {
    this.map.set(symbol.toUpperCase(), state);
  }

  clear(symbol?: string) {
    if (!symbol) {
      this.map.clear();
    } else {
      this.map.delete(symbol.toUpperCase());
    }
  }

  keys(): string[] {
    return Array.from(this.map.keys());
  }

  size(): number {
    return this.map.size;
  }
}

// Singleton instance
export const verdictStabilityStore = new VerdictStabilityStore();

console.log('[VerdictStabilityStore] Module loaded');
