// System Parse Log Model - Audit trail for SYSTEM parsing attempts
import mongoose, { Schema, Document } from 'mongoose';

export enum SystemParseLogStatus {
  BLOCKED = 'BLOCKED',
  STARTED = 'STARTED',
  DONE = 'DONE',
  ABORTED = 'ABORTED',
  FAILED = 'FAILED',
}

export interface ISystemParseLog extends Document {
  sessionId: string;
  accountId?: string;
  target?: string;
  status: SystemParseLogStatus;
  reason?: string;
  blockers?: Array<{ code: string; message: string }>;
  taskId?: string;
  tweetsFetched?: number;
  duration?: number;
  error?: string;
  createdAt: Date;
}

const SystemParseLogSchema = new Schema<ISystemParseLog>(
  {
    sessionId: { type: String, required: true, index: true },
    accountId: { type: String, index: true },
    target: { type: String },
    status: { 
      type: String, 
      enum: Object.values(SystemParseLogStatus),
      required: true,
      index: true,
    },
    reason: { type: String },
    blockers: [{
      code: { type: String },
      message: { type: String },
    }],
    taskId: { type: String },
    tweetsFetched: { type: Number },
    duration: { type: Number },
    error: { type: String },
  },
  { timestamps: true, collection: 'system_parse_logs' }
);

SystemParseLogSchema.index({ createdAt: -1 });
SystemParseLogSchema.index({ status: 1, createdAt: -1 });

export const SystemParseLogModel = mongoose.model<ISystemParseLog>('SystemParseLog', SystemParseLogSchema);
