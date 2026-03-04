/**
 * Phase G: Pattern Mapper
 * 
 * Classifies scenario components into setup kinds for entry/stop/target rules
 */

export type SetupKind =
  | 'BREAKOUT_RETEST'
  | 'TRIANGLE'
  | 'CHANNEL'
  | 'REVERSAL_NECKLINE'
  | 'FLAG'
  | 'CANDLE_ONLY'
  | 'HARMONIC'
  | 'UNKNOWN';

export function inferSetupKind(components: any[]): SetupKind {
  const types = new Set(components.map((c: any) => c.type));

  if (types.has('BREAKOUT_RETEST_BULL') || types.has('BREAKOUT_RETEST_BEAR') || 
      types.has('LEVEL_BREAKOUT') || types.has('LEVEL_RETEST')) {
    return 'BREAKOUT_RETEST';
  }
  
  if ([...types].some(t => t.startsWith('TRIANGLE_') || t.startsWith('WEDGE_'))) {
    return 'TRIANGLE';
  }
  
  if (types.has('CHANNEL_UP') || types.has('CHANNEL_DOWN')) {
    return 'CHANNEL';
  }
  
  if (types.has('HEAD_SHOULDERS') || types.has('INVERTED_HEAD_SHOULDERS') || 
      types.has('HNS') || types.has('IHNS') ||
      types.has('DOUBLE_TOP') || types.has('DOUBLE_BOTTOM')) {
    return 'REVERSAL_NECKLINE';
  }
  
  if (types.has('FLAG_BULL') || types.has('FLAG_BEAR') || types.has('PENNANT')) {
    return 'FLAG';
  }

  if ([...types].some(t => t.startsWith('HARMONIC_'))) {
    return 'HARMONIC';
  }
  
  if ([...types].some(t => t.startsWith('CANDLE_') || t.startsWith('ENGULF') || t.startsWith('PINBAR'))) {
    return 'CANDLE_ONLY';
  }

  return 'UNKNOWN';
}
