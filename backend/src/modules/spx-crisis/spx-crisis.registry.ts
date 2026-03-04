/**
 * SPX CRISIS EPOCH REGISTRY
 * 
 * BLOCK B6.10.1 — Defines crisis epochs for validation
 * 
 * These epochs are used to validate whether SPX edge is stable
 * across market stress periods (1970s stagflation, 1987, 2000, 2008, 2020, 2022).
 */

export interface CrisisEpoch {
  code: string;
  label: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  type: 'BEAR' | 'CRASH' | 'CRISIS' | 'VOLATILITY';
  description: string;
}

export const SPX_CRISIS_EPOCHS: CrisisEpoch[] = [
  // Early era for testing (calibration starts from 1950)
  {
    code: 'EARLY_50S',
    label: 'Post-War Recovery',
    start: '1950-01-01',
    end: '1952-12-31',
    type: 'VOLATILITY',
    description: 'Korean War, post-WWII market adjustment'
  },
  {
    code: 'STAGFLATION_70S',
    label: 'Stagflation 70s',
    start: '1973-01-01',
    end: '1982-12-31',
    type: 'CRISIS',
    description: 'Oil shock, high inflation, recession cycle'
  },
  {
    code: 'BLACK_MON_87',
    label: 'Black Monday 1987',
    start: '1987-07-01',
    end: '1987-12-31',
    type: 'CRASH',
    description: '22% single-day crash, program trading'
  },
  {
    code: 'DOTCOM',
    label: 'Dotcom Crash',
    start: '2000-03-01',
    end: '2002-10-31',
    type: 'BEAR',
    description: 'Tech bubble burst, 78% NASDAQ decline'
  },
  {
    code: 'GFC_2008',
    label: 'Global Financial Crisis',
    start: '2007-10-01',
    end: '2009-06-30',
    type: 'CRISIS',
    description: 'Lehman, housing crisis, 57% SPX decline'
  },
  {
    code: 'EURO_CRISIS',
    label: 'Euro Debt Crisis',
    start: '2011-04-01',
    end: '2012-12-31',
    type: 'VOLATILITY',
    description: 'Greek debt, peripheral Europe stress'
  },
  {
    code: 'COVID',
    label: 'COVID Crash',
    start: '2020-02-01',
    end: '2020-12-31',
    type: 'CRASH',
    description: '34% crash in 33 days, fastest bear market'
  },
  {
    code: 'RATE_SHOCK_22',
    label: 'Rate Shock 2022',
    start: '2022-01-01',
    end: '2022-12-31',
    type: 'BEAR',
    description: 'Fed tightening, 27% SPX decline'
  }
];

// Helper to find epoch by date
export function getEpochForDate(dateStr: string): CrisisEpoch | null {
  for (const epoch of SPX_CRISIS_EPOCHS) {
    if (dateStr >= epoch.start && dateStr <= epoch.end) {
      return epoch;
    }
  }
  return null;
}

// Get all epoch codes
export function getEpochCodes(): string[] {
  return SPX_CRISIS_EPOCHS.map(e => e.code);
}
