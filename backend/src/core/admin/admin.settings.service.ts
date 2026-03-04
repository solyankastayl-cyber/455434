/**
 * Admin Settings Service
 * 
 * Unified settings management for admin panel.
 * Categories: system, networks, ml, market
 */

import mongoose from 'mongoose';

// ============================================
// TYPES
// ============================================

export type SettingsCategory = 'system' | 'networks' | 'ml' | 'market';

export interface SystemSettings {
  decisionMode: 'RULES_ONLY' | 'ADVISORY' | 'INFLUENCE';
  killSwitch: boolean;
  mlInfluence: number; // 0-100
  driftThreshold: number;
  featureFlags: Record<string, boolean>;
}

export interface NetworkSettings {
  [network: string]: {
    enabled: boolean;
    priority: number;
    lastSync: string | null;
  };
}

export interface MLSettings {
  enabled: boolean;
  fallbackMode: 'RULES' | 'CACHED' | 'DISABLE';
  marketModel: {
    enabled: boolean;
    version: string;
    confidenceThreshold: number;
  };
  actorModel: {
    enabled: boolean;
    version: string;
  };
  ensembleWeights: {
    exchange: number;
    zones: number;
    ml: number;
  };
}

export interface MarketSettings {
  providers: Array<{
    id: string;
    type: string;
    enabled: boolean;
    priority: number;
    apiKey?: string;
    rateLimit: number;
  }>;
  defaultProvider: string;
  cacheL1Ttl: number;
  cacheL2Ttl: number;
}

export interface SettingsDocument {
  category: SettingsCategory;
  payload: SystemSettings | NetworkSettings | MLSettings | MarketSettings;
  version: number;
  updatedBy: string;
  updatedAt: Date;
}

// ============================================
// SCHEMA
// ============================================

const AdminSettingsSchema = new mongoose.Schema({
  category: { type: String, required: true, unique: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  version: { type: Number, default: 1 },
  updatedBy: { type: String },
  updatedAt: { type: Date, default: Date.now },
}, { 
  collection: 'admin_settings',
  timestamps: false,
});

const AdminSettingsModel = mongoose.models.AdminSettings || 
  mongoose.model('AdminSettings', AdminSettingsSchema);

// ============================================
// DEFAULT VALUES
// ============================================

const DEFAULT_SETTINGS: Record<SettingsCategory, any> = {
  system: {
    decisionMode: 'RULES_ONLY',
    killSwitch: false,
    mlInfluence: 20,
    driftThreshold: 0.15,
    featureFlags: {
      enableLiveIngestion: true,
      enableBacktesting: true,
      enableSignalEnsemble: true,
    },
  },
  networks: {
    ethereum: { enabled: true, priority: 1, lastSync: null },
    arbitrum: { enabled: true, priority: 2, lastSync: null },
    optimism: { enabled: true, priority: 3, lastSync: null },
    base: { enabled: true, priority: 4, lastSync: null },
    polygon: { enabled: true, priority: 5, lastSync: null },
    bnb: { enabled: true, priority: 6, lastSync: null },
    zksync: { enabled: true, priority: 7, lastSync: null },
    scroll: { enabled: true, priority: 8, lastSync: null },
  },
  ml: {
    enabled: true,
    fallbackMode: 'RULES',
    marketModel: {
      enabled: true,
      version: 'market_pipeline_v1',
      confidenceThreshold: 0.62,
    },
    actorModel: {
      enabled: true,
      version: 'actor_pipeline_v1',
    },
    ensembleWeights: {
      exchange: 0.45,
      zones: 0.35,
      ml: 0.20,
    },
  },
  market: {
    providers: [
      { id: 'coingecko_free_1', type: 'coingecko', enabled: true, priority: 1, rateLimit: 10 },
      { id: 'binance_public_1', type: 'binance', enabled: true, priority: 2, rateLimit: 60 },
    ],
    defaultProvider: 'coingecko_free_1',
    cacheL1Ttl: 30,
    cacheL2Ttl: 120,
  },
};

// ============================================
// SERVICE FUNCTIONS
// ============================================

export async function getSettings(category: SettingsCategory): Promise<SettingsDocument | null> {
  const doc = await AdminSettingsModel.findOne({ category }).lean();
  
  if (!doc) {
    // Return default settings
    return {
      category,
      payload: DEFAULT_SETTINGS[category],
      version: 0,
      updatedBy: 'system',
      updatedAt: new Date(),
    };
  }
  
  return doc as SettingsDocument;
}

export async function getAllSettings(): Promise<Record<SettingsCategory, SettingsDocument>> {
  const categories: SettingsCategory[] = ['system', 'networks', 'ml', 'market'];
  const result: Record<string, SettingsDocument> = {};
  
  for (const cat of categories) {
    result[cat] = await getSettings(cat) as SettingsDocument;
  }
  
  return result as Record<SettingsCategory, SettingsDocument>;
}

export async function updateSettings(
  category: SettingsCategory,
  payload: Partial<any>,
  adminId: string,
  adminUsername: string
): Promise<SettingsDocument> {
  const existing = await AdminSettingsModel.findOne({ category });
  
  const merged = existing 
    ? { ...existing.payload, ...payload }
    : { ...DEFAULT_SETTINGS[category], ...payload };
  
  const version = existing ? existing.version + 1 : 1;
  
  const result = await AdminSettingsModel.findOneAndUpdate(
    { category },
    {
      $set: {
        payload: merged,
        version,
        updatedBy: adminUsername,
        updatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
  
  return result as unknown as SettingsDocument;
}

export async function resetSettings(
  category: SettingsCategory,
  adminId: string,
  adminUsername: string
): Promise<SettingsDocument> {
  const result = await AdminSettingsModel.findOneAndUpdate(
    { category },
    {
      $set: {
        payload: DEFAULT_SETTINGS[category],
        version: 1,
        updatedBy: adminUsername,
        updatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
  
  return result as unknown as SettingsDocument;
}

export default {
  getSettings,
  getAllSettings,
  updateSettings,
  resetSettings,
  DEFAULT_SETTINGS,
};
