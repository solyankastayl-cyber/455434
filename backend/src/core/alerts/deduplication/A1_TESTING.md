# A1 - Deduplication Engine Testing Guide

## Test Cases (Acceptance Criteria)

### TC1: First Seen Event
**Input**: New accumulation event  
**Expected**: 
- dedupStatus = 'first_seen'
- occurrenceCount = 1
- Saved in DB

### TC2: Repeated Within Window
**Input**: Same accumulation event after 30 minutes  
**Expected**:
- dedupStatus = 'repeated'
- occurrenceCount = 2
- lastSeenAt updated

### TC3: Reset After Window
**Input**: Same accumulation event after 65 minutes (window = 60min)  
**Expected**:
- dedupStatus = 'first_seen'
- occurrenceCount = 1 (reset)
- firstSeenAt updated

### TC4: Different Targets Not Deduplicated
**Input**: 
- accumulation on Token A
- accumulation on Token B  
**Expected**:
- Both are 'first_seen'
- Different dedupKeys

### TC5: Threshold Bucket Rounding
**Input**:
- Event 1: threshold = 1,000,000
- Event 2: threshold = 1,050,000  
**Expected**:
- Same dedupKey (both round to 1,000,000)
- Event 2 is 'repeated'

### TC6: Different Directions Not Deduplicated
**Input**:
- accumulation (direction: in)
- distribution (direction: out)  
**Expected**:
- Different dedupKeys
- Both 'first_seen'

### TC7: Signal Type Windows
**Input**: Large move repeated after 25 minutes (window = 30min)  
**Expected**:
- dedupStatus = 'repeated'

**Input**: Large move repeated after 35 minutes  
**Expected**:
- dedupStatus = 'first_seen' (outside window)

## Manual Testing

### Test 1: Accumulation Spam
```bash
# Simulate 5 accumulation events in 10 minutes
curl -X POST http://localhost:8001/api/test/normalize-and-dedup \
  -H "Content-Type: application/json" \
  -d '{
    "type": "accumulation",
    "targetId": "0xdac1...1ec7",
    "netInflow": 2500000,
    "threshold": 1000000,
    "confidence": 0.9
  }'

# Expected result:
# 1st call: first_seen, count=1
# 2nd call: repeated, count=2
# 3rd call: repeated, count=3
# ...
```

### Test 2: Window Reset
```bash
# Event 1 at T=0
curl ... 
# Result: first_seen

# Wait 65 minutes (outside 60min window)

# Event 2 at T=65min
curl ...
# Result: first_seen, count=1 (reset)
```

### Test 3: dedupKey Stability
```bash
# Generate 3 events with slight threshold variations
# All should have same dedupKey

Event 1: threshold=1,000,000 → dedupKey=abc123
Event 2: threshold=1,050,000 → dedupKey=abc123 (same)
Event 3: threshold=1,100,000 → dedupKey=abc123 (same)
Event 4: threshold=2,000,000 → dedupKey=def456 (different)
```

## Query Examples

### Check Dedup Stats
```javascript
// Most frequently deduplicated signals
db.dedup_events.aggregate([
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 10 }
])

// Active dedup windows
db.dedup_events.find({
  lastSeenAt: { $gt: new Date(Date.now() - 60*60*1000) }
})
```

### Verify dedupKey Generation
```javascript
// All events for a specific signal
db.dedup_events.find({
  signalType: 'accumulation',
  targetId: '0xdac1...1ec7'
})
```

## Performance Expectations

- dedupKey generation: < 1ms
- DB lookup: < 5ms (with indexes)
- Total A1 processing: < 10ms per event
- Memory: negligible (only key storage)

## Monitoring

### Key Metrics
- Dedup rate: repeated / (first_seen + repeated)
- Window hit rate: events within window
- Average occurrence count
- dedupKey collisions (should be 0)

### Alerts
- High dedup rate (>80%) → spam detected
- Low dedup rate (<10%) → windows too short?
- High occurrence count (>20) → chronic repeater

---

**Status**: Ready for testing
**Next**: A2 - Severity Engine
