/**
 * Bootstrap CSV Provider - OFFLINE ONLY
 * 
 * Reads pre-downloaded CSV from local filesystem.
 * Supports multiple CSV formats (CryptoDataDownload, Kraken, generic)
 * 
 * Bootstrap is a one-time data ingestion stage, not runtime.
 * 
 * Expected file location:
 *   /app/backend/data/fractal/bootstrap/BTCUSD_daily.csv
 * 
 * Data source: https://www.cryptodatadownload.com
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { OhlcvCandle, HistoricalSourceProvider } from '../../contracts/fractal.contracts.js';

export class KrakenCsvProvider implements HistoricalSourceProvider {
  public readonly name = 'bootstrap_csv';

  private readonly CSV_PATH = path.resolve(
    process.cwd(),
    'data/fractal/bootstrap/BTCUSD_daily.csv'
  );

  hasBootstrapFile(): boolean {
    return fs.existsSync(this.CSV_PATH);
  }

  getExpectedPath(): string {
    return this.CSV_PATH;
  }

  private ensureFileExists(): void {
    if (!fs.existsSync(this.CSV_PATH)) {
      throw new Error(
        `[BootstrapCSV] Bootstrap file not found.\n` +
        `Expected path: ${this.CSV_PATH}\n` +
        `Download from: https://www.cryptodatadownload.com`
      );
    }
  }

  async fetchAll(): Promise<OhlcvCandle[]> {
    this.ensureFileExists();

    console.log('[BootstrapCSV] Reading local CSV file...');
    const raw = fs.readFileSync(this.CSV_PATH, 'utf-8');
    const lines = raw.split('\n');

    // CryptoDataDownload format has header comment on line 1
    // Line 1: https://www.CryptoDataDownload.com
    // Line 2: unix,date,symbol,open,high,low,close,Volume BTC,Volume USD
    // Data starts line 3

    const candles: OhlcvCandle[] = [];

    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length < 8) continue;

      const tsSec = Number(parts[0]);
      if (!Number.isFinite(tsSec)) continue;

      // CryptoDataDownload format: unix,date,symbol,open,high,low,close,Volume BTC,Volume USD
      const open = Number(parts[3]);
      const high = Number(parts[4]);
      const low = Number(parts[5]);
      const close = Number(parts[6]);
      const volume = Number(parts[7]); // Volume BTC

      if (![open, high, low, close, volume].every(Number.isFinite)) continue;
      if (close === 0) continue;

      candles.push({
        ts: new Date(tsSec * 1000),
        open,
        high,
        low,
        close,
        volume
      });
    }

    // Sort chronologically (oldest first)
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

    console.log(`[BootstrapCSV] Loaded ${deduped.length} historical candles`);
    
    if (deduped.length > 0) {
      console.log(`[BootstrapCSV] Range: ${deduped[0].ts.toISOString()} → ${deduped[deduped.length - 1].ts.toISOString()}`);
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
}
