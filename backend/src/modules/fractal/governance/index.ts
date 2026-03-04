/**
 * BLOCK 47-48 + 78.5 — Governance Module Index
 */

// BLOCK 47 — Guard
export * from './guard.types.js';
export * from './degeneration.monitor.js';
export * from './catastrophic.guard.js';
export * from './guard.policy.js';
export * from './guard.store.js';
export * from './guard.service.js';
export { guardRoutes } from './guard.routes.js';

// BLOCK 48 — Playbooks
export * from './playbooks/playbook.types.js';
export * from './playbooks/playbook.rules.js';
export * from './playbooks/playbook.engine.js';
export * from './playbooks/playbook.apply.service.js';
export { playbookRoutes } from './playbooks/playbook.routes.js';

// BLOCK 78.5 — Governance Lock (LIVE-only APPLY)
export { governanceLockService, GOVERNANCE_LOCK_CONFIG } from './governance-lock.service.js';
export { governanceLockRoutes } from './governance-lock.routes.js';
