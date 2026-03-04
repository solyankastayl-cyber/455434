/**
 * Grouping Engine (A3)
 * 
 * Purpose: "Это новое событие или продолжение уже идущего поведения?"
 * 
 * A3 converts:
 *   stream of ScoredEvents
 * into:
 *   live behavior groups with lifecycle
 * 
 * CRITICAL: A3 groups by MEANING of behavior:
 * "Smart money continues accumulating USDT"
 * NOT "Alert #1", "Alert #2", "Alert #3"
 * 
 * Grouping Key = scope + targetId + signalType
 * ❗ Severity does NOT participate
 * ❗ Time does NOT participate directly
 * 
 * Lifecycle: active → cooling → resolved
 * 
 * NOT responsible for:
 * - Sending notifications (A4)
 * - Channel decisions (A4)
 * - Deduplication (A1)
 * - Severity calculation (A2)
 */
import { v4 as uuidv4 } from 'uuid';
import type { ScoredEvent } from '../severity/scored_event.schema.js';
import type { 
  AlertGroup, 
  GroupedEvent, 
  GroupStatus, 
  GroupPriority,
  GroupReason,
  GroupScope,
  SignalType,
} from './alert_group.schema.js';
import { AlertGroupModel } from './alert_group.model.js';

/**
 * Severity thresholds for lifecycle transitions
 */
const SEVERITY_THRESHOLDS = {
  // Below this → cooling
  coolingThreshold: 1.5,
  // Below this + no events → resolved
  resolvedThreshold: 0.8,
};

/**
 * Time windows for lifecycle (in hours)
 */
const LIFECYCLE_WINDOWS = {
  // Hours without events before cooling
  coolingHours: 3,
  // Hours without events before resolved
  resolvedHours: 6,
};

/**
 * Severity decay factors by time since last event
 */
const DECAY_FACTORS: Record<number, number> = {
  1: 0.9,   // 1h → 90%
  3: 0.7,   // 3h → 70%
  6: 0.4,   // 6h → 40%
  12: 0.2,  // 12h → 20%
};

export class GroupingEngine {
  /**
   * Main grouping process
   * 
   * Flow:
   * 1. Generate groupKey
   * 2. Find active group
   * 3. If no active group → Create new
   * 4. If active group exists → Update or transition
   */
  async process(scoredEvent: ScoredEvent): Promise<GroupedEvent> {
    const event = scoredEvent.normalizedEvent;
    const groupKey = this.generateGroupKey(event);
    
    // Find active/cooling group for this behavior
    const existingGroup = await this.findActiveGroup(
      event.scope,
      event.targetId,
      event.signalType,
      event.userId
    );
    
    if (!existingGroup) {
      // Create new group
      return this.createNewGroup(scoredEvent, groupKey);
    }
    
    // Update existing group
    return this.updateGroup(existingGroup, scoredEvent);
  }

  /**
   * Generate groupKey (CRITICAL)
   * 
   * groupKey = scope + targetId + signalType
   * 
   * ❗ Severity does NOT participate
   * ❗ Time does NOT participate directly
   */
  private generateGroupKey(event: any): string {
    return `${event.scope}:${event.targetId}:${event.signalType}`;
  }

  /**
   * Find active or cooling group for this behavior
   */
  private async findActiveGroup(
    scope: string,
    targetId: string,
    signalType: string,
    userId: string
  ): Promise<AlertGroup | null> {
    const group = await AlertGroupModel.findOne({
      scope,
      targetId,
      signalType,
      userId,
      status: { $in: ['active', 'cooling'] },
    }).lean();
    
    return group as AlertGroup | null;
  }

  /**
   * Create new group (1️⃣ Create Group)
   */
  private async createNewGroup(
    scoredEvent: ScoredEvent,
    groupKey: string
  ): Promise<GroupedEvent> {
    const event = scoredEvent.normalizedEvent;
    const now = new Date();
    
    const priority = this.mapToPriority(scoredEvent.priority);
    
    const reason = this.generateInitialReason(
      event.signalType,
      event.targetMeta?.symbol
    );
    
    const newGroup: AlertGroup = {
      groupId: uuidv4(),
      
      scope: event.scope as GroupScope,
      targetId: event.targetId,
      signalType: event.signalType as SignalType,
      
      targetMeta: event.targetMeta,
      
      status: 'active',
      priority,
      
      startedAt: now,
      lastUpdatedAt: now,
      
      eventIds: [event.eventId],
      eventCount: 1,
      
      peakSeverity: scoredEvent.severityScore,
      lastSeverity: scoredEvent.severityScore,
      
      reason,
      
      userId: event.userId,
      ruleId: event.ruleId,
    };
    
    await AlertGroupModel.create(newGroup);
    
    return {
      group: newGroup,
      isNewGroup: true,
      isEscalation: false,
      isResolution: false,
      isCoolingStart: false,
    };
  }

