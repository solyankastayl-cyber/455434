/**
 * Entities Model - Real Implementation
 * 
 * Entity = агрегированный Actor (Exchange / Fund / MM / Protocol Treasury)
 * 
 * Философия:
 * - ❌ НЕ intent, НЕ quality score
 * - ✅ Coverage = data completeness
 * - ✅ Category = observed structure classification
 */
import mongoose, { Schema, Document } from 'mongoose';

// Entity Category (классификация на основе поведения)
export type EntityCategory = 
  | 'exchange'      // Биржа
  | 'fund'          // Фонд / VC
  | 'market_maker'  // Маркетмейкер
  | 'crowdsale'     // ICO / Token sale
  | 'bridge'        // Bridge protocol
  | 'protocol'      // Protocol treasury
  | 'custody'       // Custody service
  | 'unknown';      // Не классифицировано

// Entity Status
export type EntityStatus = 'live' | 'delayed' | 'inactive';

export interface IEntity extends Document {
  // Identity
  name: string;              // "Binance", "Coinbase", etc.
  slug: string;              // "binance", "coinbase" (unique)
  logo?: string;             // Logo URL
  description?: string;      // Brief description
  
  // Classification
  category: EntityCategory;
  tags: string[];            // ['cex', 'top10', 'kyc', etc.]
  
  // Addresses
  addressesCount: number;    // Количество адресов в entity
  primaryAddresses: string[]; // Main addresses (hot wallets, deposit contracts)
  
  // Data Quality
  coverage: number;          // 0-100, Data Coverage % (completeness, not quality)
  status: EntityStatus;      // live / delayed / inactive
  
  // Quick Metrics (cached, updated periodically)
  netFlow24h?: number;       // Net flow USD (24h)
  volume24h?: number;        // Total volume USD (24h)
  topTokens?: string[];      // Top 3 tokens by holdings
  totalHoldingsUSD?: number; // Total holdings in USD
  
  // Metadata
  source: 'seed' | 'inferred' | 'manual'; // Откуда entity
  attribution?: {            // Доказательства принадлежности
    method: string;          // 'seed_dataset' | 'cluster_inference' | 'osint'
    confidence: number;      // Internal confidence (0-100), not shown as quality
    evidence?: string[];     // Evidence list
  };
  
  // Timestamps
  firstSeen: Date;
  lastSeen: Date;
  updatedAt: Date;
  createdAt: Date;
}

const EntitySchema = new Schema<IEntity>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    logo: { type: String },
    description: { type: String },
    
    category: { 
      type: String, 
      enum: ['exchange', 'fund', 'market_maker', 'crowdsale', 'bridge', 'protocol', 'custody', 'unknown'],
      default: 'unknown',
      index: true
    },
    tags: [{ type: String }],
    
    addressesCount: { type: Number, default: 0, index: true },
    primaryAddresses: [{ type: String }],
    
    coverage: { type: Number, default: 0, min: 0, max: 100 },
    status: { 
      type: String, 
      enum: ['live', 'delayed', 'inactive'],
      default: 'live',
      index: true
    },
    
    netFlow24h: { type: Number },
    volume24h: { type: Number },
    topTokens: [{ type: String }],
    totalHoldingsUSD: { type: Number },
    
    source: { 
      type: String, 
      enum: ['seed', 'inferred', 'manual'],
      default: 'seed'
    },
    attribution: {
      method: String,
      confidence: Number,
      evidence: [String]
    },
    
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
  },
  { 
    timestamps: true,
    collection: 'entities'
  }
);

// Indexes for performance
EntitySchema.index({ category: 1, coverage: -1 });
EntitySchema.index({ slug: 1 });
EntitySchema.index({ status: 1, updatedAt: -1 });

export const EntityModel = mongoose.model<IEntity>('Entity', EntitySchema);
