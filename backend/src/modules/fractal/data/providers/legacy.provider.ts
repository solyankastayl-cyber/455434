/**
 * Legacy Provider - Historical BTC data 2010-2014
 * 
 * Merges early Mt.Gox era data with modern sources.
 * Source: GitHub Bitcoin Historical Data (Investing.com format)
 * 
 * Coverage: Jul 2010 → Aug 2020
 * We use: Jul 2010 → Nov 2014 (before Bitstamp coverage)
 */

import fs from 'fs';
import path from 'path';
import { OhlcvCandle, HistoricalSourceProvider } from '../../contracts/fractal.contracts.js';

// Cutoff date - we use legacy data BEFORE this point
// After this, Bitstamp (main provider) has better coverage
const LEGACY_CUTOFF = new Date('2014-11-28');

export class LegacyProvider implements HistoricalSourceProvider {
  public readonly name = 'legacy_mtgox';

  private readonly CSV_PATH = path.resolve(
    process.cwd(),
    'data/fractal/bootstrap/BTC_legacy_2010.csv'
  );

  hasLegacyFile(): boolean {
    return fs.existsSync(this.CSV_PATH);
  }

  getExpectedPath(): string {
    return this.CSV_PATH;
  }

  /**
   * Fetch all legacy candles (2010-2014)
   */
  async fetchAll(): Promise<OhlcvCandle[]> {
    if (!fs.existsSync(this.CSV_PATH)) {
      console.log('[LegacyProvider] No legacy file found, skipping early history');
      return [];
    }

    console.log('[LegacyProvider] Reading legacy CSV...');
    const raw = fs.readFileSync(this.CSV_PATH, 'utf-8');
    const lines = raw.split('\n');

    const candles: OhlcvCandle[] = [];

    // Format: "Date","Price","Open","High","Low","Vol.","Change %"
    // Date format: "Aug 02, 2020"
    // Values have commas: "11,105.8"

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        // Parse CSV with quoted fields containing commas
        const parsed = this.parseCSVLine(line);
        if (parsed.length < 6) continue;

        const [dateStr, priceStr, openStr, highStr, lowStr, volStr] = parsed;

        // Parse date "Aug 02, 2020" -> Date
        const ts = this.parseDate(dateStr);
        if (!ts || isNaN(ts.getTime())) continue;

        // Skip data after cutoff (we use modern sources for that)
        if (ts >= LEGACY_CUTOFF) continue;

        // Parse values (remove commas from numbers)
        const close = this.parseNumber(priceStr);
        const open = this.parseNumber(openStr);
        const high = this.parseNumber(highStr);
        const low = this.parseNumber(lowStr);
        const volume = this.parseVolume(volStr);

        if (![open, high, low, close].every(Number.isFinite)) continue;
        if (close === 0) continue;

        candles.push({ ts, open, high, low, close, volume });
      } catch (e) {
        // Skip malformed lines
        continue;
      }
    }

    // Sort chronologically
    candles.sort((a, b) => a.ts.getTime() - b.ts.getTime());

    // Deduplicate
    const deduped: OhlcvCandle[] = [];
    let lastTs = -1;
    for (const c of candles) {
      const t = c.ts.getTime();
      if (t === lastTs) continue;
      lastTs = t;
      deduped.push(c);
    }

    console.log(`[LegacyProvider] Loaded ${deduped.length} legacy candles (2010-2014)`);
    
    if (deduped.length > 0) {
      console.log(`[LegacyProvider] Range: ${deduped[0].ts.toISOString()} → ${deduped[deduped.length - 1].ts.toISOString()}`);
    }

    return deduped;
  }

  async fetchRange(
    symbol: string,
    timeframe: '1d',
    from: Date,
    to: Date
  ): Promise<OhlcvCandle[]> {
    const all = await this.fetchAll();
    const fromT = from.getTime();
    const toT = to.getTime();
    return all.filter(c => c.ts.getTime() >= fromT && c.ts.getTime() <= toT);
  }

  // Helpers

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  private parseDate(dateStr: string): Date | null {
    // "Aug 02, 2020" -> Date
    const months: Record<string, number> = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };

    const match = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
    if (!match) return null;

    const [, monthStr, dayStr, yearStr] = match;
    const month = months[monthStr];
    if (month === undefined) return null;

    return new Date(Date.UTC(
      parseInt(yearStr),
      month,
      parseInt(dayStr)
    ));
  }

  private parseNumber(str: string): number {
    // Remove commas: "11,105.8" -> 11105.8
    return parseFloat(str.replace(/,/g, ''));
  }

  private parseVolume(str: string): number {
    // "698.62K" -> 698620
    // "1.23M" -> 1230000
    const cleaned = str.replace(/,/g, '').trim();
    
    if (cleaned.endsWith('K')) {
      return parseFloat(cleaned.slice(0, -1)) * 1000;
    }
    if (cleaned.endsWith('M')) {
      return parseFloat(cleaned.slice(0, -1)) * 1000000;
    }
    if (cleaned.endsWith('B')) {
      return parseFloat(cleaned.slice(0, -1)) * 1000000000;
    }
    
    return parseFloat(cleaned) || 0;
  }
}
