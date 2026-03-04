/**
 * Phase 5: Auto-Calibration
 * ml_calibration_active collection
 * Single source of truth for active calibration maps
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ICalibrationActive extends Document {
  window: '24h' | '7d';
  activeMapId: string | null;
  activatedAt: Date | null;
  activatedBy: 'system' | 'admin' | 'simulation';
  status: 'ACTIVE' | 'DISABLED';
  notes: string;
}

const CalibrationActiveSchema = new Schema<ICalibrationActive>({
  window: {
    type: String,
    required: true,
    enum: ['24h', '7d'],
    unique: true,
    index: true,
  },
  activeMapId: { type: String, default: null },
  activatedAt: { type: Date, default: null },
  activatedBy: {
    type: String,
    required: true,
    enum: ['system', 'admin', 'simulation'],
    default: 'system',
  },
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'DISABLED'],
    default: 'DISABLED',
  },
  notes: { type: String, default: '' },
});

export const CalibrationActiveModel = mongoose.model<ICalibrationActive>(
  'CalibrationActive',
  CalibrationActiveSchema,
  'ml_calibration_active'
);

/**
 * Helper: Initialize defaults for both windows if not exist
 */
export async function ensureCalibrationActiveDefaults(): Promise<void> {
  for (const window of ['24h', '7d'] as const) {
    const existing = await CalibrationActiveModel.findOne({ window });
    if (!existing) {
      await CalibrationActiveModel.create({
        window,
        activeMapId: null,
        status: 'DISABLED',
        activatedBy: 'system',
        notes: 'Initialized by Phase 5',
      });
      console.log(`[Phase5] Initialized calibration_active for ${window}`);
    }
  }
}
