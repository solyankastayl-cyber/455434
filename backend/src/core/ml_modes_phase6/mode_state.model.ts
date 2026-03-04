/**
 * Phase 6: ML Mode State Model
 * Tracks current ML mode and kill switch status
 */
import mongoose from 'mongoose';

const ModeStateSchema = new mongoose.Schema({
  // Singleton identifier
  key: { type: String, default: 'ml_mode_state', unique: true },
  
  // Current mode: OFF | ADVISOR | ASSIST
  mode: { 
    type: String, 
    enum: ['OFF', 'ADVISOR', 'ASSIST'],
    default: 'OFF'
  },
  
  // Kill switch status
  killSwitch: {
    status: { 
      type: String, 
      enum: ['ARMED', 'TRIGGERED'],
      default: 'ARMED'
    },
    triggeredAt: Date,
    triggeredBy: String,
    reason: String,
  },
  
  // Mode change metadata
  modeChangedAt: { type: Date, default: Date.now },
  modeChangedBy: { type: String, default: 'system' },
  
  // Safety metrics at last check
  lastHealthCheck: {
    flipRate: Number,
    ece: Number,
    checkedAt: Date,
    gatesPassed: Boolean,
  },
  
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

export const ModeStateModel = mongoose.model('ml_mode_state', ModeStateSchema);
