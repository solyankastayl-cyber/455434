# A3 - Grouping Engine Testing Guide

## Purpose
Test the Grouping Engine (A3) that answers:
**"Это новое событие или продолжение уже идущего поведения?"**

## Core Concepts
- **GroupKey** = scope + targetId + signalType (NOT severity, NOT time)
- **Lifecycle**: active → cooling → resolved
- **Severity Decay**: Events lose weight over time

---

## Test Scenarios

### 1️⃣ New Group Creation
**Input**: ScoredEvent for token `USDT` with `accumulation` signal
**Expected**:
- `isNewGroup: true`
- `status: 'active'`
- `eventCount: 1`
- `reason.summary`: "Large wallets started accumulating USDT"
- `reason.context`: "Just started"

```typescript
const scoredEvent = {
  normalizedEvent: {
    eventId: 'evt-001',
    userId: 'anonymous',
    signalType: 'accumulation',
    scope: 'token',
    targetId: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    targetMeta: { symbol: 'USDT' },
  },
  severityScore: 3.5,
  priority: 'high',
};

const result = await groupingEngine.process(scoredEvent);
expect(result.isNewGroup).toBe(true);
expect(result.group.status).toBe('active');
```

---

### 2️⃣ Group Update (Ongoing Behavior)
**Precondition**: Active group exists for USDT accumulation
**Input**: Another ScoredEvent for same groupKey
**Expected**:
- `isNewGroup: false`
- `eventCount` incremented
- `reason.context`: "2 events over Xh"

---

### 3️⃣ Priority Escalation
**Precondition**: Active group with `priority: 'medium'`
**Input**: ScoredEvent with `priority: 'high'`
**Expected**:
- `isEscalation: true`
- `group.priority: 'high'`
- `previousPriority: 'medium'`

---

### 4️⃣ Cooling Transition
**Precondition**: Active group, last update > 3h ago
**Input**: ScoredEvent with low severity
**Expected**:
- `status: 'cooling'`
- `isCoolingStart: true`
- `reason.summary` contains "slowing"

---

### 5️⃣ Resolution
**Precondition**: Cooling group, last update > 6h ago
**Input**: ScoredEvent with very low severity
**Expected**:
- `status: 'resolved'`
- `isResolution: true`
- `reason.context` contains "Ended after"

---

### 6️⃣ Severity Decay Calculation
**Test decay factors**:
| Hours Since | Decay Factor |
|-------------|--------------|
| 0-1h        | 1.0          |
| 1-3h        | 0.9          |
| 3-6h        | 0.7          |
| 6-12h       | 0.4          |
| 12h+        | 0.2          |

---

### 7️⃣ Different GroupKeys Stay Separate
**Scenario**:
1. Event: USDT accumulation → Group A
2. Event: USDT distribution → Group B (different!)
3. Event: USDC accumulation → Group C (different!)

**Expected**: 3 separate groups

---

### 8️⃣ Lifecycle Check Job
**Test** `runLifecycleCheck()`:
- Create active group with old `lastUpdatedAt`
- Run lifecycle check
- Verify transition to cooling/resolved

---

## API Test Commands

### Health Check
```bash
curl -s $(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)/api/health
```

### Check Backend Logs
```bash
tail -n 50 /var/log/supervisor/blockview_backend.*.log
```

---

## Acceptance Criteria (from spec)
✅ Поведение объединяется в 1 группу
✅ Пользователь не получает 10 одинаковых алертов
✅ Группа имеет понятный lifecycle
✅ Cooling ≠ resolved
✅ Reason читается как story, не как лог