  /**
   * Update existing group (2️⃣ Update / 3️⃣ Cooling / 4️⃣ Resolve)
   */
  private async updateGroup(
    existingGroup: AlertGroup,
    scoredEvent: ScoredEvent
  ): Promise<GroupedEvent> {
    const event = scoredEvent.normalizedEvent;
    const now = new Date();
    
    // Calculate effective severity with decay
    const effectiveSeverity = this.calculateEffectiveSeverity(
      scoredEvent.severityScore,
      existingGroup.lastUpdatedAt
    );
    
    // Determine new status
    const previousStatus = existingGroup.status;
    const newStatus = this.determineNewStatus(
      existingGroup,
      effectiveSeverity,
      scoredEvent.severityScore
    );
    
    // Determine priority (can escalate)
    const previousPriority = existingGroup.priority;
    const newPriority = this.determineNewPriority(
      existingGroup.priority,
      scoredEvent.priority
    );
    
    const isEscalation = this.isPriorityHigher(newPriority, previousPriority);
    const isResolution = newStatus === 'resolved' && previousStatus !== 'resolved';
    const isCoolingStart = newStatus === 'cooling' && previousStatus === 'active';
    
    // Update reason based on lifecycle
    const reason = this.generateUpdatedReason(
      existingGroup,
      newStatus,
      scoredEvent.severityScore
    );
    
    // Update group
    const updatedGroup = await AlertGroupModel.findOneAndUpdate(
      { groupId: existingGroup.groupId },
      {
        $set: {
          status: newStatus,
          priority: newPriority,
          lastUpdatedAt: now,
          peakSeverity: Math.max(existingGroup.peakSeverity, scoredEvent.severityScore),
          lastSeverity: scoredEvent.severityScore,
          reason,
          ...(isCoolingStart && { coolingStartedAt: now }),
          ...(isResolution && { resolvedAt: now }),
        },
        $push: { eventIds: event.eventId },
        $inc: { eventCount: 1 },
      },
      { new: true, lean: true }
    );
    
    return {
      group: updatedGroup as AlertGroup,
      isNewGroup: false,
      isEscalation,
      isResolution,
      isCoolingStart,
      previousStatus,
      previousPriority,
    };
  }

  /**
   * Calculate effective severity with decay (📉 SEVERITY DECAY)
   * 
   * effectiveSeverity = lastSeverity * decayFactor(timeSinceLastEvent)
   * 
   * Without decay, groups would be eternal
   */
  private calculateEffectiveSeverity(
    currentSeverity: number,
    lastUpdatedAt: Date
  ): number {
    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - lastUpdatedAt.getTime()) / (1000 * 60 * 60);
    
    // Find appropriate decay factor
    let decayFactor = 1.0;
    
    if (hoursSinceUpdate >= 12) {
      decayFactor = DECAY_FACTORS[12];
    } else if (hoursSinceUpdate >= 6) {
      decayFactor = DECAY_FACTORS[6];
    } else if (hoursSinceUpdate >= 3) {
      decayFactor = DECAY_FACTORS[3];
    } else if (hoursSinceUpdate >= 1) {
      decayFactor = DECAY_FACTORS[1];
    }
    
