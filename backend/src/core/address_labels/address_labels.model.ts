/**
 * Address Labels & Exchange Entities Model (P0.2.2)
 * 
 * Labels for known addresses: exchanges, bridges, protocols, funds, etc.
 * Enables identification of wallet types and counterparty classification.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type LabelCategory = 
  | 'CEX'           // Centralized Exchange (Binance, Coinbase, Kraken)
  | 'DEX'           // Decentralized Exchange (Uniswap, SushiSwap)
  | 'BRIDGE'        // Bridge protocols (Stargate, Hop, Across)
  | 'LENDING'       // Lending protocols (Aave, Compound)
  | 'FUND'          // Investment funds, VCs
  | 'WHALE'         // Known whale wallets
  | 'PROTOCOL'      // Other DeFi protocols
  | 'CONTRACT'      // Smart contracts
  | 'MIXER'         // Mixing services (Tornado)
  | 'SCAM'          // Known scam addresses
  | 'CUSTODIAN'     // Custodial services
  | 'OTHER';

export type LabelSource = 'manual' | 'etherscan' | 'arkham' | 'chainalysis' | 'heuristic';
export type LabelConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

// ============================================
// Address Label Document
// ============================================

export interface IAddressLabelDocument extends Document {
  labelId: string;          // LABEL:<chain>:<address>
  chain: string;            // ETH, ARB, BASE, etc
  address: string;          // lowercase
  
  // Classification
  name: string;             // "Binance 14" or "Uniswap V3 Router"
  category: LabelCategory;
  subcategory?: string;     // "Hot Wallet", "Router", etc
  
  // Entity linkage (if this address belongs to an exchange entity)
  exchangeEntityId?: string; // links to ExchangeEntity
  
  // Metadata
  confidence: LabelConfidence;
  sources: LabelSource[];
  tags: string[];           // additional tags: "deposit", "withdrawal", "router"
  
  // Verification
  verifiedAt?: Date;
  verifiedBy?: string;
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
}

const AddressLabelSchema = new Schema<IAddressLabelDocument>({
  labelId: { type: String, required: true, unique: true, index: true },
  chain: { type: String, required: true, index: true },
  address: { type: String, required: true },
  
  name: { type: String, required: true },
  category: { 
    type: String, 
    enum: ['CEX', 'DEX', 'BRIDGE', 'LENDING', 'FUND', 'WHALE', 'PROTOCOL', 'CONTRACT', 'MIXER', 'SCAM', 'CUSTODIAN', 'OTHER'],
    required: true,
    index: true
  },
  subcategory: { type: String },
  
  exchangeEntityId: { type: String, index: true },
  
  confidence: { 
    type: String,
    enum: ['HIGH', 'MEDIUM', 'LOW'],
    default: 'MEDIUM'
  },
  sources: [{ 
    type: String, 
    enum: ['manual', 'etherscan', 'arkham', 'chainalysis', 'heuristic']
  }],
  tags: [{ type: String }],
  
  verifiedAt: { type: Date },
  verifiedBy: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes
AddressLabelSchema.index({ chain: 1, address: 1 }, { unique: true });
AddressLabelSchema.index({ category: 1, chain: 1 });
AddressLabelSchema.index({ name: 'text' });
AddressLabelSchema.index({ tags: 1 });

export const AddressLabelModel = mongoose.model<IAddressLabelDocument>(
  'address_label',
  AddressLabelSchema
);

// ============================================
// Exchange Entity Document
// ============================================

export interface ExchangeWallet {
  chain: string;
  address: string;
  labelId: string;
  type: 'hot' | 'cold' | 'deposit' | 'withdrawal' | 'router' | 'unknown';
}

export interface IExchangeEntityDocument extends Document {
  entityId: string;           // ENTITY:binance, ENTITY:coinbase
  
  // Identity
  name: string;               // "Binance", "Coinbase"
  shortName: string;          // "BNB", "CB"
  type: 'CEX' | 'DEX' | 'BRIDGE' | 'PROTOCOL';
  
  // Classification
  tier: 1 | 2 | 3;            // 1=major, 2=mid, 3=small
  isRegulated: boolean;
  jurisdiction?: string;      // "US", "EU", "APAC"
  
  // Wallets across chains
  wallets: ExchangeWallet[];
  
  // Stats (computed)
  totalWallets: number;
  chainsPresent: string[];
  
  // Integration
  coingeckoExchangeId?: string;
  website?: string;
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
}

const ExchangeWalletSchema = new Schema({
  chain: { type: String, required: true },
  address: { type: String, required: true },
  labelId: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['hot', 'cold', 'deposit', 'withdrawal', 'router', 'unknown'],
    default: 'unknown'
  }
}, { _id: false });

const ExchangeEntitySchema = new Schema<IExchangeEntityDocument>({
  entityId: { type: String, required: true, unique: true, index: true },
  
  name: { type: String, required: true, index: true },
  shortName: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['CEX', 'DEX', 'BRIDGE', 'PROTOCOL'],
    required: true,
    index: true
  },
  
  tier: { type: Number, enum: [1, 2, 3], default: 2 },
  isRegulated: { type: Boolean, default: false },
  jurisdiction: { type: String },
  
  wallets: [ExchangeWalletSchema],
  
  totalWallets: { type: Number, default: 0 },
  chainsPresent: [{ type: String }],
  
  coingeckoExchangeId: { type: String },
  website: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

ExchangeEntitySchema.index({ name: 'text', shortName: 'text' });
ExchangeEntitySchema.index({ type: 1, tier: 1 });

export const ExchangeEntityModel = mongoose.model<IExchangeEntityDocument>(
  'exchange_entity',
  ExchangeEntitySchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate labelId from chain and address
 */
