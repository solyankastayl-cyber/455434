/**
 * Alerts Module Exports
 * 
 * Architecture layers:
 * A0 - Event Normalization
 * A1 - Deduplication Engine
 * A2 - Severity & Priority Engine
 * A3 - Grouping Engine
 * A4 - Dispatcher (TODO)
 */

// Core models and repositories
export * from './alert_rules.model.js';
export * from './alerts.model.js';
export * from './alert_rules.repository.js';
export * from './alerts.repository.js';
export * from './alerts.service.js';
export * from './alerts.routes.js';
export * from './alerts.schema.js';

// A0 - Event Normalization
export * from './normalization/index.js';

// A1 - Deduplication Engine
export * from './deduplication/index.js';

// A2 - Severity & Priority Engine
export * from './severity/index.js';

// A3 - Grouping Engine
export * from './grouping/index.js';

// A4 - Dispatcher Engine
export * from './dispatcher/index.js';
