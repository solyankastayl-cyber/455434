/**
 * FED FUNDS MODEL — MongoDB Storage
 * 
 * Stores historical Federal Funds Rate data from FRED
 * Collection: fed_funds
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// FED FUNDS SCHEMA
// ═══════════════════════════════════════════════════════════════

export interface IFedFunds extends Document {
  date: Date;
  value: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const FedFundsSchema = new Schema<IFedFunds>({
  date: { type: Date, required: true, unique: true, index: true },
  value: { type: Number, required: true },
  source: { type: String, default: 'FRED' },
}, {
  timestamps: true,
  collection: 'fed_funds'
});

// Indexes
FedFundsSchema.index({ date: -1 });

export const FedFundsModel = mongoose.model<IFedFunds>('FedFunds', FedFundsSchema);

// ═══════════════════════════════════════════════════════════════
// META SCHEMA — Track data integrity
// ═══════════════════════════════════════════════════════════════

export interface IFedFundsMeta extends Document {
  source: string;
  startDate: Date;
  endDate: Date;
  count: number;
  lastIngestAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FedFundsMetaSchema = new Schema<IFedFundsMeta>({
  source: { type: String, required: true },
  startDate: { type: Date },
  endDate: { type: Date },
  count: { type: Number, default: 0 },
  lastIngestAt: { type: Date },
}, {
  timestamps: true,
  collection: 'fed_funds_meta'
});

export const FedFundsMetaModel = mongoose.model<IFedFundsMeta>('FedFundsMeta', FedFundsMetaSchema);
