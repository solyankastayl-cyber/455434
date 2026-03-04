# Fractal Governance Policy

## Governance Modes

| Mode | Description | Actions Allowed |
|------|-------------|----------------|
| `NORMAL` | System healthy | All read + operational |
| `PROTECTION` | Elevated risk | Read only, no new signals |
| `FROZEN_ONLY` | Contract frozen | Read only |
| `HALT` | Critical failure | Emergency mode |

## Guard Triggers

### Catastrophic Guard

Triggers when:
- `reliability < 0.4`
- `mcP95_DD > 0.60`
- `entropy > 0.85`
- `drift > 0.50`

Action: Switch to PROTECTION or HALT mode.

### Degeneration Monitor

Tracks:
- Rolling Sharpe degradation
- Hit rate decline
- Calibration drift

Action: Advisory playbook recommendation.

## Playbooks

### Available Playbooks

| Playbook | Trigger | Action |
|----------|---------|--------|
| FREEZE | Manual | Lock all parameters |
| INVESTIGATE | Guard alert | Review required |
| ROLLBACK | Performance drop | Revert to baseline |
| PROMOTE | Shadow better | Manual promotion |

### Playbook Rules

1. **No Auto-Promotion**: All promotions require manual confirmation
2. **No Auto-Rollback**: All rollbacks require manual review
3. **Audit Trail**: Every action logged with reason

## Shadow Divergence

### Purpose

Compare ACTIVE vs SHADOW model to determine if promotion is warranted.

### Requirements for Promotion

1. `resolvedCount >= 30`
2. `verdict = SHADOW_OUTPERFORMS`
3. `deltaSharpe > 0.1`
4. `calibration not degraded`

### Governance Actions (Manual Only)

- **Create Promotion Proposal**: Initiate formal review
- **Freeze Shadow**: Pause shadow signal generation
- **Archive Shadow**: Move to historical reference

## Freeze Protocol

### When Frozen

Blocked operations:
- UPDATE_WEIGHTS
- UPDATE_PRESETS
- UPDATE_CALIBRATION
- REPLACE_MODEL
- AUTO_TRAIN
- HYPEROPT

Allowed operations:
- GET_SIGNAL
- GET_CHART
- WRITE_SNAPSHOT
- RESOLVE_OUTCOMES
- AUDIT_LOG

### Freeze Stamp

Endpoint: `GET /api/fractal/v2.1/admin/freeze-stamp`

Returns:
- Contract version
- Contract hash
- Freeze audit verdict
- Guarantees list
