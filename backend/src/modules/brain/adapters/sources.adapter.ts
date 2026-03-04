/**
 * AE/S-Brain v2 — Sources Adapter
 * 
 * Single point where Brain knows how to fetch data from existing services.
 * All internal endpoint knowledge is here — Brain services don't know paths.
 */

import { AssetId } from '../contracts/asset_state.contract.js';

// Internal base URL (same process)
const INTERNAL_BASE = 'http://127.0.0.1:8002';

interface FetchOptions {
  timeout?: number;
}

async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!res.ok) return null;
    return await res.json() as T;
  } catch (e) {
    console.error(`[Brain Adapter] Fetch failed: ${url}`, (e as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FRACTAL TERMINAL
// ═══════════════════════════════════════════════════════════════

export interface FractalTerminalResponse {
  ok: boolean;
  resolver?: {
    final?: {
      action?: string;
      confidence?: number;
    };
  };
  chart?: {
    currentPrice?: number;
  };
  volatility?: {
    regime?: string;
    vol20d?: number;
  };
  horizons?: Record<string, {
    endReturn?: number;
    confidence?: number;
  }>;
}

export async function getFractalTerminal(
  asset: AssetId,
  asOf?: string
): Promise<FractalTerminalResponse | null> {
  // Map asset to correct endpoint
  const endpoint = asset === 'btc'
    ? `${INTERNAL_BASE}/api/fractal/v2.1/terminal?symbol=BTC&set=extended`
    : asset === 'spx'
      ? `${INTERNAL_BASE}/api/fractal/spx/terminal`
      : `${INTERNAL_BASE}/api/fractal/dxy/terminal`;
  
  return fetchJson<FractalTerminalResponse>(endpoint);
}

// ═══════════════════════════════════════════════════════════════
// MACRO ENGINE V2
// ═══════════════════════════════════════════════════════════════

export interface MacroEnginePackResponse {
  engineVersion?: string;
  regime?: {
    dominant?: string;
    confidence?: number;
    posterior?: Record<string, number>;
  };
  drivers?: {
    scoreSigned?: number;
    components?: Array<{
      key?: string;
      weight?: number;
      direction?: number;
    }>;
  };
  overlay?: Record<string, {
    expectedReturn?: number;
    confidence?: number;
  }>;
  router?: {
    mode?: string;
    chosen?: string;
    reason?: string;
  };
}

export async function getMacroEnginePack(
  asset: AssetId,
  asOf?: string
): Promise<MacroEnginePackResponse | null> {
  const url = asOf
    ? `${INTERNAL_BASE}/api/macro-engine/${asset}/pack?asOf=${asOf}`
    : `${INTERNAL_BASE}/api/macro-engine/${asset}/pack`;
  
  return fetchJson<MacroEnginePackResponse>(url);
}

// ═══════════════════════════════════════════════════════════════
// MACRO HEALTH / SHADOW
// ═══════════════════════════════════════════════════════════════

export interface MacroHealthResponse {
  engine?: string;
  rollingHitRateDelta?: number;
  signMismatchRatio?: number;
  regimeStability?: number;
  weightDrift?: number;
  status?: string;
  alerts?: any[];
}

export async function getMacroHealth(): Promise<MacroHealthResponse | null> {
  return fetchJson<MacroHealthResponse>(`${INTERNAL_BASE}/api/macro-engine/health`);
}

// ═══════════════════════════════════════════════════════════════
// LIQUIDITY
// ═══════════════════════════════════════════════════════════════

export interface LiquidityStateResponse {
  ok?: boolean;
  impulse?: number;
  regime?: string;
  confidence?: number;
}

export async function getLiquidityState(): Promise<LiquidityStateResponse | null> {
  return fetchJson<LiquidityStateResponse>(`${INTERNAL_BASE}/api/liquidity/state`);
}

// ═══════════════════════════════════════════════════════════════
// GUARD
// ═══════════════════════════════════════════════════════════════

export interface GuardStateResponse {
  ok?: boolean;
  level?: string;
  since?: string;
  rationale?: string;
}

export async function getGuardState(asset: AssetId = 'dxy'): Promise<GuardStateResponse | null> {
  // Try DXY macro guard first
  const url = `${INTERNAL_BASE}/api/dxy-macro-core/guard/current`;
  return fetchJson<GuardStateResponse>(url);
}

// ═══════════════════════════════════════════════════════════════
// SPX CONSENSUS
// ═══════════════════════════════════════════════════════════════

export interface SpxConsensusResponse {
  ok?: boolean;
  data?: {
    direction?: string;
    conflictLevel?: string;
    confidence?: number;
    sizes?: {
      final?: number;
    };
  };
}

export async function getSpxConsensus(): Promise<SpxConsensusResponse | null> {
  return fetchJson<SpxConsensusResponse>(`${INTERNAL_BASE}/api/spx/v2.1/consensus`);
}

// ═══════════════════════════════════════════════════════════════
// ENGINE GLOBAL
// ═══════════════════════════════════════════════════════════════

export interface EngineGlobalResponse {
  ok?: boolean;
  allocations?: Record<string, {
    size?: number;
    direction?: string;
  }>;
  cascade?: Record<string, number>;
}

export async function getEngineGlobal(): Promise<EngineGlobalResponse | null> {
  return fetchJson<EngineGlobalResponse>(`${INTERNAL_BASE}/api/engine/global`);
}

// ═══════════════════════════════════════════════════════════════
// CALIBRATION STATUS
// ═══════════════════════════════════════════════════════════════

export interface CalibrationStatusResponse {
  weightsVersionId?: string;
  perHorizon?: Record<string, Record<string, number>>;
  lastCalibration?: string;
}

export async function getCalibrationStatus(): Promise<CalibrationStatusResponse | null> {
  return fetchJson<CalibrationStatusResponse>(
    `${INTERNAL_BASE}/api/macro-engine/v2/calibration/status`
  );
}
