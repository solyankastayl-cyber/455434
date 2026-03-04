/**
 * Step 3 Window Service
 * P0.1: Validation window management
 */

import { step3ConfigService } from './step3.config.service.js';

export class Step3WindowService {
  getValidationWindowMs(): number {
    const config = step3ConfigService.getConfig();
    return config.validationWindowMs;
  }

  getAcceleratedWindowMs(): number {
    const config = step3ConfigService.getConfig();
    if (!config.isAcceleratedAllowed) {
      console.warn('[Step3Window] Accelerated mode blocked in production');
      return config.validationWindowMs;
    }
    return config.acceleratedWindowMs;
  }
}

export const step3WindowService = new Step3WindowService();

console.log('[Step3WindowService] Loaded');
