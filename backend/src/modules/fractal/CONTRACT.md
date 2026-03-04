# Fractal Signal Contract v2.1.0

## Status: FROZEN

This contract is immutable. Any changes require version bump to v2.2.0+.

## Contract Hash

```
Version: v2.1.0
Hash: [computed at runtime]
```

## Response Schema

### FractalSignalContract

```typescript
interface FractalSignalContract {
  // Contract metadata
  contract: {
    module: 'fractal';
    version: 'v2.1.0';
    frozen: true;
    horizons: [7, 14, 30];
    symbol: 'BTC';
    generatedAt: string;      // ISO datetime
    asofCandleTs: number;     // Unix ms
    contractHash: string;     // SHA256
  };

  // Primary decision
  decision: {
    action: 'LONG' | 'SHORT' | 'HOLD';
    confidence: number;       // 0..1
    reliability: number;      // 0..1
    sizeMultiplier: number;   // 0..1
    preset: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  };

  // Per-horizon breakdown
  horizons: Array<{
    h: 7 | 14 | 30;
    action: 'LONG' | 'SHORT' | 'HOLD';
    expectedReturn: number;
    confidence: number;
    weight: number;
    dominant: boolean;
  }>;

  // Risk metrics
  risk: {
    maxDD_WF: number;
    mcP95_DD: number;
    entropy: number;
    tailBadge: 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL';
  };

  // Reliability
  reliability: {
    score: number;
    badge: 'HIGH' | 'WARN' | 'DEGRADED' | 'CRITICAL';
    effectiveN: number;
    driftScore: number;
  };

  // Market context
  market: {
    phase: string;
    sma200: 'ABOVE' | 'BELOW' | 'NEAR';
    currentPrice: number;
    volatility: number;
  };

  // Explainability
  explain: {
    topMatches: Array<{...}>;
    noTradeReasons: string[];
    influence: Array<{...}>;
  };

  // Governance state
  governance: {
    mode: 'NORMAL' | 'PROTECTION' | 'FROZEN_ONLY' | 'HALT';
    frozenVersionId: string;
    guardLevel: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  };
}
```

## Field Constraints

| Field | Type | Range | Required |
|-------|------|-------|----------|
| action | enum | LONG/SHORT/HOLD | ✓ |
| confidence | number | 0..1 | ✓ |
| reliability | number | 0..1 | ✓ |
| entropy | number | 0..1 | ✓ |
| horizons | array | length=3 | ✓ |

## Guarantees

1. **Symbol**: Only `BTC` supported
2. **Horizons**: Always `[7, 14, 30]`
3. **Frozen**: Always `true` in production
4. **No Auto-Promotion**: Manual governance only
5. **No Auto-Training**: Parameters locked

## Change Policy

- Breaking changes → New version (v2.2.0)
- New optional fields → Minor version (v2.1.1)
- Bug fixes → Patch notes only
