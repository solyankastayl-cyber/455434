# A2 - Severity & Priority Engine Testing Guide

## Test Cases (Acceptance Criteria)

### TC1: High Magnitude = High Priority
**Input**: 
- value = 10x baseline
- confidence = 0.9
- first_seen

**Expected**:
- magnitudeScore ≈ 1.0
- severityScore ≈ 1.08 (with novelty boost)
- priority = 'medium' or 'high'

### TC2: Low Confidence Reduces Severity
**Input**:
- value = 10x baseline
- confidence = 0.3 (low)
- first_seen

**Expected**:
- confidenceMultiplier = 0.65
- severityScore < TC1
- priority = 'low' or 'medium'

### TC3: First_Seen > Repeated
**Input A** (first_seen):
- value = 5x baseline
- confidence = 0.8
- first_seen

**Input B** (repeated):
- Same metrics
- repeated

**Expected**:
- severityScore(A) > severityScore(B)
- noveltyMultiplier: 1.2 vs 1.0

### TC4: Persistence Bonus
**Input**:
- value = 3x baseline
- confidence = 0.7
- repeated
- occurrenceCount = 5

**Expected**:
- persistenceBonus = +0.5
- severityScore higher than without bonus
- reason mentions "sustained behavior"

### TC5: Reason Human-Readable
**Input**: accumulation, 2.5x baseline, 3 occurrences

**Expected reason**:
```
summary: "Large wallets are consistently accumulating USDT (sustained pattern)"
details: [
  "Activity is 150% above normal baseline",
  "Observed 3 times, showing sustained behavior",
  "Data confidence: High (92%)",
  "Notable activity worth monitoring"
]
```

### TC6: Priority Boundaries
**Severity = 3.5**: priority = 'high'  
**Severity = 3.4**: priority = 'medium'  
**Severity = 2.0**: priority = 'medium'  
**Severity = 1.9**: priority = 'low'

### TC7: Stability (No Flicker)
**Input**: Multiple events with slight variations

**Expected**:
- Severity should NOT flicker between buckets
- log10 smooths small variations
- Threshold bucketing (from A1) helps

## Manual Testing

### Test 1: Magnitude Scaling
```bash
# Test different magnitude levels
baseline = 1,000,000

# Test cases:
value = 1,000,000  → ratio=1   → log10=0.0 → magnitude=0.0
value = 2,000,000  → ratio=2   → log10=0.3 → magnitude=0.3
value = 10,000,000 → ratio=10  → log10=1.0 → magnitude=1.0
value = 100,000,000 → ratio=100 → log10=2.0 → magnitude=2.0

# Expected: Logarithmic scaling prevents over-weighting large values
```

### Test 2: Confidence Impact
```bash
# Same event, different confidence
Event 1: confidence=0.9 → multiplier=0.95 → high severity
Event 2: confidence=0.5 → multiplier=0.75 → reduced severity
Event 3: confidence=0.2 → multiplier=0.60 → low severity

# Expected: Low confidence significantly reduces priority
```

### Test 3: Novelty vs Persistence
```bash
# First occurrence with high magnitude
Event A: first_seen, count=1, magnitude=1.5
→ novelty=1.2, persistence=0
→ severity ≈ 1.8

# Repeated with persistence
Event B: repeated, count=5, magnitude=1.5
→ novelty=1.0, persistence=+0.5
→ severity ≈ 2.0

# Expected: Persistence can compensate for novelty loss
```

### Test 4: Real-World Scenarios

**Scenario 1: Whale Accumulation**
```
signalType: accumulation
value: 5,000,000 (5x baseline)
confidence: 0.95
first_seen, count=1

Expected:
- magnitudeScore ≈ 0.7
- severityScore ≈ 0.8
- priority: medium
- summary: "Large wallets are consistently accumulating USDT"
```

**Scenario 2: Sustained Smart Money Exit**
```
signalType: smart_money_exit
value: 3,000,000 (3x baseline)
confidence: 0.85
repeated, count=4

Expected:
- magnitudeScore ≈ 0.48
- persistenceBonus = +0.3
- severityScore ≈ 0.78
- priority: medium
- summary: "...wallets are exiting USDT (sustained pattern)"
```

**Scenario 3: Large Move (High Priority)**
```
signalType: large_move
value: 50,000,000 (100x baseline)
confidence: 0.9
first_seen, count=1

Expected:
- magnitudeScore ≈ 2.0 (log10(100))
- severityScore ≈ 2.28
- priority: medium or high
- details: "Activity is 9900% above normal baseline"
```

## Score Component Analysis

### Example Calculation:

```typescript
Input:
  value = 5,000,000
  baseline = 1,000,000
  confidence = 0.8
  dedupStatus = 'first_seen'
  occurrenceCount = 1

Calculation:
  magnitudeScore = log10(5) = 0.699
  confidenceMultiplier = 0.5 + (0.8 * 0.5) = 0.9
  noveltyMultiplier = 1.2 (first_seen)
  persistenceBonus = 0 (count=1)
  
  severityScore = 0.699 * 0.9 * 1.2 + 0
                = 0.754
  
  priority = 'low' (< 2.0)
  
  reason = {
    summary: "Large wallets are consistently accumulating USDT",
    details: [
      "Activity is 400% above normal baseline",
      "Data confidence: High (80%)"
    ]
  }
```

## Performance Expectations

- Severity calculation: < 1ms per event
- No external API calls
- Pure computation (deterministic)
- Memory: negligible

## Monitoring Metrics

### Distribution
- % events in each priority bucket
- Average severity score per signal type
- Confidence distribution vs priority

### Quality
- User feedback: "Was this alert useful?"
- False positive rate per priority
- Alert fatigue indicators

### Tuning
- If too many 'low' → adjust thresholds
- If too many 'high' → increase cutoff
- Monitor reason quality (user surveys)

---

**Status**: Ready for testing
**Next**: A3 - Grouping Engine (lifecycle, escalation)
