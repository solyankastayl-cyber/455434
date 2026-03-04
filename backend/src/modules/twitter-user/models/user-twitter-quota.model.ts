/**
 * UserTwitterQuota - лимиты и бюджет пользователя
 * 
 * Capacity = accounts × basePostsPerHour × boostMultiplier
 * 
 * Счётчики сбрасываются:
 * - hourly: usedThisHour
 * - daily: usedToday
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IUserTwitterQuota extends Document {
  /** ID владельца */
  ownerUserId: string;
  
  /** Количество активных аккаунтов */
  accountsLinked: number;
  
  /** Базовая скорость (posts/hour на аккаунт) */
  basePostsPerHour: number;
  
  /** Множитель (для premium) */
  boostMultiplier: number;
  
  /** Жёсткий лимит на час */
  hardCapPerHour: number;
  
  /** Жёсткий лимит на день */
  hardCapPerDay: number;
  
  /** Использовано за текущий час */
  usedThisHour: number;
  
  /** Использовано за сегодня */
  usedToday: number;
  
  /** Запланировано (но ещё не выполнено) */
  plannedThisHour: number;
  
  /** Когда начался текущий hour window */
  hourWindowStartedAt: Date;
  
  /** Когда начался текущий day window */
  dayWindowStartedAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const UserTwitterQuotaSchema = new Schema<IUserTwitterQuota>(
  {
    ownerUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    accountsLinked: {
      type: Number,
      default: 0,
      min: 0,
    },
    basePostsPerHour: {
      type: Number,
      default: 200, // conservative default
    },
    boostMultiplier: {
      type: Number,
      default: 1.0,
      min: 0.5,
      max: 3.0,
    },
    hardCapPerHour: {
      type: Number,
      default: 0,
    },
    hardCapPerDay: {
      type: Number,
      default: 0,
    },
    usedThisHour: {
      type: Number,
      default: 0,
    },
    usedToday: {
      type: Number,
      default: 0,
    },
    plannedThisHour: {
      type: Number,
      default: 0,
    },
    hourWindowStartedAt: {
      type: Date,
      default: Date.now,
    },
    dayWindowStartedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'user_twitter_quotas',
  }
);

export const UserTwitterQuotaModel = mongoose.model<IUserTwitterQuota>(
  'UserTwitterQuota',
  UserTwitterQuotaSchema
);
