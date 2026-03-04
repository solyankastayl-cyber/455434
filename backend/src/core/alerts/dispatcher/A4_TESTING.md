# A4 - Dispatcher Testing Guide

## Purpose
Test the Dispatcher Engine (A4) that answers:
**"Когда, кому и как сообщать о группе событий?"**

## Core Concepts
- **Decision Matrix**: new → escalation → cooling → resolved
- **User Preferences**: minPriority, channels, notifyOn
- **Rate Limiting**: per-user (hourly), per-group (interval)
- **Channels**: UI, Telegram (no email)

---

## Test Scenarios

### 1️⃣ New Group Notification
**Input**: GroupedEvent with `isNewGroup: true`
**Expected**:
- `shouldDispatch: true`
- `type: 'new'`
- Notification created in history

```typescript
const preferences = {
  minPriority: 'medium',
  notifyOn: { new: true },
};

// Group with priority >= 'medium'
// Result: shouldDispatch = true
```

---

### 2️⃣ Silent Update (Ongoing Behavior)
**Input**: GroupedEvent with `isNewGroup: false`, `isEscalation: false`
**Expected**:
- `shouldDispatch: false`
- `reason: 'silent_update'`

---

### 3️⃣ Escalation Notification
**Input**: GroupedEvent with `isEscalation: true`
**Expected**:
- `shouldDispatch: true`
- `type: 'escalation'`

---

### 4️⃣ Below Min Priority
**Input**: Group with `priority: 'low'`, user `minPriority: 'medium'`
**Expected**:
- `shouldDispatch: false`
- `reason: 'below_min_priority'`

---

### 5️⃣ Hourly Rate Limit
**Setup**: User with `maxPerHour: 5`, already sent 5 notifications
**Expected**:
- `shouldDispatch: false`
- `reason: 'rate_limited_hourly'`

---

### 6️⃣ Per-Group Interval
**Setup**: User with `minIntervalMinutes: 15`, last notification 5min ago
**Expected**:
- `shouldDispatch: false`
- `reason: 'rate_limited_per_group'`

---

### 7️⃣ Telegram Notification
**Setup**: 
- User `telegram.enabled: true`, `telegram.chatId: '123456'`
- `TELEGRAM_BOT_TOKEN` env variable set

**Expected**:
- Message sent to Telegram API
- Format: emoji + asset + summary + context + action link

---

### 8️⃣ Cooling Notification (Optional)
**Input**: GroupedEvent with `isCoolingStart: true`
**User**: `notifyOn.cooling: true`
**Expected**:
- `shouldDispatch: true`
- `type: 'cooling'`

---

### 9️⃣ Resolution Notification
**Input**: GroupedEvent with `isResolution: true`
**User**: `notifyOn.resolution: true`
**Expected**:
- `shouldDispatch: true`
- `type: 'resolved'`

---

## API Endpoints for Testing

### Get User Preferences
```bash
curl -s "$API_URL/api/preferences" -H "x-user-id: anonymous"
```

### Update User Preferences
```bash
curl -s -X PUT "$API_URL/api/preferences" \
  -H "x-user-id: anonymous" \
  -H "Content-Type: application/json" \
  -d '{
    "minPriority": "low",
    "channels": ["ui", "telegram"],
    "notifyOn": {
      "new": true,
      "escalation": true,
      "cooling": false,
      "resolution": false
    },
    "telegram": {
      "chatId": "123456789",
      "enabled": true
    }
  }'
```

### Get Notifications
```bash
curl -s "$API_URL/api/notifications" -H "x-user-id: anonymous"
```

---

## Acceptance Criteria (from spec)
✅ User gets notification only when it matters
✅ No duplicate notifications for same behavior
✅ Escalations feel justified
✅ Telegram messages readable
✅ UI shows groups, not raw events

---

## Decision Matrix Reference

| Condition | Type | Notify? |
|-----------|------|---------|
| isNewGroup && priority >= minPriority | 'new' | ✅ |
| isEscalation && notifyOn.escalation | 'escalation' | ✅ |
| isCoolingStart && notifyOn.cooling | 'cooling' | ⚙️ |
| isResolution && notifyOn.resolution | 'resolved' | ⚙️ |
| ongoing update | - | ❌ (silent) |

---

## Rate Limiting Reference

| Type | Default | Purpose |
|------|---------|---------|
| maxPerHour | 10 | Prevent spam flood |
| minIntervalMinutes | 15 | Space out per-group alerts |
