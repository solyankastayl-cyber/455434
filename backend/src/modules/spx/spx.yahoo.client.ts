/**
 * SPX TERMINAL — Yahoo Finance Client (Fallback)
 * 
 * BLOCK B1 — Alternative data source when Stooq is rate-limited
 * 
 * Uses Yahoo Finance unofficial API (no key required).
 * Returns daily OHLCV for SPX/SPY.
 */

export interface YahooRow {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

/**
 * Fetch SPX/SPY daily candles from Yahoo Finance
 * @param symbol - "^GSPC" for S&P500, "SPY" for SPY ETF
 * @param years - Number of years of history (default 75 for full history)
 */
export async function fetchYahooCandles(
  symbol: string = '^GSPC',
  years: number = 75
): Promise<{ csv: string; rows: YahooRow[] }> {
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - years * 365 * 24 * 60 * 60;
  
  const url = `https://query1.finance.yahoo.com/v7/finance/download/${encodeURIComponent(symbol)}?period1=${startTs}&period2=${endTs}&interval=1d&events=history&includeAdjustedClose=true`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/csv,*/*',
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`YAHOO_FETCH_FAILED: ${res.status} ${res.statusText} ${txt.slice(0, 200)}`);
  }

  const csv = await res.text();
  const rows = parseYahooCsv(csv);

  return { csv, rows };
}

/**
 * Parse Yahoo CSV into rows
 */
function parseYahooCsv(csv: string): YahooRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Header: Date,Open,High,Low,Close,Adj Close,Volume
  const header = lines[0].toLowerCase().split(',');
  const idx = {
    date: header.indexOf('date'),
    open: header.indexOf('open'),
    high: header.indexOf('high'),
    low: header.indexOf('low'),
    close: header.indexOf('close'),
    adjClose: header.indexOf('adj close'),
    volume: header.indexOf('volume'),
  };

  if (idx.date < 0 || idx.open < 0 || idx.high < 0 || idx.low < 0 || idx.close < 0) {
    throw new Error(`YAHOO_CSV_HEADER_UNEXPECTED: ${lines[0]}`);
  }

  const out: YahooRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const date = parts[idx.date]?.trim();
    if (!date || date === 'null') continue;

    try {
      const open = Number(parts[idx.open]);
      const high = Number(parts[idx.high]);
      const low = Number(parts[idx.low]);
      const close = Number(parts[idx.close]);
      const volume = idx.volume >= 0 ? Number(parts[idx.volume]) : null;

      // Skip invalid rows
      if (!Number.isFinite(open) || !Number.isFinite(high) || 
          !Number.isFinite(low) || !Number.isFinite(close)) {
        continue;
      }
      if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
      if (low > high || open < low || open > high || close < low || close > high) continue;

      out.push({
        date,
        open,
        high,
        low,
        close,
        volume: volume && Number.isFinite(volume) ? volume : null,
      });
    } catch {
      // Skip bad rows
    }
  }

  // Sort chronologically (ascending)
  out.sort((a, b) => a.date.localeCompare(b.date));

  return out;
}

/**
 * Convert Yahoo rows to canonical format (same as Stooq)
 */
export function yahooToStooqFormat(rows: YahooRow[]): YahooRow[] {
  return rows; // Already in same format
}
