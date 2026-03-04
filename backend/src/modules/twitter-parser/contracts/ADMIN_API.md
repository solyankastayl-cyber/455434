# Admin API Contract — Twitter Parser Module

> **Version:** v4.2-final
> **Prefix:** `/api/v4/admin/twitter/system`

This document defines the ADMIN API for operators and DevOps.

---

## Endpoints

### GET /sessions

List all sessions with status.

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "session_123",
      "userId": "user_456",
      "accountId": "acc_789",
      "status": "OK",
      "riskScore": 15,
      "version": 3,
      "updatedAt": "2026-02-04T12:00:00Z"
    }
  ]
}
```

**Query params:**
- `status` — filter by status (OK, STALE, EXPIRED, INVALID)

---

### GET /tasks

List tasks with filters.

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "task_123",
      "scope": "USER",
      "status": "DONE",
      "targetId": "target_456",
      "attempt": 1,
      "result": { "fetched": 10, "saved": 8 },
      "completedAt": "2026-02-04T12:00:00Z"
    }
  ]
}
```

**Query params:**
- `status` — PENDING, RUNNING, DONE, FAILED
- `scope` — USER, SYSTEM
- `limit` — max results

---

### GET /health

System health overview.

**Response:**
```json
{
  "ok": true,
  "data": {
    "parser": "UP",
    "worker": "ONLINE",
    "queueSize": 0,
    "abortRate1h": 0,
    "abortRate24h": 0
  }
}
```

---

### GET /worker

Worker and queue details.

**Response:**
```json
{
  "ok": true,
  "data": {
    "worker": {
      "status": "ONLINE",
      "currentTasks": 0,
      "maxConcurrent": 3
    },
    "queue": {
      "pending": 0,
      "running": 0,
      "done": 15,
      "failed": 0
    }
  }
}
```

---

### GET /quality

Parser quality metrics.

**Response:**
```json
{
  "ok": true,
  "data": {
    "summary": {
      "total": 10,
      "healthy": 8,
      "degraded": 2,
      "unstable": 0,
      "avgScore": 85,
      "healthRate": 80
    },
    "degradedTargets": [
      {
        "targetId": "target_123",
        "status": "DEGRADED",
        "emptyStreak": 6
      }
    ]
  }
}
```

---

## Actions

### POST /parse

Force parse task creation.

**Request:**
```json
{
  "targetId": "target_123",
  "scope": "SYSTEM"
}
```

**Response:**
```json
{
  "ok": true,
  "taskId": "task_456"
}
```

---

### POST /sessions/:id/resync

Force session resync (mark as STALE).

**Response:**
```json
{
  "ok": true,
  "message": "Session marked for resync"
}
```

---

### POST /tasks/:id/retry

Retry failed task.

**Response:**
```json
{
  "ok": true,
  "newTaskId": "task_789"
}
```

---

## Authentication

Admin endpoints require admin-level API key.
