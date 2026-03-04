/**
 * System Heartbeats Model (Option B - B2)
 * 
 * Tracks worker/service liveness.
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemHeartbeat extends Document {
  key: string;        // 'bootstrap_worker' | 'erc20_indexer' | 'prices_job'
  ts: Date;
  meta?: {
    pid?: number;
    host?: string;
    version?: string;
  };
}

const SystemHeartbeatSchema = new Schema<ISystemHeartbeat>(
  {
    key: { type: String, required: true, unique: true },
    ts: { type: Date, required: true, default: Date.now },
    meta: {
      pid: Number,
      host: String,
      version: String,
    },
  },
  { collection: 'system_heartbeats' }
);

SystemHeartbeatSchema.index({ key: 1 }, { unique: true });
SystemHeartbeatSchema.index({ ts: -1 });

export const SystemHeartbeatModel = mongoose.model<ISystemHeartbeat>(
  'SystemHeartbeat',
  SystemHeartbeatSchema
);

/**
 * Update heartbeat for a service
 */
export async function updateHeartbeat(
  key: string,
  meta?: { pid?: number; host?: string; version?: string }
): Promise<void> {
  await SystemHeartbeatModel.updateOne(
    { key },
    { $set: { ts: new Date(), meta } },
    { upsert: true }
  );
}

/**
 * Get last heartbeat for a service
 */
export async function getHeartbeat(key: string): Promise<ISystemHeartbeat | null> {
  return SystemHeartbeatModel.findOne({ key });
}

/**
 * Check if heartbeat is stale
 */
export async function isHeartbeatStale(key: string, staleSec: number = 60): Promise<boolean> {
  const heartbeat = await getHeartbeat(key);
  if (!heartbeat) return true;
  
  const age = Date.now() - heartbeat.ts.getTime();
  return age > staleSec * 1000;
}
