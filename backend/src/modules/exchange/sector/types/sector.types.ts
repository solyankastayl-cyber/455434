/**
 * BLOCK 2.9 — Sector Types
 * ========================
 * Sector taxonomy and asset tag definitions.
 */

export type Sector =
  | 'L1'       // Layer 1 blockchains
  | 'L2'       // Layer 2 solutions
  | 'DEFI'     // DeFi protocols
  | 'AI'       // AI/ML projects
  | 'MEME'     // Meme coins
  | 'NFT'      // NFT-related
  | 'INFRA'    // Infrastructure
  | 'ORACLE'   // Oracle networks
  | 'GAMING'   // GameFi
  | 'RWA'      // Real World Assets
  | 'PERPS'    // Perpetuals/DEX derivatives
  | 'DEX'      // Decentralized exchanges
  | 'CEFI'     // CeFi tokens
  | 'UNKNOWN';

export interface AssetTag {
  symbol: string;
  sector: Sector;
  tags?: string[];
  source?: 'manual' | 'seed' | 'import';
}

export interface AssetTagsDoc {
  _id?: any;
  symbol: string;
  sector: Sector;
  tags: string[];
  source: 'manual' | 'seed' | 'import';
  createdAt: Date;
  updatedAt: Date;
}

export interface SectorState {
  ts: Date;
  sector: Sector;
  symbols: number;
  momentum: number;        // average score_up - score_down
  breadth: number;         // % of symbols with score_up > 0.6
  squeezeRisk: number;     // derived from funding/OI
  dispersion: number;      // stddev of scores within sector
  rotationScore: number;   // final ranking score
  topSymbols: Array<{ symbol: string; score: number }>;
}

export interface WaveCandidate {
  symbol: string;
  sector: Sector;
  waveId: string;
  similarityToWinners: number;
  alreadyMoved: boolean;
  expectedMoveStrength: number;
  finalPickScore: number;
  reasons: string[];
}

console.log('[Sector] Types loaded');
