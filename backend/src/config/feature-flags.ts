/**
 * FEATURE FLAGS — Project State Control
 * 
 * PROJECT STATE: SPX HARDENING PHASE
 * 
 * - Combined Mode: LOCKED
 * - UI Redesign: FROZEN
 * - Theme changes: PROHIBITED
 * - Focus: SPX Attribution + Drift + Full Historical Calibration
 */

export const FEATURE_FLAGS = {
  // ═══════════════════════════════════════════════════════════════
  // SPX STATE
  // ═══════════════════════════════════════════════════════════════
  SPX_FINALIZED: false,           // SPX not yet fully complete
  SPX_REAL_HORIZON_STACK: true,   // Use real horizon stack instead of mock
  
  // ═══════════════════════════════════════════════════════════════
  // COMBINED MODE — LOCKED until SPX finalization
  // ═══════════════════════════════════════════════════════════════
  ENABLE_COMBINED: false,         // Combined mode locked
  
  // ═══════════════════════════════════════════════════════════════
  // UI/THEME FREEZE
  // ═══════════════════════════════════════════════════════════════
  ALLOW_THEME_CHANGE: false,      // Theme changes disabled
  ALLOW_BACKGROUND_CHANGE: false, // Background changes disabled
  ALLOW_LAYOUT_CHANGE: false,     // Layout changes disabled
};

export const PROJECT_STATE = {
  phase: 'SPX_HARDENING',
  focus: ['SPX Attribution', 'SPX Drift', 'Full Historical Calibration'],
  frozen: ['Combined Mode', 'UI Redesign', 'Theme System'],
  nextMilestone: 'SPX FINAL → then Combined Mode unlock',
};

export default FEATURE_FLAGS;
