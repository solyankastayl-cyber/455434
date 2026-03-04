/**
 * Phase O: Stream Types
 * 
 * Event types for real-time TA signal streaming
 */

export type TAStreamEventType =
  | 'DECISION'
  | 'MTF_DECISION'
  | 'REGIME_UPDATE'
  | 'OUTCOME_UPDATE'
  | 'CALIBRATION_UPDATE'
  | 'ALERT';

export interface TAStreamEvent {
  id: string;
  type: TAStreamEventType;
  asset?: string;
  timeframe?: string;
  ts: number;
  payload: any;
}

export interface TAStreamSubscription {
  assets?: string[];      // ["BTCUSDT","ETHUSDT"] or ["*"]
  timeframes?: string[];  // ["1d","4h","1h"] or ["*"]
  types?: TAStreamEventType[];
}

// MongoDB outbox document
export interface OutboxEventDoc {
  id: string;
  type: TAStreamEventType;
  asset?: string;
  timeframe?: string;
  ts: number;
  payload: any;
  createdAt: Date;
  delivered: boolean;
  deliveredAt: Date | null;
  attempts: number;
}
