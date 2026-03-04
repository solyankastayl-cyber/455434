// TwitterAccount Model - MULTI Architecture + Scope Support
import mongoose, { Schema, Document, Types } from 'mongoose';
import { OwnerType } from '../core/execution-scope.js';

export type AccountStatus = 'ACTIVE' | 'DISABLED' | 'SUSPENDED';

export interface ITwitterAccount extends Document {
  username: string;
  displayName?: string;
  twitterId?: string;
  status: AccountStatus;
  rateLimit: number;
  notes?: string;
  
  // Scope: USER vs SYSTEM
  ownerType: OwnerType;
  ownerUserId?: Types.ObjectId | null;
  
  // System account metadata
  label?: string;           // "System Elon Account #1"
  tags?: string[];          // ["sentiment", "elon", "core"]
  
  // Scheduler tracking
  lastRunAt?: Date;         // Last time this account was used for parsing
  
  createdAt: Date;
  updatedAt: Date;
}

const TwitterAccountSchema = new Schema<ITwitterAccount>(
  {
    username: { type: String, required: true, unique: true, lowercase: true },
    displayName: { type: String },
    twitterId: { type: String },
    status: { type: String, enum: ['ACTIVE', 'DISABLED', 'SUSPENDED'], default: 'ACTIVE' },
    rateLimit: { type: Number, default: 200 },
    notes: { type: String },
    
    // Scope fields
    ownerType: { 
      type: String, 
      enum: Object.values(OwnerType), 
      default: OwnerType.USER,
      index: true,
    },
    ownerUserId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      index: true,
    },
    
    // System account metadata
    label: { type: String },
    tags: [{ type: String }],
    
    // Scheduler tracking
    lastRunAt: { type: Date, index: true },
  },
  { timestamps: true, collection: 'twitter_accounts' }
);

TwitterAccountSchema.index({ status: 1 });
TwitterAccountSchema.index({ ownerType: 1, status: 1 });

export const TwitterAccountModel = mongoose.model<ITwitterAccount>('TwitterAccount', TwitterAccountSchema);

export type TwitterAccount = ITwitterAccount;

