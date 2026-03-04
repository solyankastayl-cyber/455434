/**
 * Phase 6: Kill Switch Events Model
 * Detailed log of kill switch triggers
 */
import mongoose from 'mongoose';

const KillSwitchEventSchema = new mongoose.Schema({
  // Event ID
  eventId: { type: String, required: true, unique: true },
  
  // Event type
  eventType: { 
    type: String, 
    enum: ['TRIGGER', 'RESET', 'MANUAL_OFF', 'AUTO_OFF'],
    required: true 
  },
  
  // Trigger reason
  trigger: {
    type: { 
      type: String,
      // Flexible type - no enum restriction
    },
    value: mongoose.Schema.Types.Mixed,
    threshold: mongoose.Schema.Types.Mixed,
  },
  
  // Mode before event
  modeBefore: { type: String, enum: ['OFF', 'ADVISOR', 'ASSIST'] },
  
  // Mode after event
  modeAfter: { type: String, enum: ['OFF', 'ADVISOR', 'ASSIST'] },
  
  // Who triggered
  triggeredBy: { type: String, default: 'system' },
  
  // Full context snapshot
  context: {
    flipRate: Number,
    ece: Number,
    activeAlerts: Number,
    gatesStatus: mongoose.Schema.Types.Mixed,
  },
  
  timestamp: { type: Date, default: Date.now },
});

KillSwitchEventSchema.index({ timestamp: -1 });
KillSwitchEventSchema.index({ eventType: 1, timestamp: -1 });

export const KillSwitchEventModel = mongoose.model('ml_kill_switch_events', KillSwitchEventSchema);
