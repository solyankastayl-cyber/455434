# Public API Contract — Twitter Parser Module

> **Version:** v4.2-final
> **Prefix:** `/api/v4/twitter`

This document defines the PUBLIC API for external consumers.

---

## Endpoints

### POST /twitter/sync

Sync cookies from Chrome Extension.

**Request:**
```json
{
  "cookies": [
    { "name": "auth_token", "value": "...", "domain": ".twitter.com" },
    { "name": "ct0", "value": "..." },
    { "name": "twid", "value": "..." }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "status": "SUCCESS",
  "message": "Cookies synced successfully",
  "sessionId": "abc123"
}
```

**Status values:**
- `SUCCESS` — all cookies valid, session created
- `PARTIAL` — some cookies missing, limited functionality
- `FAILED` — critical cookies missing

---

### POST /twitter/parse

Trigger manual parse for a target.

**Request:**
```json
{
  "targetId": "target_123"
}
```

**Response:**
```json
{
  "ok": true,
  "taskId": "task_456",
  "status": "PENDING"
}
```

---

### GET /twitter/status

Get current parsing status.

**Response:**
```json
{
  "ok": true,
  "session": {
    "status": "OK",
    "riskScore": 12
  },
  "lastParse": "2026-02-04T12:00:00Z",
  "nextParse": "2026-02-04T12:15:00Z"
}
```

---

### GET /twitter/targets

List user's parsing targets.

**Response:**
```json
{
  "ok": true,
  "targets": [
    {
      "id": "target_123",
      "type": "KEYWORD",
      "value": "bitcoin",
      "interval": 15,
      "enabled": true
    }
  ]
}
```

---

### GET /twitter/results

Get parsed tweets.

**Query params:**
- `targetId` — filter by target
- `since` — ISO timestamp
- `limit` — max results (default 100)

**Response:**
```json
{
  "ok": true,
  "tweets": [
    {
      "id": "tweet_789",
      "text": "...",
      "author": "@user",
      "createdAt": "2026-02-04T11:30:00Z"
    }
  ]
}
```

---

## Authentication

All endpoints require `Authorization: Bearer <api_key>` header.

Invalid/missing key → `401 Unauthorized`

---

## Error Format

```json
{
  "ok": false,
  "error": "SESSION_EXPIRED",
  "message": "Your Twitter session has expired. Please resync."
}
```
