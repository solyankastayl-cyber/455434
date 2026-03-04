/**
 * GOLD SERIES ADAPTER — Exogenous signal for V2 (Institutional)
 * 
 * Gold = macro signal (NOT a fractal):
 * - Flight-to-quality detection
 * - Contributes to DXY scoreSigned via calibrated weight
 * - Helps detect STRESS and RISK_OFF regimes
 * 
 * Data source: Stooq XAUUSD daily (real gold prices, ~5200 points since 2006)
 */

import * as fs from 'fs';
import { MacroRole } from '../interfaces/macro_engine.interface.js';

export const GOLD_SERIES_CONFIG = {
  seriesId: 'GOLD',
  source: 'STOOQ',
  displayName: 'Gold (XAUUSD)',
  role: 'gold' as MacroRole,
  csvPath: '/app/data/gold_stooq.csv',
  optimalLag: 90,
  expectedCorr: -0.08,
  weight: 0.10,
  stalenessThresholdDays: 5,
  thresholds: {
    flightToQuality: 0.5,
    stressSignal: 1.0,
  },
};

export interface GoldFeatures {
  priceNow: number;
  z120: number;
  ret10: number;
  ret30: number;
  ret90: number;
  flightToQuality: boolean;
  stressContribution: number;
  pressure: number;
  contribution: number;
  staleDays: number;
}

export class GoldSeriesAdapter {
  private prices: Array<{ date: string; price: number }> = [];
  private features: GoldFeatures | null = null;
  private lastUpdate: number = 0;
  private readonly CACHE_TTL = 3600000; // 1h

  async load(): Promise<boolean> {
    // Try CSV first (fastest, most reliable)
    if (this.loadFromCsv()) return true;
    // Fallback: FRED PPI proxy
    return await this.loadFromFredApi();
  }

  private loadFromCsv(): boolean {
    try {
      const csvPath = GOLD_SERIES_CONFIG.csvPath;
      if (!fs.existsSync(csvPath)) return false;

      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.trim().split('\n');

      this.prices = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length >= 5) {
          const date = parts[0].trim();
          const close = parseFloat(parts[4]);
          if (!isNaN(close) && close > 0 && date) {
            this.prices.push({ date, price: close });
          }
        }
      }

      this.lastUpdate = Date.now();
      console.log(`[GoldAdapter] Loaded ${this.prices.length} XAUUSD daily prices from stooq CSV`);
      return this.prices.length > 120;
    } catch (e) {
      console.log('[GoldAdapter] CSV load error:', (e as any).message);
      return false;
    }
  }

  private async loadFromFredApi(): Promise<boolean> {
    const apiKey = process.env.FRED_API_KEY || process.env.MACRO_API_KEY;
    if (!apiKey) return false;

    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=PCU21222122&api_key=${apiKey}&file_type=json&sort_order=asc`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.observations) {
        this.prices = data.observations
          .filter((o: any) => o.value !== '.')
          .map((o: any) => ({ date: o.date, price: parseFloat(o.value) }));
        this.lastUpdate = Date.now();
        console.log(`[GoldAdapter] Loaded ${this.prices.length} gold proxy prices from FRED`);
        return this.prices.length > 120;
      }
      return false;
    } catch (e) {
      console.log('[GoldAdapter] FRED API error:', (e as any).message);
      return false;
    }
  }

  computeFeatures(): GoldFeatures | null {
    if (this.prices.length < 120) return null;

    const prices = this.prices.map(p => p.price);
    const n = prices.length;
    const priceNow = prices[n - 1];

    // Returns
    const ret10 = n > 11 ? (prices[n - 1] - prices[n - 11]) / prices[n - 11] : 0;
    const ret30 = n > 31 ? (prices[n - 1] - prices[n - 31]) / prices[n - 31] : 0;
    const ret90 = n > 91 ? (prices[n - 1] - prices[n - 91]) / prices[n - 91] : 0;

    // 120-day z-score
    const slice120 = prices.slice(-120);
    const mean120 = slice120.reduce((a, b) => a + b, 0) / 120;
    const std120 = Math.sqrt(slice120.reduce((a, b) => a + (b - mean120) ** 2, 0) / 120);
    const z120 = std120 > 0 ? (priceNow - mean120) / std120 : 0;

    // Staleness
    const lastDate = this.prices[n - 1].date;
    const staleDays = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);

    // Signals
    const flightToQuality = z120 > GOLD_SERIES_CONFIG.thresholds.flightToQuality && ret30 > 0;
    const stressContribution = Math.max(0, z120 / 2);
    const pressure = -1 * z120 * 0.3;
    const contribution = pressure * GOLD_SERIES_CONFIG.weight;

    this.features = {
      priceNow: Math.round(priceNow * 100) / 100,
      z120: Math.round(z120 * 1000) / 1000,
      ret10: Math.round(ret10 * 10000) / 10000,
      ret30: Math.round(ret30 * 10000) / 10000,
      ret90: Math.round(ret90 * 10000) / 10000,
      flightToQuality,
      stressContribution: Math.round(stressContribution * 1000) / 1000,
      pressure: Math.round(pressure * 1000) / 1000,
      contribution: Math.round(contribution * 10000) / 10000,
      staleDays,
    };
    return this.features;
  }

  async getFeatures(): Promise<GoldFeatures | null> {
    if (Date.now() - this.lastUpdate > this.CACHE_TTL || this.prices.length === 0) {
      await this.load();
    }
    return this.computeFeatures();
  }

  async getAsDriverComponent(): Promise<{
    key: string; displayName: string; role: 'gold';
    weight: number; lagDays: number; corr?: number;
    valueNow: number; contribution: number; tooltip: string;
  } | null> {
    const features = await this.getFeatures();
    if (!features) return null;

    return {
      key: GOLD_SERIES_CONFIG.seriesId,
      displayName: GOLD_SERIES_CONFIG.displayName,
      role: 'gold',
      weight: GOLD_SERIES_CONFIG.weight,
      lagDays: GOLD_SERIES_CONFIG.optimalLag,
      valueNow: features.z120,
      contribution: features.contribution,
      tooltip: features.flightToQuality
        ? `Gold $${features.priceNow}: Flight-to-quality (z=${features.z120.toFixed(2)})`
        : `Gold $${features.priceNow}: ${features.z120 > 0 ? 'Elevated' : 'Subdued'} (z=${features.z120.toFixed(2)})`,
    };
  }

  getDataInfo(): { points: number; from: string; to: string; staleDays?: number } | null {
    if (this.prices.length === 0) return null;
    const n = this.prices.length;
    const lastDate = this.prices[n - 1].date;
    const staleDays = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);

    return {
      points: n,
      from: this.prices[0].date,
      to: lastDate,
      staleDays,
    };
  }

  /** Raw prices for calibration */
  getPriceData(): Array<{ date: string; value: number }> {
    return this.prices.map(p => ({ date: p.date, value: p.price }));
  }
}

let goldAdapterInstance: GoldSeriesAdapter | null = null;

export function getGoldAdapter(): GoldSeriesAdapter {
  if (!goldAdapterInstance) {
    goldAdapterInstance = new GoldSeriesAdapter();
  }
  return goldAdapterInstance;
}
