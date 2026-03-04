/**
 * Advanced Signals & Attribution DTO
 * Answers: "Why does the system think this way?"
 */

export interface CoverageDTO {
  activeSignals: number;
  coveragePercent: number;
  conflictRate: number;
}

export interface TopSignalImpactDTO {
  signalType: string;
  direction: 'POSITIVE' | 'NEGATIVE';
  confidenceImpact: number;
}

export interface ConfidenceCalibrationDTO {
  status: 'OK' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'INSUFFICIENT_DATA';
  note?: string;
}

export interface LinksDTO {
  tokenExample?: string;
}

export interface AdvancedSignalsAttributionDTO {
  coverage: CoverageDTO;
  topImpactSignals: TopSignalImpactDTO[];
  confidenceCalibration: ConfidenceCalibrationDTO;
  links: LinksDTO;
}
