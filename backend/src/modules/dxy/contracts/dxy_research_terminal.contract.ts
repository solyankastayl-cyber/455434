/**
 * DXY RESEARCH TERMINAL CONTRACT — B3
 * 
 * Aggregated research pack combining:
 * - Fractal Terminal (A4)
 * - Macro Core (B1)
 * - Macro Overlay (B2)
 * - Research Summary (human-readable insights)
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import type { DxyTerminalPack, TerminalMacroPack } from './dxy_terminal.contract.js';
import type { MacroScore, MacroContext, MacroSeriesMeta } from '../../dxy-macro-core/contracts/macro.contracts.js';

// ═══════════════════════════════════════════════════════════════
// RESEARCH DRIVER — Top contributing factor
// ═══════════════════════════════════════════════════════════════

export interface ResearchDriver {
  key: string;           // series ID (FEDFUNDS, CPILFESL, etc.)
  label: string;         // human-readable name
  contribution: number;  // weighted contribution (-1..+1)
  note: string;          // human-readable interpretation
}

// ═══════════════════════════════════════════════════════════════
// DATA FRESHNESS — Per-series freshness info
// ═══════════════════════════════════════════════════════════════

export interface DataFreshness {
  key: string;       // series ID
  label: string;     // display name
  lastDate: string;  // ISO date string
  lagDays: number;   // days since last update
  status: 'FRESH' | 'STALE' | 'OLD';
}

// ═══════════════════════════════════════════════════════════════
// RESEARCH BLOCK — Human-readable insights
// ═══════════════════════════════════════════════════════════════

export interface ResearchBlock {
  /** Single-line summary (e.g., "DXY: SHORT bias (86/100). Macro NEUTRAL.") */
  headline: string;
  
  /** 3-6 key bullet points */
  takeaways: string[];
  
  /** Top 3 macro drivers sorted by |contribution| */
  drivers: ResearchDriver[];
  
  /** Risk factors that could invalidate signal */
  risks: string[];
  
  /** Data freshness per series */
  dataFreshness: DataFreshness[];
  
  /** System limitations (fixed disclaimers) */
  limits: string[];
}

// ═══════════════════════════════════════════════════════════════
// MACRO CORE PACK — Aggregated macro data
// ═══════════════════════════════════════════════════════════════

export interface MacroCorePack {
  score: MacroScore;
  contexts: Record<string, MacroContext>;  // keyed by seriesId
  seriesMeta: MacroSeriesMeta[];
}

// ═══════════════════════════════════════════════════════════════
// DXY RESEARCH PACK — Main response
// ═══════════════════════════════════════════════════════════════

export interface DxyResearchPack {
  ok: boolean;
  asset: 'DXY';
  focus: string;
  ts: string;
  processingTimeMs: number;
  
  /** Full terminal data (A4) */
  terminal: DxyTerminalPack;
  
  /** Macro core data (B1) */
  macroCore: MacroCorePack;
  
  /** Macro overlay (B2) — extracted from terminal for convenience */
  overlay: TerminalMacroPack | null;
  
  /** Research insights (B3) */
  research: ResearchBlock;
}

// ═══════════════════════════════════════════════════════════════
// DEBUG PACK — For transparency
// ═══════════════════════════════════════════════════════════════

export interface ResearchDebugPack {
  ok: boolean;
  sources: {
    terminalEndpoint: string;
    macroScoreEndpoint: string;
    macroSeriesUsed: string[];
    overlayVersion: string;
  };
  timing: {
    terminalMs: number;
    macroMs: number;
    researchMs: number;
    totalMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// REQUEST PARAMS
// ═══════════════════════════════════════════════════════════════

export interface DxyResearchParams {
  focus: string;       // "7d" | "14d" | "30d" | "90d" | "180d" | "365d"
  rank?: number;       // 1..10 (default: 1)
}
