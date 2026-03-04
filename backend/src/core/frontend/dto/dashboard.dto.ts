/**
 * Dashboard DTO - Frontend response structure
 */

export interface GlobalStateDTO {
  mlStatus: 'RULES_ONLY' | 'SHADOW' | 'ACTIVE';
  driftLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidenceMode: 'RULES' | 'ML';
}

export interface TokenItemDTO {
  symbol: string;
  name: string;
  contractAddress: string;
  decision: 'BUY' | 'WATCH' | 'SELL';
  confidence: number;
  badges: string[];
  explanation: string;
  priceUsd?: number;
  change24h?: number;
}

export interface PaginationDTO {
  page: number;
  limit: number;
  totalTokens: number;
  hasNextPage: boolean;
}

export interface DashboardResponseDTO {
  globalState: GlobalStateDTO;
  pagination: PaginationDTO;
  tokens: TokenItemDTO[];
}
