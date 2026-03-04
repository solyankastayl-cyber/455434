/**
 * STEP 3 MODULE INDEX
 * ===================
 * 
 * P0.1: Validation window management (Accelerated 60min → 24h)
 * 
 * Guards:
 * - ❌ ACCELERATED mode BLOCKED in PRODUCTION
 * - ✅ Audit log for non-prod shortcuts
 */

export * from './contracts/step3.types.js';
export * from './services/step3.config.service.js';
export * from './services/step3.window.service.js';
export { step3Routes } from './routes/step3.routes.js';

console.log('[Step3] Module initialized (P0.1 Accelerated Validation)');