    return currentSeverity * decayFactor;
  }

  /**
   * Determine new status based on severity and timing
   */
  private determineNewStatus(
    group: AlertGroup,
    effectiveSeverity: number,
    rawSeverity: number
  ): GroupStatus {
    const hoursSinceUpdate = this.hoursSince(group.lastUpdatedAt);
    
    // If severity is high and recent, stay active
    if (rawSeverity >= SEVERITY_THRESHOLDS.coolingThreshold) {
      return 'active';
    }
    
    // If severity dropped significantly
    if (effectiveSeverity < SEVERITY_THRESHOLDS.coolingThreshold) {
      // Check if should resolve
      if (
        group.status === 'cooling' &&
        hoursSinceUpdate >= LIFECYCLE_WINDOWS.resolvedHours &&
        effectiveSeverity < SEVERITY_THRESHOLDS.resolvedThreshold
      ) {
        return 'resolved';
      }
      
      // Start cooling
      if (hoursSinceUpdate >= LIFECYCLE_WINDOWS.coolingHours) {
        return 'cooling';
      }
    }
    
    // Maintain current status
    return group.status;
  }

  /**
   * Determine new priority (can escalate, not downgrade)
   */
  private determineNewPriority(
    currentPriority: GroupPriority,
    eventPriority: string
  ): GroupPriority {
    const priorityOrder: GroupPriority[] = ['low', 'medium', 'high'];
    
    const currentIndex = priorityOrder.indexOf(currentPriority);
    const eventIndex = priorityOrder.indexOf(eventPriority as GroupPriority);
    
    // Escalate if event priority is higher
    if (eventIndex > currentIndex) {
      return priorityOrder[eventIndex];
    }
    
    return currentPriority;
  }

  /**
   * Check if new priority is higher than previous
   */
  private isPriorityHigher(
    newPriority: GroupPriority,
    previousPriority: GroupPriority
  ): boolean {
    const priorityOrder: GroupPriority[] = ['low', 'medium', 'high'];
    return priorityOrder.indexOf(newPriority) > priorityOrder.indexOf(previousPriority);
  }

  /**
   * Map scored event priority to group priority
   */
  private mapToPriority(priority: string): GroupPriority {
    if (priority === 'high') return 'high';
    if (priority === 'medium') return 'medium';
    return 'low';
  }

  /**
   * Generate initial reason for new group
   */
  private generateInitialReason(
    signalType: string,
    symbol?: string
  ): GroupReason {
    const asset = symbol || 'this asset';
    
    const summaryMap: Record<string, string> = {
      accumulation: `Large wallets started accumulating ${asset}`,
      distribution: `Holders started distributing ${asset}`,
      large_move: `Significant movement of ${asset} detected`,
      smart_money_entry: `Historically profitable wallets entering ${asset}`,
      smart_money_exit: `Historically profitable wallets exiting ${asset}`,
      net_flow_spike: `Unusual flow activity started for ${asset}`,
      activity_spike: `Transaction activity spiking for ${asset}`,
    };
    
    return {
      summary: summaryMap[signalType] || `Notable behavior detected for ${asset}`,
      context: 'Just started',
    };
  }

  /**
   * Generate updated reason based on lifecycle (🧠 GROUP REASON UPDATE)
   * 
   * Start:    "Large wallets started accumulating"
   * Ongoing:  "Large wallets continue accumulating (4 events, 6h)"
   * Cooling:  "Accumulation activity slowing down"
   * Resolved: "Accumulation ended after 8 hours"
   */
  private generateUpdatedReason(
    group: AlertGroup,
    newStatus: GroupStatus,
    currentSeverity: number
  ): GroupReason {
    const asset = group.targetMeta?.symbol || 'this asset';
    const eventCount = group.eventCount + 1;
    const durationHours = this.hoursSince(group.startedAt);
    const durationStr = this.formatDuration(durationHours);
    
    // Status-specific reason generation
    switch (newStatus) {
      case 'resolved':
        return {
          summary: this.getResolvedSummary(group.signalType, asset),
          context: `Ended after ${durationStr}`,
        };
        
      case 'cooling':
        return {
          summary: this.getCoolingSummary(group.signalType, asset),
          context: `${eventCount} events over ${durationStr}, activity slowing`,
        };
        
      case 'active':
      default:
        return {
          summary: this.getOngoingSummary(group.signalType, asset),
          context: `${eventCount} events over ${durationStr}`,
        };
    }
  }

  /**
   * Get summary for ongoing (active) status
   */
  private getOngoingSummary(signalType: string, asset: string): string {
    const summaryMap: Record<string, string> = {
      accumulation: `Large wallets continue accumulating ${asset}`,
      distribution: `Holders continue distributing ${asset}`,
      large_move: `Significant movement of ${asset} continues`,
      smart_money_entry: `Smart money continues entering ${asset}`,
      smart_money_exit: `Smart money continues exiting ${asset}`,
      net_flow_spike: `Unusual flow activity continues for ${asset}`,
      activity_spike: `High transaction activity continues for ${asset}`,
    };
    
    return summaryMap[signalType] || `Behavior continues for ${asset}`;
  }

  /**
   * Get summary for cooling status
   */
  private getCoolingSummary(signalType: string, asset: string): string {
    const summaryMap: Record<string, string> = {
      accumulation: `Accumulation activity slowing down for ${asset}`,
      distribution: `Distribution activity slowing down for ${asset}`,
      large_move: `Large movement activity calming for ${asset}`,
      smart_money_entry: `Smart money entry slowing for ${asset}`,
      smart_money_exit: `Smart money exit slowing for ${asset}`,
      net_flow_spike: `Flow spike subsiding for ${asset}`,
      activity_spike: `Transaction spike subsiding for ${asset}`,
    };
    
    return summaryMap[signalType] || `Activity slowing for ${asset}`;
  }

  /**
   * Get summary for resolved status
   */
  private getResolvedSummary(signalType: string, asset: string): string {
    const summaryMap: Record<string, string> = {
      accumulation: `Accumulation ended for ${asset}`,
      distribution: `Distribution ended for ${asset}`,
      large_move: `Large movement completed for ${asset}`,
      smart_money_entry: `Smart money entry completed for ${asset}`,
      smart_money_exit: `Smart money exit completed for ${asset}`,
      net_flow_spike: `Flow spike resolved for ${asset}`,
      activity_spike: `Activity spike resolved for ${asset}`,
    };
    
    return summaryMap[signalType] || `Behavior resolved for ${asset}`;
  }

  /**
   * Calculate hours since a date
   */
  private hoursSince(date: Date): number {
    const now = new Date();
    return (now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60);
  }

  /**
   * Format duration in hours to human-readable string
   */
  private formatDuration(hours: number): string {
    if (hours < 1) {
      const minutes = Math.round(hours * 60);
      return `${minutes}m`;
    }
    if (hours < 24) {
      return `${Math.round(hours)}h`;
    }
    const days = Math.round(hours / 24);
    return `${days}d`;
  }

  /**
   * Run lifecycle check on all active/cooling groups
   * Called periodically by background job
   * 
   * This handles groups that haven't received new events
   * but should transition based on time
   */
  async runLifecycleCheck(): Promise<{
    transitionedToCooling: number;
    transitionedToResolved: number;
  }> {
    const now = new Date();
    let transitionedToCooling = 0;
    let transitionedToResolved = 0;
    
    // Find groups that might need transition
    const activeGroups = await AlertGroupModel.find({
      status: { $in: ['active', 'cooling'] },
    }).lean();
    
    for (const group of activeGroups) {
      const hoursSinceUpdate = this.hoursSince(group.lastUpdatedAt);
      const effectiveSeverity = group.lastSeverity * this.getDecayFactor(hoursSinceUpdate);
      
      if (group.status === 'active') {
        // Check if should transition to cooling
        if (
          hoursSinceUpdate >= LIFECYCLE_WINDOWS.coolingHours &&
          effectiveSeverity < SEVERITY_THRESHOLDS.coolingThreshold
        ) {
          await AlertGroupModel.updateOne(
            { groupId: group.groupId },
            {
              $set: {
                status: 'cooling',
                coolingStartedAt: now,
                reason: {
                  summary: this.getCoolingSummary(
                    group.signalType,
                    group.targetMeta?.symbol || 'this asset'
                  ),
                  context: `${group.eventCount} events, activity slowing`,
                },
              },
            }
          );
          transitionedToCooling++;
        }
      } else if (group.status === 'cooling') {
        // Check if should transition to resolved
        if (
          hoursSinceUpdate >= LIFECYCLE_WINDOWS.resolvedHours &&
          effectiveSeverity < SEVERITY_THRESHOLDS.resolvedThreshold
        ) {
          const durationHours = this.hoursSince(group.startedAt);
          
          await AlertGroupModel.updateOne(
            { groupId: group.groupId },
            {
              $set: {
                status: 'resolved',
                resolvedAt: now,
                reason: {
                  summary: this.getResolvedSummary(
                    group.signalType,
                    group.targetMeta?.symbol || 'this asset'
                  ),
                  context: `Ended after ${this.formatDuration(durationHours)}`,
                },
              },
            }
          );
          transitionedToResolved++;
        }
      }
    }
    
    return { transitionedToCooling, transitionedToResolved };
  }

  /**
   * Get decay factor for given hours
   */
  private getDecayFactor(hours: number): number {
    if (hours >= 12) return DECAY_FACTORS[12];
    if (hours >= 6) return DECAY_FACTORS[6];
    if (hours >= 3) return DECAY_FACTORS[3];
    if (hours >= 1) return DECAY_FACTORS[1];
    return 1.0;
  }

  /**
   * Get active groups for a user
   */
  async getActiveGroupsForUser(userId: string): Promise<AlertGroup[]> {
    return AlertGroupModel.find({
      userId,
      status: { $in: ['active', 'cooling'] },
    })
      .sort({ lastUpdatedAt: -1 })
      .lean() as Promise<AlertGroup[]>;
  }

  /**
   * Get group by ID
   */
  async getGroupById(groupId: string): Promise<AlertGroup | null> {
    return AlertGroupModel.findOne({ groupId }).lean() as Promise<AlertGroup | null>;
  }

  /**
   * Clean up old resolved groups (maintenance)
   */
  async cleanupOldGroups(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await AlertGroupModel.deleteMany({
      status: 'resolved',
      resolvedAt: { $lt: cutoffDate },
    });
    
    return result.deletedCount || 0;
  }
}

// Export singleton instance
export const groupingEngine = new GroupingEngine();
