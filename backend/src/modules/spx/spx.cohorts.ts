/**
 * SPX TERMINAL — Cohort Segmentation
 * 
 * BLOCK B2 — Cohort tagging for SPX data
 * 
 * Cohorts:
 * - V1950: 1950-1989 (Post-war era)
 * - V1990: 1990-2007 (Dot-com + Pre-crisis)
 * - V2008: 2008-2019 (GFC + Recovery)
 * - V2020: 2020-2025 (COVID + Post-pandemic)
 * - LIVE: 2026+ (Production accumulation)
 */

import type { SpxCohort } from './spx.types.js';

export function pickSpxCohort(dateISO: string): SpxCohort {
  // dateISO: YYYY-MM-DD
  const y = Number(dateISO.slice(0, 4));

  // Vintage cohorts for historical backfill
  if (y >= 1950 && y <= 1989) return 'V1950';
  if (y >= 1990 && y <= 2007) return 'V1990';
  if (y >= 2008 && y <= 2019) return 'V2008';
  if (y >= 2020 && y <= 2025) return 'V2020';

  // Everything >= 2026 we treat as LIVE (production accumulation)
  if (y >= 2026) return 'LIVE';

  // fallback (should not happen if you choose proper ranges)
  return 'V1950';
}

export function pickSpxCohortByTs(ts: number): SpxCohort {
  const date = new Date(ts);
  const y = date.getUTCFullYear();

  if (y >= 1950 && y <= 1989) return 'V1950';
  if (y >= 1990 && y <= 2007) return 'V1990';
  if (y >= 2008 && y <= 2019) return 'V2008';
  if (y >= 2020 && y <= 2025) return 'V2020';
  if (y >= 2026) return 'LIVE';

  return 'V1950';
}
