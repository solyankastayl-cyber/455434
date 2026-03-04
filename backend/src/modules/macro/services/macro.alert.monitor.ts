/**
 * Macro Alert Monitor Service
 * 
 * Monitors macro context for regime changes and extreme conditions.
 * Emits alerts via FomoAlertEngine.
 */

import { getMacroSignal, getMacroSnapshot, calculateMacroImpact } from '../services/index.js';
import { fomoAlertEngine } from '../../fomo-alerts/index.js';

// State tracking
let lastFearGreedLabel: string | null = null;
let lastFearGreedValue: number | null = null;
let monitorInterval: NodeJS.Timeout | null = null;

// Monitor interval (check every 5 minutes)
const MONITOR_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Check macro context and emit alerts if needed
 */
export async function checkMacroAlerts(): Promise<void> {
  try {
    const snapshot = await getMacroSnapshot();
    const signal = await getMacroSignal();
    const impact = calculateMacroImpact(signal);
    
    const currentLabel = snapshot.fearGreed.label;
    const currentValue = snapshot.fearGreed.value;
    
    // 1. Check for regime change
    if (lastFearGreedLabel !== null && lastFearGreedLabel !== currentLabel) {
      // Determine direction
      const labelOrder = ['EXTREME_FEAR', 'FEAR', 'NEUTRAL', 'GREED', 'EXTREME_GREED'];
      const prevIndex = labelOrder.indexOf(lastFearGreedLabel);
      const currIndex = labelOrder.indexOf(currentLabel);
      
      let direction: 'WORSENING' | 'IMPROVING' | 'STABLE' = 'STABLE';
      if (currIndex < prevIndex) {
        direction = 'WORSENING'; // Moving towards fear
      } else if (currIndex > prevIndex) {
        direction = 'IMPROVING'; // Moving towards greed
      }
      
      console.log(`[MacroAlertMonitor] Regime change: ${lastFearGreedLabel} → ${currentLabel} (${direction})`);
      
      // Emit regime change alert
      await fomoAlertEngine.emitMacroRegimeChange({
        previousLabel: lastFearGreedLabel,
        newLabel: currentLabel,
        previousValue: lastFearGreedValue!,
        newValue: currentValue,
        direction,
        flags: signal.flags,
        confidenceMultiplier: signal.scores.confidencePenalty,
        timestamp: Date.now(),
      });
    }
    
    // 2. Check for extreme conditions (ADMIN alert)
    const isExtreme = signal.flags.includes('MACRO_PANIC') || signal.flags.includes('MACRO_EUPHORIA');
    if (isExtreme) {
      console.log(`[MacroAlertMonitor] Extreme condition: ${currentLabel} (F&G: ${currentValue})`);
      
      await fomoAlertEngine.emitMacroExtreme({
        fearGreedValue: currentValue,
        fearGreedLabel: currentLabel,
        btcDominance: snapshot.dominance.btcPct,
        stableDominance: snapshot.dominance.stablePct,
        flags: signal.flags,
        impact: {
          confidenceMultiplier: impact.confidenceMultiplier,
          blockedStrong: impact.blockedStrong,
          reason: impact.reason,
        },
        timestamp: Date.now(),
      });
    }
    
    // Update state
    lastFearGreedLabel = currentLabel;
    lastFearGreedValue = currentValue;
    
  } catch (error: any) {
    console.error('[MacroAlertMonitor] Error checking alerts:', error.message);
  }
}

/**
 * Start macro alert monitoring
 */
export function startMacroAlertMonitor(): void {
  if (monitorInterval) {
    console.warn('[MacroAlertMonitor] Already running');
    return;
  }
  
  console.log('[MacroAlertMonitor] Starting monitor...');
  
  // Initial check
  checkMacroAlerts().catch(console.error);
  
  // Set interval
  monitorInterval = setInterval(checkMacroAlerts, MONITOR_INTERVAL_MS);
  
  console.log(`[MacroAlertMonitor] Monitor started (interval: ${MONITOR_INTERVAL_MS / 1000}s)`);
}

/**
 * Stop macro alert monitoring
 */
export function stopMacroAlertMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[MacroAlertMonitor] Monitor stopped');
  }
}

/**
 * Get current monitor state
 */
export function getMacroMonitorState(): {
  isRunning: boolean;
  lastLabel: string | null;
  lastValue: number | null;
} {
  return {
    isRunning: monitorInterval !== null,
    lastLabel: lastFearGreedLabel,
    lastValue: lastFearGreedValue,
  };
}

/**
 * Force trigger a check (for API testing)
 */
export async function triggerMacroAlertCheck(): Promise<{
  checked: boolean;
  currentLabel: string;
  currentValue: number;
  alertsTriggered: string[];
}> {
  const alertsTriggered: string[] = [];
  
  try {
    const snapshot = await getMacroSnapshot();
    const signal = await getMacroSignal();
    
    const currentLabel = snapshot.fearGreed.label;
    const currentValue = snapshot.fearGreed.value;
    
    // Check regime change
    if (lastFearGreedLabel !== null && lastFearGreedLabel !== currentLabel) {
      alertsTriggered.push('MACRO_REGIME_CHANGE');
    }
    
    // Check extreme
    if (signal.flags.includes('MACRO_PANIC') || signal.flags.includes('MACRO_EUPHORIA')) {
      alertsTriggered.push('MACRO_EXTREME');
    }
    
    // Run actual check
    await checkMacroAlerts();
    
    return {
      checked: true,
      currentLabel,
      currentValue,
      alertsTriggered,
    };
  } catch (error: any) {
    return {
      checked: false,
      currentLabel: lastFearGreedLabel || 'UNKNOWN',
      currentValue: lastFearGreedValue || 0,
      alertsTriggered: [],
    };
  }
}
