# Twitter Parser Module — Scheduler

Scheduling and execution logic for Twitter parsing tasks.

## Components

### scheduler.logic.ts
Pure scheduling logic:
- Target selection
- Priority calculation
- Cooldown checks
- Quality-based frequency reduction

### worker.logic.ts
Pure worker logic:
- Error code extraction
- Retry decisions
- Cooldown triggers
- Execution path determination

### task-dispatcher.ts
Coordinates task execution with hooks for:
- Pre-execution validation
- Post-execution cleanup
- Error handling

### adapters/
Converters between legacy mongoose models and module types:
- `legacy-task.adapter.ts` — Task conversion
- `legacy-target.adapter.ts` — Target conversion

## Usage

The scheduler module provides pure logic that can be used by the host application.
Actual mongoose operations remain in the host's services.

```typescript
import { schedulerLogic } from './scheduler/scheduler.logic.js';
import { fromLegacyTarget } from './scheduler/adapters/legacy-target.adapter.js';

// Convert mongoose targets to module targets
const targets = mongooseTargets.map(fromLegacyTarget);

// Plan tasks
const batch = schedulerLogic.planTasks({
  ownerUserId,
  targets,
  pendingTargetIds,
  remainingBudget,
  qualityStatuses,
});
```

## Configuration

See `types.ts` for:
- `PRIORITY_CONFIG` — Priority calculation constants
- `WORKER_CONFIG` — Worker timing constants
