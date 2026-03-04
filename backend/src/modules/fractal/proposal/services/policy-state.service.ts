/**
 * BLOCK 79 — Policy State Service
 * 
 * Manages current policy state and hash computation.
 * Supports apply/rollback operations.
 */

import crypto from 'crypto';

interface PolicyState {
  version: string;
  tierWeights: Record<string, number>;
  divergencePenalties: Record<string, number>;
  phaseMultipliers: Record<string, number>;
  thresholds: Record<string, number>;
}

const DEFAULT_POLICY: PolicyState = {
  version: 'v2.1.0',
  tierWeights: {
    STRUCTURE: 0.520,
    TACTICAL: 0.360,
    TIMING: 0.120,
  },
  divergencePenalties: {
    A: 0.000,
    B: 0.020,
    C: 0.050,
    D: 0.100,
    F: 0.200,
  },
  phaseMultipliers: {
    A: 1.200,
    B: 1.100,
    C: 1.000,
    D: 0.900,
    F: 0.700,
  },
  thresholds: {
    minConfidence: 0.65,
    maxDrawdown: 0.15,
    minSharpe: 0.5,
  },
};

// In-memory policy state (for demo; in production, persist to DB)
const policyHistory: Map<string, PolicyState> = new Map();

class PolicyStateService {
  private currentPolicy: PolicyState;
  private currentHash: string;

  constructor() {
    this.currentPolicy = { ...DEFAULT_POLICY };
    this.currentHash = this.computeHash(this.currentPolicy);
    
    // Store initial state
    policyHistory.set(this.currentHash, { ...this.currentPolicy });
  }

  getPolicy(): PolicyState {
    return { ...this.currentPolicy };
  }

  getHash(): string {
    return this.currentHash;
  }

  getVersion(): string {
    return this.currentPolicy.version;
  }

  /**
   * Apply deltas to current policy
   * Returns new hash
   */
  applyDeltas(deltas: any): { previousHash: string; newHash: string } {
    const previousHash = this.currentHash;
    const previousPolicy = { ...this.currentPolicy };
    
    // Store previous state for rollback
    policyHistory.set(previousHash, previousPolicy);

    // Apply deltas
    if (deltas.tierWeights) {
      this.currentPolicy.tierWeights = {
        ...this.currentPolicy.tierWeights,
        ...deltas.tierWeights,
      };
    }

    if (deltas.divergencePenalties) {
      this.currentPolicy.divergencePenalties = {
        ...this.currentPolicy.divergencePenalties,
        ...deltas.divergencePenalties,
      };
    }

    if (deltas.phaseMultipliers) {
      this.currentPolicy.phaseMultipliers = {
        ...this.currentPolicy.phaseMultipliers,
        ...deltas.phaseMultipliers,
      };
    }

    if (deltas.thresholds) {
      this.currentPolicy.thresholds = {
        ...this.currentPolicy.thresholds,
        ...deltas.thresholds,
      };
    }

    // Compute new hash
    this.currentHash = this.computeHash(this.currentPolicy);
    
    // Store new state
    policyHistory.set(this.currentHash, { ...this.currentPolicy });

    console.log(`[PolicyState] Applied deltas: ${previousHash} → ${this.currentHash}`);

    return { previousHash, newHash: this.currentHash };
  }

  /**
   * Restore policy from hash (for rollback)
   */
  restoreFromHash(hash: string): boolean {
    const policy = policyHistory.get(hash);
    
    if (!policy) {
      console.error(`[PolicyState] Cannot restore: hash ${hash} not found`);
      return false;
    }

    this.currentPolicy = { ...policy };
    this.currentHash = hash;
    
    console.log(`[PolicyState] Restored to hash: ${hash}`);
    return true;
  }

  /**
   * Get policy by hash (for audit/display)
   */
  getPolicyByHash(hash: string): PolicyState | null {
    return policyHistory.get(hash) || null;
  }

  private computeHash(policy: PolicyState): string {
    const content = JSON.stringify({
      tierWeights: policy.tierWeights,
      divergencePenalties: policy.divergencePenalties,
      phaseMultipliers: policy.phaseMultipliers,
      thresholds: policy.thresholds,
    });
    
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
      .slice(0, 12);
  }

  /**
   * Get diff between two hashes
   */
  getDiff(hashA: string, hashB: string): any {
    const policyA = policyHistory.get(hashA);
    const policyB = policyHistory.get(hashB);
    
    if (!policyA || !policyB) return null;

    return {
      tierWeights: this.computeDelta(policyA.tierWeights, policyB.tierWeights),
      divergencePenalties: this.computeDelta(policyA.divergencePenalties, policyB.divergencePenalties),
      phaseMultipliers: this.computeDelta(policyA.phaseMultipliers, policyB.phaseMultipliers),
      thresholds: this.computeDelta(policyA.thresholds, policyB.thresholds),
    };
  }

  private computeDelta(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
    const delta: Record<string, number> = {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    
    for (const key of keys) {
      const diff = (b[key] || 0) - (a[key] || 0);
      if (Math.abs(diff) > 0.0001) {
        delta[key] = diff;
      }
    }
    
    return delta;
  }
}

export const policyStateService = new PolicyStateService();

export default policyStateService;
