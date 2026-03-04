/**
 * Duplication Rule
 * 
 * Checks if current window is suspiciously similar to previous.
 * Identical aggregates → QUARANTINED (possible data issue)
 * 
 * Pure function, no side effects.
 */
import type { RuleContext, RulePenalty } from '../approval.types.js';
import { RULE_NAMES } from '../approval.types.js';

/**
 * Create a simple hash of window metrics for comparison
 */
function hashMetrics(w: { 
  eventCount: number; 
  inflowAmount: string; 
  outflowAmount: string;
  uniqueSenders: number;
  uniqueReceivers: number;
}): string {
  return `${w.eventCount}|${w.inflowAmount}|${w.outflowAmount}|${w.uniqueSenders}|${w.uniqueReceivers}`;
}

export function evaluateDuplicationRule(context: RuleContext): RulePenalty | null {
  const { currentWindow, previousWindow } = context;
  
  // No previous window = can't check duplication
  if (!previousWindow) {
    return null;
  }
  
  // Both empty is OK (no activity period)
  if (currentWindow.eventCount === 0 && previousWindow.eventCount === 0) {
    return null;
  }
  
  // Check if metrics are identical
  const currentHash = hashMetrics(currentWindow);
  const previousHash = hashMetrics(previousWindow);
  
  if (currentHash === previousHash && currentWindow.eventCount > 0) {
    return {
      rule: RULE_NAMES.DUPLICATION,
      penalty: 35,
      reason: 'Identical metrics to previous window (possible data duplication)',
    };
  }
  
  // Check for suspiciously similar volumes (within 0.1%)
  try {
    const currentVolume = BigInt(currentWindow.inflowAmount || '0');
    const previousVolume = BigInt(previousWindow.inflowAmount || '0');
    
    if (currentVolume > 0 && previousVolume > 0) {
      // Calculate difference percentage
      const diff = currentVolume > previousVolume 
        ? currentVolume - previousVolume 
        : previousVolume - currentVolume;
      
      const threshold = currentVolume / BigInt(1000); // 0.1%
      
      if (diff < threshold && currentWindow.eventCount !== previousWindow.eventCount) {
        return {
          rule: RULE_NAMES.DUPLICATION,
          penalty: 20,
          reason: 'Volume nearly identical to previous window but event count differs',
        };
      }
    }
  } catch {
    // Ignore BigInt errors
  }
  
  return null;
}
