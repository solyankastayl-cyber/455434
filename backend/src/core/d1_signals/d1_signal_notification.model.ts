/**
 * EPIC D1 — Signal Notifications Model
 * 
 * Tracks sent notifications to prevent duplicates.
 * Each signal can only be sent once per channel.
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ISignalNotification extends Document {
  signalId: string;
  channel: 'telegram' | 'email' | 'push';
  sentAt: Date;
  success: boolean;
  error?: string;
  messageId?: string;
}

const SignalNotificationSchema = new Schema<ISignalNotification>(
  {
    signalId: {
      type: String,
      required: true,
      index: true,
    },
    channel: {
      type: String,
      required: true,
      enum: ['telegram', 'email', 'push'],
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    success: {
      type: Boolean,
      default: false,
    },
    error: String,
    messageId: String,
  },
  {
    timestamps: true,
    collection: 'signal_notifications',
  }
);

// Compound index for idempotency: one notification per signal per channel
SignalNotificationSchema.index({ signalId: 1, channel: 1 }, { unique: true });

export const SignalNotificationModel = mongoose.model<ISignalNotification>(
  'SignalNotification',
  SignalNotificationSchema
);

/**
 * Check if signal was already sent to channel
 */
export async function wasAlreadySent(signalId: string, channel: 'telegram' | 'email' | 'push'): Promise<boolean> {
  const existing = await SignalNotificationModel.findOne({ signalId, channel, success: true });
  return !!existing;
}

/**
 * Mark signal as sent
 */
export async function markAsSent(
  signalId: string, 
  channel: 'telegram' | 'email' | 'push',
  options: { success: boolean; error?: string; messageId?: string }
): Promise<void> {
  await SignalNotificationModel.findOneAndUpdate(
    { signalId, channel },
    {
      sentAt: new Date(),
      success: options.success,
      error: options.error,
      messageId: options.messageId,
    },
    { upsert: true }
  );
}