export function generateLabelId(chain: string, address: string): string {
  return `LABEL:${chain.toUpperCase()}:${address.toLowerCase()}`;
}

/**
 * Generate entityId from name
 */
export function generateEntityId(name: string): string {
  return `ENTITY:${name.toLowerCase().replace(/\s+/g, '_')}`;
}

/**
 * Get label by chain and address
 */
export async function getLabel(
  chain: string,
  address: string
): Promise<IAddressLabelDocument | null> {
  return AddressLabelModel.findOne({
    chain: chain.toUpperCase(),
    address: address.toLowerCase()
  }).lean();
}

/**
 * Search labels
 */
export async function searchLabels(options: {
  q?: string;
  chain?: string;
  category?: LabelCategory;
  limit?: number;
}): Promise<IAddressLabelDocument[]> {
  const query: any = {};
  
  if (options.chain) {
    query.chain = options.chain.toUpperCase();
  }
  
  if (options.category) {
    query.category = options.category;
  }
  
  if (options.q) {
    query.$or = [
      { name: new RegExp(options.q, 'i') },
      { address: new RegExp(options.q, 'i') },
      { tags: { $in: [new RegExp(options.q, 'i')] } }
    ];
  }
  
  return AddressLabelModel.find(query)
    .sort({ name: 1 })
    .limit(options.limit || 100)
    .lean();
}

/**
 * Get exchange entity by name or ID
 */
export async function getExchangeEntity(
  identifier: string
): Promise<IExchangeEntityDocument | null> {
  return ExchangeEntityModel.findOne({
    $or: [
      { entityId: identifier },
      { name: new RegExp(`^${identifier}$`, 'i') },
      { shortName: new RegExp(`^${identifier}$`, 'i') }
    ]
  }).lean();
}

/**
 * Search exchange entities
 */
export async function searchExchangeEntities(options: {
  q?: string;
  type?: string;
  tier?: number;
  limit?: number;
}): Promise<IExchangeEntityDocument[]> {
  const query: any = {};
  
  if (options.type) {
    query.type = options.type;
  }
  
  if (options.tier) {
    query.tier = options.tier;
  }
  
  if (options.q) {
    query.$or = [
      { name: new RegExp(options.q, 'i') },
      { shortName: new RegExp(options.q, 'i') }
    ];
  }
  
  return ExchangeEntityModel.find(query)
    .sort({ tier: 1, name: 1 })
    .limit(options.limit || 100)
    .lean();
}

/**
 * Check if address is known exchange
 */
export async function isExchangeAddress(
  chain: string,
  address: string
): Promise<{ isExchange: boolean; entity?: IExchangeEntityDocument; label?: IAddressLabelDocument }> {
  const label = await getLabel(chain, address);
  
  if (!label || !['CEX', 'DEX'].includes(label.category)) {
    return { isExchange: false };
  }
  
  let entity: IExchangeEntityDocument | null = null;
  if (label.exchangeEntityId) {
    entity = await ExchangeEntityModel.findOne({ entityId: label.exchangeEntityId }).lean();
  }
  
  return {
    isExchange: true,
    entity: entity || undefined,
    label
  };
}
