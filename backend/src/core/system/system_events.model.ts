/**
 * System Events Model (Option B - B5)
 * 
 * Records system state transitions and anomalies.
 * No silent failures — everything is logged.
 */
import mongoose, { Schema, Document } from 'mongoose';

// Event types (transitions only, not continuous)
export type SystemEventType =
  | 'health_degraded'      // healthy → degraded
  | 'health_unhealthy'     // any → unhealthy
  | 'health_recovered'     // unhealthy/degraded → healthy
  | 'bootstrap_failed_spike' // failed > threshold in 10min
  | 'rpc_down'             // RPC connectivity lost
  | 'worker_stale';        // Worker heartbeat missing > 60s

export type EventSeverity = 'info' | 'warn' | 'critical';

export interface ISystemEvent extends Document {
  type: SystemEventType;
  severity: EventSeverity;
  message: string;
  meta?: Record<string, any>;
  ts: Date;
  dedupKey: string;
}

const SystemEventSchema = new Schema<ISystemEvent>(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'health_degraded',
        'health_unhealthy',
        'health_recovered',
        'bootstrap_failed_spike',
        'rpc_down',
        'worker_stale',
      ],
    },
    severity: {
      type: String,
      required: true,
      enum: ['info', 'warn', 'critical'],
    },
    message: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
    ts: { type: Date, required: true, default: Date.now },
    dedupKey: { type: String, required: true },
  },
  { collection: 'system_events' }
);

// Indexes
SystemEventSchema.index({ dedupKey: 1 });
SystemEventSchema.index({ ts: -1 });
SystemEventSchema.index({ type: 1, ts: -1 });

export const SystemEventModel = mongoose.model<ISystemEvent>(
  'SystemEvent',
  SystemEventSchema
);

/**
 * Generate dedup key (max 1 event per type per 10 minutes)
 */
function getDedupKey(type: SystemEventType): string {
  const now = new Date();
  const roundedMinutes = Math.floor(now.getMinutes() / 10) * 10;
  const roundedTime = new Date(now);
  roundedTime.setMinutes(roundedMinutes, 0, 0);
  return `${type}:${roundedTime.toISOString()}`;
}

/**
 * Record a system event (with dedup)
 */
export async function recordSystemEvent(
  type: SystemEventType,
  severity: EventSeverity,
  message: string,
  meta?: Record<string, any>
): Promise<boolean> {
  const dedupKey = getDedupKey(type);
  
  try {
    // Check if event already exists (dedup)
    const existing = await SystemEventModel.findOne({ dedupKey });
    if (existing) {
      return false; // Already recorded
    }
    
    // Create new event
    await SystemEventModel.create({
      type,
      severity,
      message,
      meta,
      ts: new Date(),
      dedupKey,
    });
    
    console.log(`[SystemEvent] ${severity.toUpperCase()}: ${type} - ${message}`);
    return true;
  } catch (err: any) {
    // Duplicate key = already exists (race condition)
    if (err.code === 11000) {
      return false;
    }
    console.error('[SystemEvent] Failed to record:', err);
    return false;
  }
}

/**
 * Get recent system events
 */
export async function getSystemEvents(
  since?: Date,
  limit: number = 50
): Promise<ISystemEvent[]> {
  const query: any = {};
  if (since) {
    query.ts = { $gte: since };
  }
  
  return SystemEventModel
    .find(query)
    .sort({ ts: -1 })
    .limit(limit)
    .lean();
}

/**
 * Cleanup old events (keep last 7 days)
 */
export async function cleanupOldEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await SystemEventModel.deleteMany({ ts: { $lt: cutoff } });
  return result.deletedCount;
}
