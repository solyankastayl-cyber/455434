/**
 * Anomaly Spike Rule
 * 
 * Checks for sudden volume spikes without corresponding actor growth.
 * Spike > 10x without actor growth → QUARANTINED
 * 
 * Pure function, no side effects.
 */
import type { RuleContext, RulePenalty } from '../approval.types.js';
import { RULE_NAMES } from '../approval.types.js';

const SPIKE_THRESHOLD = 10; // 10x increase
const ACTOR_GROWTH_MIN = 1.5; // Actors should grow by at least 50%

export function evaluateAnomalySpikeRule(context: RuleContext): RulePenalty | null {
  const { currentWindow, previousWindow } = context;
  
  // No previous window = can't detect spike
  if (!previousWindow) {
    return null;
  }
  
  // Skip if previous had no events
  if (previousWindow.eventCount === 0) {
    return null;
  }
  
  // Check event count spike
  const eventRatio = currentWindow.eventCount / previousWindow.eventCount;
  
  if (eventRatio >= SPIKE_THRESHOLD) {
    // Check if actors also grew proportionally
    const currentActors = currentWindow.uniqueSenders + currentWindow.uniqueReceivers;
    const previousActors = previousWindow.uniqueSenders + previousWindow.uniqueReceivers;
    
    if (previousActors > 0) {
      const actorRatio = currentActors / previousActors;
      
      if (actorRatio < ACTOR_GROWTH_MIN) {
        return {
          rule: RULE_NAMES.ANOMALY_SPIKE,
          penalty: 35,
          reason: `Event spike ${eventRatio.toFixed(1)}x but actors grew only ${actorRatio.toFixed(1)}x (possible manipulation)`,
        };
      }
    }
  }
  
  // Check volume spike
  try {
    const currentVolume = BigInt(currentWindow.inflowAmount || '0');
    const previousVolume = BigInt(previousWindow.inflowAmount || '0');
    
    if (previousVolume > 0) {
      const volumeRatio = Number(currentVolume * BigInt(100) / previousVolume) / 100;
      
      if (volumeRatio >= SPIKE_THRESHOLD) {
        const currentActors = currentWindow.uniqueSenders + currentWindow.uniqueReceivers;
        const previousActors = previousWindow.uniqueSenders + previousWindow.uniqueReceivers;
        
        if (previousActors > 0) {
          const actorRatio = currentActors / previousActors;
          
          if (actorRatio < ACTOR_GROWTH_MIN) {
            return {
              rule: RULE_NAMES.ANOMALY_SPIKE,
              penalty: 30,
              reason: `Volume spike ${volumeRatio.toFixed(1)}x but actors grew only ${actorRatio.toFixed(1)}x`,
            };
          }
        }
      }
    }
  } catch {
    // Ignore BigInt errors
  }
  
  return null;
}
