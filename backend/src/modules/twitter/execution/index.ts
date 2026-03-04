// B2/B3 Execution Core - Module Entry Point

export * from './types.js';
export * from './slot.selector.js';
export * from './counters.service.js';
export * from './cooldown.service.js';
export * from './dispatcher.js';
export * from './executor.service.js';
export * from './execution.adapter.js';

// Queue (P2: Mongo-backed)
export * from './queue/task.model.js';
export * from './queue/mongo.queue.js';
export * from './queue/live.queue.js';  // Legacy, kept for compatibility

// Worker (P2: Mongo-backed)
export * from './worker/mongo.worker.js';
export * from './worker/task.worker.js';  // Legacy

// B3 additions
export * from './health/slot.health.service.js';
export * from './dispatcher/remote.dispatcher.js';
export * from './storage/index.js';
export * from './storage/storage.service.js';
