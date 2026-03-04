/**
 * Actors Model - PLACEHOLDER
 * To be implemented with full schema
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IActor extends Document {
  name: string;
  type: 'fund' | 'whale' | 'trader' | 'market_maker' | 'unknown';
  // TODO: Add full schema
  createdAt: Date;
  updatedAt: Date;
}

const ActorSchema = new Schema<IActor>(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['fund', 'whale', 'trader', 'market_maker', 'unknown'], default: 'unknown' },
  },
  { timestamps: true }
);

export const ActorModel = mongoose.model<IActor>('Actor', ActorSchema);
