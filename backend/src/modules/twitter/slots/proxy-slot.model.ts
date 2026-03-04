// ProxySlot Model - MULTI Architecture
import mongoose, { Schema, Document } from 'mongoose';

export type ProxySlotStatus = 'ACTIVE' | 'COOLDOWN' | 'DISABLED' | 'ERROR';
export type ProxyProtocol = 'http' | 'https' | 'socks5';

export interface IProxySlot extends Document {
  name: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  username?: string;
  password?: string;
  status: ProxySlotStatus;
  cooldownUntil?: Date;
  usedInWindow: number;
  windowStart?: Date;
  totalRequests: number;
  totalErrors: number;
  lastUsedAt?: Date;
  lastError?: {
    code: string;
    message: string;
    at: Date;
  };
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProxySlotSchema = new Schema<IProxySlot>(
  {
    name: { type: String, required: true },
    host: { type: String, required: true },
    port: { type: Number, required: true },
    protocol: { type: String, enum: ['http', 'https', 'socks5'], default: 'http' },
    username: { type: String },
    password: { type: String },
    status: { type: String, enum: ['ACTIVE', 'COOLDOWN', 'DISABLED', 'ERROR'], default: 'ACTIVE' },
    cooldownUntil: { type: Date },
    usedInWindow: { type: Number, default: 0 },
    windowStart: { type: Date },
    totalRequests: { type: Number, default: 0 },
    totalErrors: { type: Number, default: 0 },
    lastUsedAt: { type: Date },
    lastError: {
      code: { type: String },
      message: { type: String },
      at: { type: Date },
    },
    notes: { type: String },
  },
  { timestamps: true, collection: 'proxy_slots' }
);

ProxySlotSchema.index({ status: 1 });
ProxySlotSchema.index({ cooldownUntil: 1 });

export const ProxySlotModel = mongoose.model<IProxySlot>('ProxySlot', ProxySlotSchema);

export type ProxySlot = IProxySlot;
