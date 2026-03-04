/**
 * X1 — Provider Registry
 * =======================
 * 
 * Central registry for all exchange providers.
 * Manages enabled/disabled state, priority, and health.
 */

import {
  IExchangeProvider,
  ProviderId,
  ProviderConfig,
  ProviderEntry,
  ProviderHealth,
} from './exchangeProvider.types.js';

import { createInitialHealth, resetHealth } from './provider.health.js';

// ═══════════════════════════════════════════════════════════════
// REGISTRY STATE
// ═══════════════════════════════════════════════════════════════

const registry = new Map<ProviderId, ProviderEntry>();

// ═══════════════════════════════════════════════════════════════
// REGISTRY OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Register a new provider
 */
export function registerProvider(
  provider: IExchangeProvider,
  config: ProviderConfig
): void {
  registry.set(provider.id, {
    provider,
    config,
    health: createInitialHealth(provider.id),
  });
  
  console.log(`[Registry] Registered provider: ${provider.id} (priority: ${config.priority}, enabled: ${config.enabled})`);
}

/**
 * Get provider entry by ID
 */
export function getProvider(id: ProviderId): ProviderEntry | undefined {
  return registry.get(id);
}

/**
 * List all registered providers
 */
export function listProviders(): ProviderEntry[] {
  return Array.from(registry.values());
}

/**
 * Get enabled providers sorted by priority (highest first)
 */
export function getEnabledProviders(): ProviderEntry[] {
  return listProviders()
    .filter(e => e.config.enabled)
    .filter(e => e.health.status !== 'DOWN')
    .sort((a, b) => b.config.priority - a.config.priority);
}

/**
 * Update provider configuration
 */
export function updateProviderConfig(
  id: ProviderId,
  patch: Partial<ProviderConfig>
): boolean {
  const entry = registry.get(id);
  if (!entry) return false;
  
  entry.config = { ...entry.config, ...patch };
  console.log(`[Registry] Updated config for ${id}:`, patch);
  return true;
}

/**
 * Update provider health
 */
export function updateProviderHealth(
  id: ProviderId,
  health: ProviderHealth
): void {
  const entry = registry.get(id);
  if (entry) {
    entry.health = health;
  }
}

/**
 * Reset provider circuit breaker
 */
export function resetProviderHealth(id: ProviderId): boolean {
  const entry = registry.get(id);
  if (!entry) return false;
  
  entry.health = resetHealth(entry.health);
  console.log(`[Registry] Reset health for ${id}`);
  return true;
}

/**
 * Get highest priority provider for a symbol
 */
export async function getHighestPriorityProvider(
  symbol: string
): Promise<IExchangeProvider | null> {
  const candidates = getEnabledProviders();
  
  for (const entry of candidates) {
    try {
      const symbols = await entry.provider.getSymbols();
      if (symbols.some(s => s.symbol === symbol || s.symbol === symbol.toUpperCase())) {
        return entry.provider;
      }
    } catch {
      // Provider failed, try next
      continue;
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY STATS
// ═══════════════════════════════════════════════════════════════

export function getRegistryStats() {
  const all = listProviders();
  const enabled = all.filter(e => e.config.enabled);
  const up = all.filter(e => e.health.status === 'UP');
  const degraded = all.filter(e => e.health.status === 'DEGRADED');
  const down = all.filter(e => e.health.status === 'DOWN');
  
  return {
    total: all.length,
    enabled: enabled.length,
    up: up.length,
    degraded: degraded.length,
    down: down.length,
  };
}

console.log('[X1] Provider Registry loaded');
