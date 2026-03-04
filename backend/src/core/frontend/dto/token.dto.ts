/**
 * Token Page DTO - Full token details
 */

export interface TokenDecisionDTO {
  action: 'BUY' | 'WATCH' | 'SELL';
  confidence: number;
  baseConfidence: number;
}

export interface TokenStatusDTO {
  mlActive: boolean;
  driftLevel: string;
  approvalStatus?: string;
}

export interface PriceSnapshotDTO {
  priceUsd: number;
  change24h: number;
  volume24h: number;
  marketCap?: number;
}

export interface TrendDTO {
  label: 'NOISE' | 'SIDEWAYS' | 'TREND_UP' | 'TREND_DOWN';
  horizon: string;
  confidence: number;
}

export interface RiskDTO {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  drawdown7d: number;
}

export interface SignalDTO {
  signalType: string;
  direction: string;
  detectedAt: Date;
  note?: string;
}

export interface TokenPageResponseDTO {
  symbol: string;
  name: string;
  contractAddress: string;
  decision: TokenDecisionDTO;
  status: TokenStatusDTO;
  priceSnapshot: PriceSnapshotDTO;
  trend: TrendDTO;
  risk: RiskDTO;
  signals: SignalDTO[];
}
