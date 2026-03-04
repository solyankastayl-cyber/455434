/**
 * BLOCK 83 — Intel Alerts Types
 * 
 * Types for Intelligence Event Alerts Engine
 */

export type IntelAlertEventType =
  | 'LOCK_ENTER'
  | 'LOCK_EXIT'
  | 'DOMINANCE_SHIFT'
  | 'PHASE_DOWNGRADE';

export type IntelAlertSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export type IntelAlertSource = 'LIVE' | 'V2014' | 'V2020';

export type IntelAlertPayload = {
  date: string;
  symbol: string;
  source: IntelAlertSource;
  
  consensusIndex?: number;
  conflictLevel?: 'LOW' | 'MODERATE' | 'HIGH';
  dominanceTier?: 'TIMING' | 'TACTICAL' | 'STRUCTURE';
  structuralLock?: boolean;
  
  phaseType?: string;
  phaseGrade?: 'A' | 'B' | 'C' | 'D' | 'F';
  phaseScore?: number;
  
  volRegime?: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'CRISIS';
  divergenceGrade?: 'A' | 'B' | 'C' | 'D' | 'F';
  divergenceScore?: number;
  
  from?: Record<string, any>;
  to?: Record<string, any>;
  notes?: string[];
};

export type IntelEventAlert = {
  _id?: string;
  date: string;
  symbol: string;
  source: IntelAlertSource;
  eventType: IntelAlertEventType;
  severity: IntelAlertSeverity;
  payload: IntelAlertPayload;
  sent: boolean;
  sentAt?: Date | null;
  rateKey: string;
  createdAt?: Date;
};
