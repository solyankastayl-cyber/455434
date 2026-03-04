/**
 * PHASE 1 — Network Config Model
 * ================================
 * 
 * MongoDB model for runtime network configuration.
 * 
 * Collection: system_network_config
 */

import mongoose from 'mongoose';

const ProxyConfigSchema = new mongoose.Schema({
  url: { type: String, default: '' },
  timeoutMs: { type: Number, default: 8000 },
  enabled: { type: Boolean, default: false },
}, { _id: false });

const ProxyPoolItemSchema = new mongoose.Schema({
  id: { type: String, required: true },
  url: { type: String, required: true },
  weight: { type: Number, default: 1 },
  enabled: { type: Boolean, default: true },
  lastError: { type: String },
  errorCount: { type: Number, default: 0 },
  lastUsed: { type: Number },
}, { _id: false });

const RetryConfigSchema = new mongoose.Schema({
  attempts: { type: Number, default: 3 },
  backoffMs: { type: Number, default: 500 },
  maxBackoffMs: { type: Number, default: 5000 },
}, { _id: false });

const NetworkConfigSchema = new mongoose.Schema({
  _id: { type: String, default: 'default' },
  egressMode: { 
    type: String, 
    enum: ['direct', 'proxy', 'proxy_pool'],
    default: 'direct' 
  },
  
  proxy: { type: ProxyConfigSchema, default: () => ({}) },
  proxyPool: { type: [ProxyPoolItemSchema], default: [] },
  
  retry: { type: RetryConfigSchema, default: () => ({}) },
  
  binanceTimeoutMs: { type: Number, default: 8000 },
  bybitTimeoutMs: { type: Number, default: 8000 },
  defaultTimeoutMs: { type: Number, default: 10000 },
  
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String },
}, {
  collection: 'system_network_config',
});

export const NetworkConfigModel = mongoose.model('NetworkConfig', NetworkConfigSchema);

console.log('[Phase 1] Network Config Model loaded');
