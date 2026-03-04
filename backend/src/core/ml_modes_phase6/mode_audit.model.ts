/**
 * Phase 6: ML Mode Audit Model
 * Logs all mode changes
 */
import mongoose from 'mongoose';

const ModeAuditSchema = new mongoose.Schema({
  // Audit entry ID
  auditId: { type: String, required: true, unique: true },
  
  // What changed
  action: { 
    type: String, 
    enum: ['MODE_CHANGE', 'KILL_SWITCH_TRIGGER', 'KILL_SWITCH_RESET', 'AUTO_DISABLE'],
    required: true 
  },
  
  // Mode transition
  fromMode: { type: String, enum: ['OFF', 'ADVISOR', 'ASSIST', null] },
  toMode: { type: String, enum: ['OFF', 'ADVISOR', 'ASSIST', null] },
  
  // Who/what triggered
  triggeredBy: { type: String, default: 'system' },
  
  // Reason / context
  reason: String,
  
  // Safety metrics at time of change
  metrics: {
    flipRate: Number,
    ece: Number,
    gatesPassed: Boolean,
    alertsActive: [String],
  },
  
  // Timestamps
  timestamp: { type: Date, default: Date.now },
});

ModeAuditSchema.index({ timestamp: -1 });
ModeAuditSchema.index({ action: 1, timestamp: -1 });

export const ModeAuditModel = mongoose.model('ml_mode_audit', ModeAuditSchema);
