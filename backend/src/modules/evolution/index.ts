/**
 * EVOLUTION MODULE INDEX
 * 
 * Block 1 & 2: Added HealthState and HealthSnapshot exports.
 */

// Types
export type { 
  Horizon, 
  Outcome, 
  CredKey, 
  CredState,
  HealthState,      // Block 1
  HealthSnapshot,   // Block 1
} from "./contracts/evolution.types.js";

// Services
export { CredibilityService } from "./runtime/credibility.service.js";
export { OutcomeService } from "./runtime/outcome.service.js";
export type { PricePort } from "./runtime/price.port.js";

// Adapters
export { RealPriceAdapter } from "./adapters/real-price.adapter.js";

// Cron
export { startEvolutionCron } from "./runtime/cron.js";

// Models
export { OutcomeModel } from "./storage/outcome.model.js";
export { CredibilityModel } from "./storage/credibility.model.js";

console.log('[Evolution] Module loaded (Block 1 & 2: health integration)');
