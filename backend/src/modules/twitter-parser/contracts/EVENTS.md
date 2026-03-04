# Events Contract — Twitter Parser Module

> **Version:** v4.2-final

This document defines all events emitted by the Twitter Parser Module.

---

## Event Structure

```typescript
interface TwitterEvent {
  type: TwitterEventType;
  scope: 'USER' | 'SYSTEM';
  userId?: string;          // only for USER events
  data: Record<string, any>;
  timestamp: Date;
}
```

---

## USER Events

Events specific to a user's session/targets.

### NEW_TWEETS

New tweets fetched for a target.

```json
{
  "type": "NEW_TWEETS",
  "scope": "USER",
  "userId": "user_123",
  "data": {
    "targetId": "target_456",
    "targetValue": "bitcoin",
    "count": 15
  }
}
```

---

### SESSION_EXPIRED

User's Twitter session expired.

```json
{
  "type": "SESSION_EXPIRED",
  "scope": "USER",
  "userId": "user_123",
  "data": {
    "sessionId": "session_456",
    "reason": "Redirected to login"
  }
}
```

---

### TARGET_COOLDOWN

Target placed on cooldown due to empty results.

```json
{
  "type": "TARGET_COOLDOWN",
  "scope": "USER",
  "userId": "user_123",
  "data": {
    "targetId": "target_456",
    "targetValue": "rare_keyword",
    "duration": 900,
    "reason": "5 consecutive empty results"
  }
}
```

---

### HIGH_RISK

Session risk score exceeded threshold.

```json
{
  "type": "HIGH_RISK",
  "scope": "USER",
  "userId": "user_123",
  "data": {
    "sessionId": "session_456",
    "riskScore": 85,
    "threshold": 70
  }
}
```

---

### PARSE_ABORTED

Parse task aborted due to error.

```json
{
  "type": "PARSE_ABORTED",
  "scope": "USER",
  "userId": "user_123",
  "data": {
    "taskId": "task_456",
    "targetId": "target_789",
    "error": "RATE_LIMIT",
    "attempt": 2
  }
}
```

---

## SYSTEM Events

Events for operators/admins.

### PARSER_DOWN

Parser health check failed.

```json
{
  "type": "PARSER_DOWN",
  "scope": "SYSTEM",
  "data": {
    "lastUp": "2026-02-04T12:00:00Z",
    "error": "Connection refused"
  }
}
```

---

### PARSER_UP

Parser recovered from DOWN state.

```json
{
  "type": "PARSER_UP",
  "scope": "SYSTEM",
  "data": {
    "downtime": 120
  }
}
```

---

### ABORT_RATE_HIGH

Abort rate exceeded threshold.

```json
{
  "type": "ABORT_RATE_HIGH",
  "scope": "SYSTEM",
  "data": {
    "rate1h": 25,
    "rate24h": 15,
    "threshold": 20
  }
}
```

---

## Notification Sink Interface

```typescript
interface NotificationSink {
  send(event: TwitterEvent): Promise<void>;
}
```

Current implementations:
- `TelegramNotificationSink` — sends to Telegram

Future:
- `SlackNotificationSink`
- `WebhookNotificationSink`
- `KafkaNotificationSink`

---

## Dedupe Rules

| Event Type | Dedupe TTL |
|------------|------------|
| NEW_TWEETS | 5 min |
| SESSION_EXPIRED | 30 min |
| TARGET_COOLDOWN | 15 min |
| HIGH_RISK | 30 min |
| PARSE_ABORTED | 5 min |
| PARSER_DOWN | 30 min |
| PARSER_UP | 5 min |
| ABORT_RATE_HIGH | 30 min |
