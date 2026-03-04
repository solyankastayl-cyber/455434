/**
 * Price Outcome Model
 * 
 * Stores price outcomes for ML labels (UP/DOWN/FLAT)
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPriceOutcome extends Document {
  subject: { kind: string; id: string };
  decisionLogId: Types.ObjectId;

  t0: Date;
  price0: number;

  horizons: Array<{
    h: string;
    t1?: Date;
    price1?: number;
    retPct?: number;
    label?: string;
    maxRunupPct?: number;
    maxDrawdownPct?: number;
  }>;

  meta: {
    priceSource: string;
    ok: boolean;
    error?: string;
  };
}

const PriceOutcomeSchema = new Schema<IPriceOutcome>({
  subject: {
    kind: { type: String, required: true },
    id: { type: String, required: true },
  },

  decisionLogId: { type: Schema.Types.ObjectId, required: true, ref: 'EngineDecisionLog' },

  t0: { type: Date, required: true },
  price0: { type: Number, required: true },

  horizons: [{
    h: { type: String, enum: ['1h', '6h', '24h', '72h', '7d'], required: true },
    t1: { type: Date },
    price1: { type: Number },
    retPct: { type: Number },
    label: { type: String, enum: ['UP', 'DOWN', 'FLAT'] },
    maxRunupPct: { type: Number },
    maxDrawdownPct: { type: Number },
  }],

  meta: {
    priceSource: { type: String },
    ok: { type: Boolean, default: true },
    error: { type: String },
  },
}, { timestamps: true });

// Indexes
PriceOutcomeSchema.index({ 'subject.id': 1, t0: -1 });
PriceOutcomeSchema.index({ decisionLogId: 1 });
PriceOutcomeSchema.index({ 'horizons.h': 1, 'horizons.label': 1 });

// Check if model already exists to prevent OverwriteModelError
export const PriceOutcomeModel = mongoose.models.PriceOutcome || mongoose.model<IPriceOutcome>(
  'PriceOutcome',
  PriceOutcomeSchema,
  'price_outcomes'
);
