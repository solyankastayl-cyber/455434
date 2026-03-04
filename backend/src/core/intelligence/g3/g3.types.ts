/**
 * G3 AML/KYT Types
 * 
 * Type definitions for AML compliance and KYT risk assessment
 */

export type Network =
  | 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon'
  | 'bnb' | 'zksync' | 'scroll';

export type Verdict = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ExposureBucket =
  | 'CEX'
  | 'BRIDGE'
  | 'MIXER'
  | 'DEFI'
  | 'HIGH_RISK'
  | 'SANCTIONED'
  | 'UNKNOWN';

/**
 * Exposure analysis result
 */
export interface ExposureResult {
  byBucketShare: Record<ExposureBucket, number>; // 0..1
  topCounterparties: Array<{
    address: string;
    bucket: ExposureBucket;
    volumeUsd: number;
    txCount: number;
    share: number;
    label?: string;
  }>;
  totals: {
    totalVolumeUsd: number;
    totalTxCount: number;
    uniqueCounterparties: number;
  };
}

/**
 * Sanctions check result
 */
export interface SanctionsResult {
  isSanctioned: boolean;
  lists: string[];
  confidence: number; // always 1.0 for exact match
}

/**
 * Complete AML check result
 */
export interface AmlCheckResult {
  network: Network;
  address: string;

  sanctions: SanctionsResult;
  exposure: ExposureResult;

  riskScore: number; // 0..100
  verdict: Verdict;
  flags: string[];

  evidence: Array<{ kind: 'NOTE' | 'RULE'; text: string }>;

  meta: {
    computeTimeMs: number;
    window: '7d' | '30d';
    usedSources: string[];
  };
}
