/**
 * COMBINED TERMINAL — API Routes
 * 
 * BLOCK C1 — Combined API Namespace /api/combined/v2.1/*
 * 
 * Provides aggregated view of BTC + SPX with integration layers.
 * 
 * LOCKED: Combined mode is locked until SPX finalization.
 * HTTP 423 = Locked status returned when ENABLE_COMBINED = false
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import COMBINED_CONFIG from './combined.config.js';
import { FEATURE_FLAGS, PROJECT_STATE } from '../../config/feature-flags.js';

// ═══════════════════════════════════════════════════════════════
// LOCK GUARD — Block all combined routes when locked
// ═══════════════════════════════════════════════════════════════

function combinedLockGuard(reply: FastifyReply): boolean {
  if (!FEATURE_FLAGS.ENABLE_COMBINED) {
    reply.code(423).send({
      ok: false,
      error: 'Combined mode locked until SPX finalization',
      httpStatus: 423,
      reason: 'COMBINED_MODE_LOCKED',
      projectState: PROJECT_STATE,
      unlockCondition: 'SPX_FINALIZED must be true first',
    });
    return true; // Request blocked
  }
  return false; // Allow request
}

export async function registerCombinedRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = COMBINED_CONFIG.apiPrefix;
  
  /**
   * GET /api/combined/v2.1/info
   * Combined Product info
   */
  fastify.get(`${prefix}/info`, async (req, reply) => {
    // Allow info endpoint even when locked (informational only)
    return {
      product: COMBINED_CONFIG.productName,
      version: COMBINED_CONFIG.version,
      status: FEATURE_FLAGS.ENABLE_COMBINED ? COMBINED_CONFIG.status : 'LOCKED',
      locked: !FEATURE_FLAGS.ENABLE_COMBINED,
      lockReason: FEATURE_FLAGS.ENABLE_COMBINED ? null : 'SPX must reach FINAL state before Combined integration',
      primaryAsset: COMBINED_CONFIG.primaryAsset,
      macroAsset: COMBINED_CONFIG.macroAsset,
      layers: COMBINED_CONFIG.layers,
      defaultProfile: COMBINED_CONFIG.defaultProfile,
      spxInfluence: COMBINED_CONFIG.spxInfluence,
      safety: COMBINED_CONFIG.safety,
      description: 'BTC×SPX Macro-Integrated Terminal with full cross-asset intelligence',
      projectState: PROJECT_STATE,
    };
  });
  
  /**
   * GET /api/combined/v2.1/terminal
   * Combined Terminal (aggregates BTC + SPX)
   * 
   * LOCKED until SPX finalization
   */
  fastify.get(`${prefix}/terminal`, async (req: FastifyRequest<{
    Querystring: {
      spxInfluence?: string;
      profile?: string;
    };
  }>, reply) => {
    // Check lock
    if (combinedLockGuard(reply)) return;
    
    const spxInfluenceEnabled = req.query.spxInfluence !== 'OFF';
    const profile = req.query.profile || COMBINED_CONFIG.defaultProfile;
    
    return {
      ok: true,
      status: COMBINED_CONFIG.status,
      message: 'Combined Terminal is under construction. BTC core available, SPX pending.',
      
      config: {
        spxInfluence: spxInfluenceEnabled,
        profile,
        layers: COMBINED_CONFIG.layers,
      },
      
      // Placeholder for actual data
      btcCore: {
        available: true,
        message: 'Use /api/btc/v2.1/terminal for BTC-only data',
      },
      
      spxCore: {
        available: false,
        message: 'SPX Terminal is under construction',
      },
      
      combinedKernel: {
        available: false,
        message: 'Combined decision kernel requires both BTC and SPX to be active',
      },
      
      nextSteps: [
        '1. Complete SPX Terminal (data adapter + backfill)',
        '2. Implement Combined Decision Kernel',
        '3. Add integration layers L1-L4',
        '4. Build Combined UI',
      ],
    };
  });
  
  /**
   * GET /api/combined/v2.1/status
   * Combined Build status
   */
  fastify.get(`${prefix}/status`, async (req, reply) => {
    // Allow status even when locked
    return {
      ok: true,
      product: COMBINED_CONFIG.productName,
      status: FEATURE_FLAGS.ENABLE_COMBINED ? COMBINED_CONFIG.status : 'LOCKED',
      locked: !FEATURE_FLAGS.ENABLE_COMBINED,
      projectState: PROJECT_STATE,
      progress: {
        config: true,
        routes: true,
        btcIntegration: true,
        spxIntegration: false,
        decisionKernel: false,
        layer1_macroGate: false,
        layer2_sizing: false,
        layer3_arbitration: false,
        layer4_learning: false,
        ui: false,
      },
      dependencies: {
        btcTerminal: 'READY',
        spxTerminal: FEATURE_FLAGS.SPX_FINALIZED ? 'READY' : 'BUILDING',
      },
      nextStep: FEATURE_FLAGS.SPX_FINALIZED 
        ? 'Implement Combined Decision Kernel'
        : 'Complete SPX finalization first (Attribution + Drift + Historical Calibration)',
    };
  });
  
  /**
   * GET /api/combined/v2.1/layers
   * Integration layers info
   * 
   * LOCKED until SPX finalization
   */
  fastify.get(`${prefix}/layers`, async (req, reply) => {
    // Check lock
    if (combinedLockGuard(reply)) return;
    
    return {
      ok: true,
      layers: COMBINED_CONFIG.layers,
      profiles: {
        CONSERVATIVE: {
          L1: true, L2: true, L3: false, L4: false,
          description: 'Only macro gates and sizing - no direction override',
        },
        BALANCED: {
          L1: true, L2: true, L3: true, L4: false,
          description: 'Full risk management including direction arbitration',
        },
        AGGRESSIVE: {
          L1: true, L2: true, L3: true, L4: true,
          description: 'Maximum integration with learning coupling',
        },
      },
    };
  });
  
  const lockStatus = FEATURE_FLAGS.ENABLE_COMBINED ? 'UNLOCKED' : 'LOCKED';
  fastify.log.info(`[Combined] Terminal routes registered at ${prefix}/* (${lockStatus})`);
}

export default registerCombinedRoutes;
