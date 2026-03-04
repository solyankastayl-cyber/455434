import mongoose, { Schema, Document } from 'mongoose';

export interface ITwitterConsent extends Document {
  ownerUserId: string;
  accepted: boolean;
  acceptedAt?: Date;
  ip?: string;
  userAgent?: string;
  version?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TwitterConsentSchema = new Schema<ITwitterConsent>(
  {
    ownerUserId: {
      type: String,
      required: true,
      unique: true,
    },
    accepted: {
      type: Boolean,
      required: true,
      default: false,
    },
    acceptedAt: Date,
    ip: String,
    userAgent: String,
    version: String,
  },
  { timestamps: true }
);

// Indexes
TwitterConsentSchema.index({ ownerUserId: 1 }, { unique: true });

export const TwitterConsentModel = mongoose.model<ITwitterConsent>(
  'TwitterConsent',
  TwitterConsentSchema,
  'twitter_consents'
);
