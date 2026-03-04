// B3.1 / B3.3 - Runtime Factory
// Creates appropriate runtime based on slot configuration
// Bridges B1 (Control Plane) with B3 (Runtime Layer)

import { TwitterRuntime } from './runtime.interface.js';
import { MockTwitterRuntime } from './adapters/mock.runtime.js';
import { ProxyTwitterRuntime } from './adapters/proxy.runtime.js';
import { RemoteTwitterRuntime } from './remote/remote.runtime.js';
import { LocalParserRuntime } from './adapters/local-parser.runtime.js';

export type SlotType = 'MOCK' | 'PROXY' | 'REMOTE_WORKER' | 'LOCAL_PARSER';

export interface SlotConfig {
  id: string;
  type: SlotType;
  accountId?: string;
  // PROXY config
  proxy?: {
    url?: string;
    region?: string;
    provider?: string;
  };
  // REMOTE_WORKER config
  worker?: {
    baseUrl: string;
    region?: string;
  };
  // LOCAL_PARSER config
  localParser?: {
    url: string;
  };
  // Alternative field names
  baseUrl?: string;
  proxyUrl?: string;
}

/**
 * Create a TwitterRuntime based on slot configuration
 * 
 * @param slot - Slot configuration from B1 (Control Plane)
 * @returns Appropriate runtime implementation
 */
export function createTwitterRuntime(slot?: SlotConfig | null): TwitterRuntime {
  // No slot or invalid slot → Mock
  if (!slot || !slot.type) {
    return new MockTwitterRuntime();
  }

  const slotId = slot.id || 'unknown';
  const accountId = slot.accountId || 'unknown';

  switch (slot.type) {
    case 'LOCAL_PARSER': {
      // MULTI Architecture - preferred runtime
      // Default to USER scope to use user_twitter_sessions
      const parserUrl = slot.localParser?.url || 'http://localhost:5001';
      console.log(`[RuntimeFactory] Creating LocalParserRuntime: ${parserUrl} (scope=USER)`);
      return new LocalParserRuntime({ parserUrl, scope: 'USER' });
    }

    case 'REMOTE_WORKER': {
      const baseUrl = slot.worker?.baseUrl || slot.baseUrl;
      if (!baseUrl) {
        console.warn(`[RuntimeFactory] REMOTE_WORKER slot ${slotId} missing baseUrl, using Mock`);
        return new MockTwitterRuntime();
      }
      return new RemoteTwitterRuntime(baseUrl, slotId, accountId);
    }

    case 'PROXY': {
      const proxyConfig = slot.proxy || { url: slot.proxyUrl };
      return new ProxyTwitterRuntime(proxyConfig, slotId, accountId);
    }

    case 'MOCK':
    default:
      return new MockTwitterRuntime();
  }
}

/**
 * Get runtime type label for display
 */
export function getRuntimeTypeLabel(type?: SlotType): string {
  switch (type) {
    case 'LOCAL_PARSER':
      return 'Local Parser';
    case 'REMOTE_WORKER':
      return 'Railway';
    case 'PROXY':
      return 'Proxy';
    case 'MOCK':
    default:
      return 'Mock';
  }
}

/**
 * Check if slot is configured for real parsing (not mock)
 */
export function isRealRuntime(slot?: SlotConfig | null): boolean {
  if (!slot) return false;
  
  if (slot.type === 'LOCAL_PARSER') {
    return true; // LocalParser uses sessions/slots from DB
  }
  
  if (slot.type === 'REMOTE_WORKER') {
    return !!(slot.worker?.baseUrl || slot.baseUrl);
  }
  
  if (slot.type === 'PROXY') {
    return !!(slot.proxy?.url || slot.proxyUrl);
  }
  
  return false;
}
