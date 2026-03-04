/**
 * Step 3 Types - Accelerated Validation
 */

export type Step3Environment = 'preview' | 'production' | 'test';

export interface Step3Config {
  environment: Step3Environment;
  validationWindowMs: number;
  acceleratedWindowMs: number;
  isAcceleratedAllowed: boolean;
}

console.log('[Step3] Types loaded');
