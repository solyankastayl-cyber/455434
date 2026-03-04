/**
 * Step 3 Config Service
 * P0.1: Validation window management
 */

import type { Step3Config, Step3Environment } from '../contracts/step3.types.js';

const DEFAULT_VALIDATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const ACCELERATED_VALIDATION_MS = 60 * 60 * 1000;  // 1 hour

class Step3ConfigService {
  private config: Step3Config;

  constructor() {
    const env = this.detectEnvironment();
    this.config = {
      environment: env,
      validationWindowMs: DEFAULT_VALIDATION_MS,
      acceleratedWindowMs: ACCELERATED_VALIDATION_MS,
      isAcceleratedAllowed: env !== 'production',
    };
    console.log(`[Step3Config] Initialized, env=${env}, accelerated=${this.config.isAcceleratedAllowed}`);
  }

  private detectEnvironment(): Step3Environment {
    const nodeEnv = process.env.NODE_ENV || 'development';
    if (nodeEnv === 'production') return 'production';
    if (nodeEnv === 'test') return 'test';
    return 'preview';
  }

  getConfig(): Step3Config {
    return { ...this.config };
  }

  getEnvironment(): Step3Environment {
    return this.config.environment;
  }

  canUseAcceleratedMode(): boolean {
    return this.config.isAcceleratedAllowed;
  }
}

export const step3ConfigService = new Step3ConfigService();

export function canUseAcceleratedMode(): boolean {
  return step3ConfigService.canUseAcceleratedMode();
}

export function getEnvironment(): Step3Environment {
  return step3ConfigService.getEnvironment();
}

console.log('[Step3ConfigService] Loaded');
