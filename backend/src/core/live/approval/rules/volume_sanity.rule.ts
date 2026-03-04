/**
 * Volume Sanity Rule
 * 
 * Checks for impossible volume values.
 * - Negative volumes → REJECTED
 * - Extremely high volumes → QUARANTINED
 * - Zero events with non-zero volume → REJECTED
 * 
 * Pure function, no side effects.
 */
import type { RuleContext, RulePenalty } from '../approval.types.js';
import { RULE_NAMES } from '../approval.types.js';

export function evaluateVolumeSanityRule(context: RuleContext): RulePenalty | null {
  const { currentWindow } = context;
  
  // Parse volumes
  let volumeIn = BigInt(0);
  let volumeOut = BigInt(0);
  
  try {
    volumeIn = BigInt(currentWindow.inflowAmount || '0');
    volumeOut = BigInt(currentWindow.outflowAmount || '0');
  } catch {
    return {
      rule: RULE_NAMES.VOLUME_SANITY,
      penalty: 60,
      reason: 'Invalid volume format (could not parse as BigInt)',
    };
  }
  
  // Check for negative (should not happen with BigInt, but check string prefix)
  if (currentWindow.inflowAmount.startsWith('-') || currentWindow.outflowAmount.startsWith('-')) {
    return {
      rule: RULE_NAMES.VOLUME_SANITY,
      penalty: 100, // Impossible, always reject
      reason: 'Negative volume detected (impossible value)',
    };
  }
  
  // Check for zero events with non-zero volume
  if (currentWindow.eventCount === 0 && (volumeIn > 0 || volumeOut > 0)) {
    return {
      rule: RULE_NAMES.VOLUME_SANITY,
      penalty: 60,
      reason: 'Non-zero volume with zero events (data inconsistency)',
    };
  }
  
  // Check for extremely high volume per event (possible data corruption)
  if (currentWindow.eventCount > 0) {
    const avgVolumePerEvent = volumeIn / BigInt(currentWindow.eventCount);
    
    // 1 billion ETH equivalent in wei (unrealistic for single transfer)
    const maxReasonableVolume = BigInt('1000000000000000000000000000'); // 1e27
    
    if (avgVolumePerEvent > maxReasonableVolume) {
      return {
        rule: RULE_NAMES.VOLUME_SANITY,
        penalty: 40,
        reason: 'Extremely high average volume per event (possible data corruption)',
      };
    }
  }
  
  return null;
}
