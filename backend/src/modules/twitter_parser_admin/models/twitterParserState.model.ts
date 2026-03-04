// TwitterParserState Model - v4.0 Parser Control Plane
// Singleton document for global parser state

export type ParserMode = 'LIMITED' | 'STANDARD' | 'FULL';
export type ParserStatus = 'RUNNING' | 'PAUSED' | 'DEGRADED' | 'ERROR';

export interface ParserLastError {
  source: string;
  message: string;
}

export interface TwitterParserState {
  _id: string; // always 'singleton'
  mode: ParserMode;
  status: ParserStatus;
  activeSlots: number;
  activeAccounts: number;
  lastTickAt?: number;
  lastError?: ParserLastError;
  updatedAt: number;
}

// Default state
export const DEFAULT_PARSER_STATE: Omit<TwitterParserState, '_id'> = {
  mode: 'STANDARD',
  status: 'PAUSED',
  activeSlots: 0,
  activeAccounts: 0,
  updatedAt: Date.now(),
};
