/**
 * HORIZON POLICY REGRESSION TEST
 * 
 * P1: Ensures SPX horizons give different windowLen even if legacy windowLen=60 is in Mongo
 * 
 * Test invariants:
 * 1. BTC/SPX: Different horizons → different windowLen (policy strategy)
 * 2. DXY: All horizons → same windowLen (fixed strategy by design)
 * 3. Legacy single windowLen in Mongo doesn't override horizon-specific policy
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolveWindowLenForHorizon, getRuntimeEngineConfig } from '../modules/fractal/config/runtime-config.service.js';
import { resolveWindowLen } from '../modules/shared/horizon-policy.service.js';
import type { HorizonKey } from '../modules/fractal/config/horizon.config.js';

describe('HorizonPolicy Regression', () => {
  
  describe('HorizonPolicy.resolveWindowLen', () => {
    it('should return 45 for TIMING horizons (7d, 14d, 30d)', () => {
      expect(resolveWindowLen('7d')).toBe(45);
      expect(resolveWindowLen('14d')).toBe(45);
      expect(resolveWindowLen('30d')).toBe(45);
    });
    
    it('should return 60 for TACTICAL horizon (90d)', () => {
      expect(resolveWindowLen('90d')).toBe(60);
    });
    
    it('should return 120 for STRUCTURE horizon (180d)', () => {
      expect(resolveWindowLen('180d')).toBe(120);
    });
    
    it('should return 180 for STRUCTURE horizon (365d)', () => {
      expect(resolveWindowLen('365d')).toBe(180);
    });
  });
  
  describe('SPX windowLen resolution', () => {
    it('should use policy strategy by default', async () => {
      const config = await getRuntimeEngineConfig('SPX');
      expect(config.windowLenStrategy).toBe('policy');
    });
    
    it('should resolve different windowLen for different horizons', async () => {
      const config = await getRuntimeEngineConfig('SPX');
      
      const horizons: HorizonKey[] = ['90d', '180d', '365d'];
      const windowLens = horizons.map(h => resolveWindowLenForHorizon(config, h));
      
      // 90d → 60, 180d → 120, 365d → 180
      expect(windowLens[0]).toBe(60);   // 90d
      expect(windowLens[1]).toBe(120);  // 180d
      expect(windowLens[2]).toBe(180);  // 365d
      
      // All should be different
      const uniqueWindowLens = new Set(windowLens);
      expect(uniqueWindowLens.size).toBe(3);
    });
    
    it('should NOT be affected by legacy single windowLen in config', async () => {
      const config = await getRuntimeEngineConfig('SPX');
      
      // Even if fixedWindowLen is set, policy strategy should ignore it
      const windowLen180d = resolveWindowLenForHorizon(config, '180d');
      const windowLen365d = resolveWindowLenForHorizon(config, '365d');
      
      // Should use HorizonPolicy, not fixedWindowLen
      expect(windowLen180d).toBe(120);
      expect(windowLen365d).toBe(180);
      expect(windowLen180d).not.toBe(config.fixedWindowLen);
      expect(windowLen365d).not.toBe(config.fixedWindowLen);
    });
  });
  
  describe('DXY windowLen resolution', () => {
    it('should use fixed strategy by default', async () => {
      const config = await getRuntimeEngineConfig('DXY');
      expect(config.windowLenStrategy).toBe('fixed');
    });
    
    it('should use same windowLen for all horizons (fixed strategy)', async () => {
      const config = await getRuntimeEngineConfig('DXY');
      
      const horizons: HorizonKey[] = ['90d', '180d', '365d'];
      const windowLens = horizons.map(h => resolveWindowLenForHorizon(config, h));
      
      // All should be the same (365)
      expect(windowLens[0]).toBe(365);
      expect(windowLens[1]).toBe(365);
      expect(windowLens[2]).toBe(365);
    });
  });
  
  describe('BTC windowLen resolution', () => {
    it('should use policy strategy by default', async () => {
      const config = await getRuntimeEngineConfig('BTC');
      expect(config.windowLenStrategy).toBe('policy');
    });
    
    it('should resolve different windowLen for different horizons', async () => {
      const config = await getRuntimeEngineConfig('BTC');
      
      const horizons: HorizonKey[] = ['90d', '180d', '365d'];
      const windowLens = horizons.map(h => resolveWindowLenForHorizon(config, h));
      
      expect(windowLens[0]).toBe(60);   // 90d
      expect(windowLens[1]).toBe(120);  // 180d
      expect(windowLens[2]).toBe(180);  // 365d
    });
  });
  
  describe('horizonPolicyOverrides', () => {
    it('should allow override of specific horizon', async () => {
      // Mock config with override
      const mockConfig = {
        windowLenStrategy: 'policy' as const,
        horizonPolicyOverrides: { '180d': 100 },  // Override 180d to 100
        fixedWindowLen: 60,
        topK: 25,
        similarityMode: 'zscore' as const,
        minGapDays: 60,
        ageDecayLambda: 0,
        regimeConditioning: true,
        source: 'static' as const,
      };
      
      // 90d should use policy (60)
      expect(resolveWindowLenForHorizon(mockConfig, '90d')).toBe(60);
      
      // 180d should use override (100)
      expect(resolveWindowLenForHorizon(mockConfig, '180d')).toBe(100);
      
      // 365d should use policy (180)
      expect(resolveWindowLenForHorizon(mockConfig, '365d')).toBe(180);
    });
  });
});
