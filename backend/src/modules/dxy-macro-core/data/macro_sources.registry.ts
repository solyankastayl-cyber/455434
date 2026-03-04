/**
 * MACRO SOURCES REGISTRY — B1
 * 
 * Source of truth for macro series definitions.
 * B1 Core Set: 7 series (FRED)
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

export type MacroFrequency = "daily" | "weekly" | "monthly";

export type MacroRole =
  | "rates"
  | "inflation"
  | "labor"
  | "liquidity"
  | "curve"
  | "growth"
  | "housing"
  | "credit";

export type MacroTransform =
  | "level"          // raw level
  | "yoy"            // year-over-year %
  | "mom"            // month-over-month %
  | "ann3m"          // annualized 3m
  | "delta"          // simple delta
  | "zscore";        // derived normalization (computed later)

export interface MacroSeriesSpec {
  seriesId: string;            // FRED series id
  displayName: string;         // UI/labels
  frequency: MacroFrequency;
  units: string;               // "percent", "index", "billions", etc.
  role: MacroRole;

  // how we interpret & compute context/pressure
  primaryTransform: MacroTransform;  // what "current" means
  secondaryTransforms?: MacroTransform[]; // extra stats we compute

  // ingestion / data quality
  minCoverageYears?: number;   // guards for "good enough"
  enabledByDefault: boolean;   // B1 uses only enabled=true
  notes?: string;
}

export const MACRO_SERIES_REGISTRY: MacroSeriesSpec[] = [
  // =========================
  // B1 CORE SET (7) — ENABLED
  // =========================

  {
    seriesId: "FEDFUNDS",
    displayName: "Fed Funds Rate",
    frequency: "monthly",
    units: "percent",
    role: "rates",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    minCoverageYears: 40,
    enabledByDefault: true,
    notes: "Policy rate. Context: tightening/easing/pausing based on 3m/12m deltas.",
  },

  {
    seriesId: "CPIAUCSL",
    displayName: "CPI (Headline)",
    frequency: "monthly",
    units: "index",
    role: "inflation",
    primaryTransform: "yoy",
    secondaryTransforms: ["mom", "ann3m"],
    minCoverageYears: 40,
    enabledByDefault: true,
    notes: "Headline inflation. Prefer YoY for regime; MoM/ann3m for momentum.",
  },

  {
    seriesId: "CPILFESL",
    displayName: "CPI (Core)",
    frequency: "monthly",
    units: "index",
    role: "inflation",
    primaryTransform: "yoy",
    secondaryTransforms: ["mom", "ann3m"],
    minCoverageYears: 40,
    enabledByDefault: true,
    notes: "Core inflation. Usually more stable; good for pressure signal.",
  },

  {
    seriesId: "UNRATE",
    displayName: "Unemployment Rate",
    frequency: "monthly",
    units: "percent",
    role: "labor",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    minCoverageYears: 40,
    enabledByDefault: true,
    notes: "Labor stress gauge. Context from level + 3m/12m changes.",
  },

  {
    seriesId: "PPIACO",
    displayName: "Producer Price Index (PPI)",
    frequency: "monthly",
    units: "index",
    role: "inflation",
    primaryTransform: "yoy",
    secondaryTransforms: ["mom"],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Pipeline inflation. Helps detect inflation pressure earlier than CPI.",
  },

  {
    seriesId: "M2SL",
    displayName: "M2 Money Supply",
    frequency: "monthly",
    units: "billions",
    role: "liquidity",
    primaryTransform: "yoy",
    secondaryTransforms: [],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Liquidity proxy. Use YoY growth as liquidity pressure indicator.",
  },

  {
    seriesId: "T10Y2Y",
    displayName: "Yield Curve (10Y-2Y)",
    frequency: "daily",
    units: "percent",
    role: "curve",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Inversion/steepening regime. Often leads growth/credit stress.",
  },

  // =====================================
  // EXTENSIONS (disabled) — add later in B+
  // =====================================

  {
    seriesId: "DGS10",
    displayName: "10Y Treasury Yield",
    frequency: "daily",
    units: "percent",
    role: "rates",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    enabledByDefault: false,
    notes: "Useful to separate curve slope vs outright yield level.",
  },

  {
    seriesId: "DGS2",
    displayName: "2Y Treasury Yield",
    frequency: "daily",
    units: "percent",
    role: "rates",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    enabledByDefault: false,
    notes: "Short-end yield sensitive to policy expectations.",
  },

  {
    seriesId: "PAYEMS",
    displayName: "Nonfarm Payrolls (Total)",
    frequency: "monthly",
    units: "thousands",
    role: "labor",
    primaryTransform: "yoy",
    secondaryTransforms: [],
    enabledByDefault: false,
    notes: "Employment growth momentum. Needs careful transforms.",
  },

  {
    seriesId: "INDPRO",
    displayName: "Industrial Production",
    frequency: "monthly",
    units: "index",
    role: "growth",
    primaryTransform: "yoy",
    secondaryTransforms: [],
    enabledByDefault: false,
    notes: "Growth proxy; can improve regime detection.",
  },

  {
    seriesId: "HOUST",
    displayName: "Housing Starts",
    frequency: "monthly",
    units: "thousands",
    role: "housing",
    primaryTransform: "yoy",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,  // B4.1: Enabled
    notes: "Rate-sensitive sector; good early-cycle signal.",
  },

  // B4.1: Housing & Real Estate Series
  {
    seriesId: "MORTGAGE30US",
    displayName: "30Y Fixed Mortgage Rate",
    frequency: "weekly",
    units: "percent",
    role: "housing",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Mortgage rate directly affects housing affordability and DXY correlation.",
  },

  {
    seriesId: "PERMIT",
    displayName: "Building Permits",
    frequency: "monthly",
    units: "thousands",
    role: "housing",
    primaryTransform: "yoy",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Leading indicator for housing starts.",
  },

  {
    seriesId: "CSUSHPISA",
    displayName: "Case-Shiller Home Price Index",
    frequency: "monthly",
    units: "index",
    role: "housing",
    primaryTransform: "yoy",
    secondaryTransforms: [],
    minCoverageYears: 20,
    enabledByDefault: true,
    notes: "National home price index; wealth effect indicator.",
  },

  {
    seriesId: "BAA10Y",
    displayName: "Moody's Baa Corporate Spread",
    frequency: "monthly",
    units: "percent",
    role: "credit",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,  // B4.3: Enabled
    notes: "Credit stress proxy. High spreads = stress = USD supportive.",
  },

  // B4.2: PMI & Economic Activity Series
  {
    seriesId: "MANEMP",
    displayName: "Manufacturing Employment",
    frequency: "monthly",
    units: "thousands",
    role: "growth",
    primaryTransform: "yoy",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Manufacturing employment as activity proxy. YoY change indicates momentum.",
  },

  {
    seriesId: "INDPRO",
    displayName: "Industrial Production",
    frequency: "monthly",
    units: "index",
    role: "growth",
    primaryTransform: "yoy",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Industrial production index. YoY change indicates economic momentum.",
  },

  {
    seriesId: "TCU",
    displayName: "Capacity Utilization",
    frequency: "monthly",
    units: "percent",
    role: "growth",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Capacity utilization rate. High = tight capacity = inflation pressure.",
  },

  // B4.3: Credit & Financial Stress Series
  {
    seriesId: "BAA10Y",
    displayName: "Moody's Baa Corporate Spread",
    frequency: "daily",
    units: "percent",
    role: "credit",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    minCoverageYears: 30,
    enabledByDefault: true,
    notes: "Credit stress proxy. High spreads = stress = USD supportive.",
  },

  {
    seriesId: "TEDRATE",
    displayName: "TED Spread",
    frequency: "daily",
    units: "percent",
    role: "credit",
    primaryTransform: "level",
    secondaryTransforms: ["delta"],
    minCoverageYears: 20,
    enabledByDefault: true,
    notes: "TED spread (3m LIBOR - 3m T-Bill). Banking stress indicator.",
  },

  {
    seriesId: "VIXCLS",
    displayName: "VIX (Volatility Index)",
    frequency: "daily",
    units: "index",
    role: "credit",
    primaryTransform: "level",
    secondaryTransforms: [],
    minCoverageYears: 20,
    enabledByDefault: true,
    notes: "VIX volatility index. High = fear = USD safe-haven bid.",
  },
];

/**
 * Get default series IDs for B1 Core Set
 */
export function getDefaultMacroSeries(): string[] {
  return MACRO_SERIES_REGISTRY
    .filter(s => s.enabledByDefault)
    .map(s => s.seriesId);
}

/**
 * Get series spec by ID
 */
export function getMacroSeriesSpec(seriesId: string): MacroSeriesSpec | undefined {
  return MACRO_SERIES_REGISTRY.find(s => s.seriesId === seriesId);
}

/**
 * Get all enabled series specs
 */
export function getEnabledMacroSeries(): MacroSeriesSpec[] {
  return MACRO_SERIES_REGISTRY.filter(s => s.enabledByDefault);
}
