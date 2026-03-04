/**
 * Behavioral AML Types
 * 
 * Types for behavioral money laundering pattern detection
 */

export interface BehavioralSignal {
  id: string;
  type: 'PEEL_CHAIN' | 'ROUND_TRIPPING' | 'STRUCTURING' | 'SELF_TRANSFER_LOOP';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  network: string;
  address: string;
  window: {
    fromTs: number;
    toTs: number;
    label: string;
  };
  metrics: Record<string, any>;
  evidence: Array<{
    kind: 'TRANSFER' | 'PATTERN' | 'NOTE';
    ref?: string;
    text?: string;
  }>;
  createdAtTs: number;
}
