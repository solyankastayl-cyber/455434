/**
 * Actor Feature Provider (P0.6)
 * 
 * Extracts ML features from Actor Intelligence module.
 */

import {
  ProviderContext,
  ProviderResult,
  ActorFeatureKey,
  FeatureValue
} from '../types/feature.types.js';
import { ActorProfileModel } from '../../actor_intelligence/actor_profile.model.js';
import { ActorEventModel } from '../../actor_intelligence/actor_event.model.js';

// ============================================
// Types
// ============================================

export type ActorFeatures = Partial<Record<ActorFeatureKey, FeatureValue>>;

// ============================================
// Actor Provider
// ============================================

export async function extractActorFeatures(
  ctx: ProviderContext
): Promise<ProviderResult<ActorFeatures>> {
  const startTime = Date.now();
  const errors: string[] = [];
  const features: ActorFeatures = {};
  
  try {
    // Find actor profile for this wallet/entity
    const profile = await ActorProfileModel.findOne({
      $or: [
        { actorId: ctx.entityId },
        { primaryAddress: { $regex: new RegExp(`^${ctx.entityId}$`, 'i') } }
      ]
    }).lean();
    
    if (!profile) {
      return {
        features: createNullActorFeatures(),
        source: 'ACTOR',
        timestamp: new Date(),
        errors: [],
        durationMs: Date.now() - startTime
      };
    }
    
    // Get actor events in window
    const events = await ActorEventModel.find({
      actorId: profile.actorId,
      createdAt: {
        $gte: ctx.windowStart,
        $lte: ctx.windowEnd
      }
    }).lean();
    
    // Extract features from profile
    features.actor_confidence = profile.confidenceScore || 0;
    features.actor_patternCount = events.length;
    
    // Get pattern scores from profile
    if (profile.patternScores) {
      features.actor_repeatBridgeScore = profile.patternScores.repeatBridge || 0;
      features.actor_routeDominance = profile.patternScores.routeDominance || 0;
    } else {
      features.actor_repeatBridgeScore = 0;
      features.actor_routeDominance = 0;
    }
    
    // Cluster size - for now just 1 (single wallet)
    features.actor_clusterSize = 1;
    
    // Risk tier based on confidence level
    features.actor_riskTier = calculateRiskTier(profile.confidenceLevel || 'IGNORED');
    
  } catch (err) {
    errors.push(`Actor provider error: ${(err as Error).message}`);
    return {
      features: createNullActorFeatures(),
      source: 'ACTOR',
      timestamp: new Date(),
      errors,
      durationMs: Date.now() - startTime
    };
  }
  
  return {
    features,
    source: 'ACTOR',
    timestamp: new Date(),
    errors,
    durationMs: Date.now() - startTime
  };
}

// ============================================
// Helpers
// ============================================

function calculateRiskTier(level: string): number {
  switch (level) {
    case 'HIGH': return 3;
    case 'MEDIUM': return 2;
    case 'LOW': return 1;
    case 'IGNORED':
    default: return 0;
  }
}

function createNullActorFeatures(): ActorFeatures {
  return {
    actor_confidence: null,
    actor_patternCount: null,
    actor_repeatBridgeScore: null,
    actor_routeDominance: null,
    actor_clusterSize: null,
    actor_riskTier: null
  };
}

/**
 * Get feature count for actor
 */
export function getActorFeatureCount(): number {
  return 6;
}
