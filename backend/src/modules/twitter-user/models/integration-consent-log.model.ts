/**
 * Integration Consent Log Model
 * 
 * Records user consent acceptance with version tracking.
 * Critical for legal compliance - stores which policy version user agreed to.
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IIntegrationConsentLog extends Document {
  userId: string;
  policySlug: string;
  policyVersion: string;
  acceptedAt: Date;
  ip?: string;
  userAgent?: string;
  revokedAt?: Date;
  revokeReason?: string;
}

const IntegrationConsentLogSchema = new Schema<IIntegrationConsentLog>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    policySlug: {
      type: String,
      required: true,
    },
    policyVersion: {
      type: String,
      required: true,
    },
    acceptedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    ip: String,
    userAgent: String,
    revokedAt: Date,
    revokeReason: String,
  },
  { 
    timestamps: true,
    collection: 'integration_consent_logs',
  }
);

// Compound index for finding user's consent for a policy
IntegrationConsentLogSchema.index({ userId: 1, policySlug: 1, policyVersion: 1 });
// Index for finding latest consent
IntegrationConsentLogSchema.index({ userId: 1, policySlug: 1, acceptedAt: -1 });

export const IntegrationConsentLogModel = mongoose.model<IIntegrationConsentLog>(
  'IntegrationConsentLog',
  IntegrationConsentLogSchema,
  'integration_consent_logs'
);
