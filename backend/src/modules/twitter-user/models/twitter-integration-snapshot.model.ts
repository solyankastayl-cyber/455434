/**
 * UserTwitterIntegrationSnapshot - хранение последнего состояния
 * 
 * Используется ТОЛЬКО для:
 * - Сравнения при Telegram уведомлениях
 * - Аналитики
 * - UI badge (optional)
 * 
 * State НЕ хранится - он ВСЕГДА вычисляется через Resolver
 * Snapshot - это только "последнее известное состояние"
 */

import mongoose, { Schema, Document } from 'mongoose';
import { TwitterIntegrationState } from '../types/twitter-integration-state.js';

export interface ITwitterIntegrationSnapshot extends Document {
  /** ID пользователя (owner) */
  ownerUserId: string;
  
  /** Последнее известное состояние */
  lastState: TwitterIntegrationState;
  
  /** Когда состояние изменилось */
  stateChangedAt: Date;
  
  /** Telegram chat ID для уведомлений */
  telegramChatId?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const TwitterIntegrationSnapshotSchema = new Schema<ITwitterIntegrationSnapshot>(
  {
    ownerUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    lastState: {
      type: String,
      enum: Object.values(TwitterIntegrationState),
      required: true,
    },
    stateChangedAt: {
      type: Date,
      default: Date.now,
    },
    telegramChatId: {
      type: String,
      sparse: true,
    },
  },
  {
    timestamps: true,
    collection: 'user_twitter_integration_snapshots',
  }
);

export const TwitterIntegrationSnapshotModel = mongoose.model<ITwitterIntegrationSnapshot>(
  'UserTwitterIntegrationSnapshot',
  TwitterIntegrationSnapshotSchema
);
