/**
 * Dataset Market V3 Model
 * Contains Pack A features (always) + DEX features (optional)
 */
import mongoose, { Schema } from 'mongoose';

export interface IDatasetMarketV3 {
  network: string;
  bucketTs: number;
  timestamp: Date;
  
  // ===== Pack A: CEX Pressure v3 (ALWAYS) =====
  cex_pressure_5m: number;
  cex_pressure_1h: number;
  cex_pressure_1d: number;
  cex_in_delta: number;
  cex_out_delta: number;
  cex_spike_level: number;      // 0=NONE, 1=MEDIUM, 2=HIGH
  cex_spike_direction: number;  // -1=SELL, 0=NONE, 1=BUY
  
  // ===== Pack A: Zones v3 (ALWAYS) =====
  zone_persistence_7d: number;
  zone_persistence_30d: number;
  zone_decay_score: number;
  zone_quality_score: number;
  
  // ===== Pack A: Corridors v3 (ALWAYS) =====
  corridor_persistence_7d: number;
  corridor_persistence_30d: number;
  corridor_repeat_rate: number;
  corridor_entropy: number;
  corridor_concentration: number;
  corridor_net_flow_trend: number;
  corridor_quality_score: number;
  
  // ===== DEX Features (OPTIONAL) =====
  dex_liquidity_net_1h?: number;
  dex_liquidity_net_24h?: number;
  dex_lp_spike_level?: number;      // 0=NONE, 1=MEDIUM, 2=HIGH
  dex_lp_spike_direction?: number;  // -1=REMOVE, 0=NONE, 1=ADD
  dex_depth_index?: number;
  dex_thin_liquidity_share?: number;
  dex_price_confidence_avg?: number;
  dex_universe_coverage?: number;
  
  // Meta
  datasetId: string;
  version: string;
}

const DatasetMarketV3Schema = new Schema<IDatasetMarketV3>({
  network: { type: String, required: true, index: true },
  bucketTs: { type: Number, required: true, index: true },
  timestamp: { type: Date, required: true, index: true },
  
  // Pack A: CEX
  cex_pressure_5m: { type: Number },
  cex_pressure_1h: { type: Number },
  cex_pressure_1d: { type: Number },
  cex_in_delta: { type: Number },
  cex_out_delta: { type: Number },
  cex_spike_level: { type: Number },
  cex_spike_direction: { type: Number },
  
  // Pack A: Zones
  zone_persistence_7d: { type: Number },
  zone_persistence_30d: { type: Number },
  zone_decay_score: { type: Number },
  zone_quality_score: { type: Number },
  
  // Pack A: Corridors
  corridor_persistence_7d: { type: Number },
  corridor_persistence_30d: { type: Number },
  corridor_repeat_rate: { type: Number },
  corridor_entropy: { type: Number },
  corridor_concentration: { type: Number },
  corridor_net_flow_trend: { type: Number },
  corridor_quality_score: { type: Number },
  
  // DEX (optional)
  dex_liquidity_net_1h: { type: Number },
  dex_liquidity_net_24h: { type: Number },
  dex_lp_spike_level: { type: Number },
  dex_lp_spike_direction: { type: Number },
  dex_depth_index: { type: Number },
  dex_thin_liquidity_share: { type: Number },
  dex_price_confidence_avg: { type: Number },
  dex_universe_coverage: { type: Number },
  
  // Meta
  datasetId: { type: String, required: true, index: true },
  version: { type: String, default: 'v3.0-b4' },
}, { timestamps: true, collection: 'dataset_market_v3' });

DatasetMarketV3Schema.index({ network: 1, bucketTs: -1 });
DatasetMarketV3Schema.index({ datasetId: 1, bucketTs: -1 });

export const DatasetMarketV3 = mongoose.models.DatasetMarketV3 || 
  mongoose.model('DatasetMarketV3', DatasetMarketV3Schema);
