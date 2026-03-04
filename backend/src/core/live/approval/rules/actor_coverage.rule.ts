/**
 * Actor Coverage Rule
 * 
 * Checks if there are enough unique actors for the number of events.
 * Many events with very few actors → REJECTED (likely bot/spam)
 * 
 * Pure function, no side effects.
 */
import type { RuleContext, RulePenalty } from '../approval.types.js';
import { RULE_NAMES } from '../approval.types.js';

const HIGH_EVENT_THRESHOLD = 50;
const MIN_ACTORS_FOR_HIGH_EVENTS = 2;
const MAX_EVENTS_PER_ACTOR = 100; // Suspicious if single actor does > 100 transfers

export function evaluateActorCoverageRule(context: RuleContext): RulePenalty | null {
  const { currentWindow } = context;
  
  // Skip empty windows
  if (currentWindow.eventCount === 0) {
    return null;
  }
  
  const totalActors = currentWindow.uniqueSenders + currentWindow.uniqueReceivers;
  
  // High events with very few actors
  if (currentWindow.eventCount > HIGH_EVENT_THRESHOLD && totalActors < MIN_ACTORS_FOR_HIGH_EVENTS) {
    return {
      rule: RULE_NAMES.ACTOR_COVERAGE,
      penalty: 55,
      reason: `${currentWindow.eventCount} events with only ${totalActors} unique actors (likely bot activity)`,
    };
  }
  
  // Check events per actor ratio
  if (totalActors > 0) {
    const eventsPerActor = currentWindow.eventCount / totalActors;
    
    if (eventsPerActor > MAX_EVENTS_PER_ACTOR) {
      return {
        rule: RULE_NAMES.ACTOR_COVERAGE,
        penalty: 25,
        reason: `High events-per-actor ratio: ${eventsPerActor.toFixed(1)} (possible wash trading)`,
      };
    }
  }
  
  // Zero actors with events (data corruption)
  if (currentWindow.eventCount > 0 && totalActors === 0) {
    return {
      rule: RULE_NAMES.ACTOR_COVERAGE,
      penalty: 60,
      reason: 'Events present but no actors recorded (data corruption)',
    };
  }
  
  return null;
}
