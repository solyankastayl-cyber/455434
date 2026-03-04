/**
 * PHASE 2.1 — System Status Service
 * ==================================
 * Aggregates status from all system components
 */

import { SystemStatusDto, DataMode, ProviderStatusDto, WsStatusDto, AlertDto } from '../contracts/observability.types.js';
import { listProviders } from '../../exchange/providers/provider.registry.js';
import { wsManager } from '../../exchange/ws/ws.manager.js';
import { getNetworkConfig } from '../../network/network.config.service.js';

class SystemStatusService {
  
  private computeDataMode(providers: ProviderStatusDto[]): DataMode {
    const enabledProviders = providers.filter(p => p.enabled);
    
    if (enabledProviders.length === 0) return 'MOCK';
    
    const upProviders = enabledProviders.filter(p => p.health === 'UP');
    const mockOnly = enabledProviders.every(p => p.id === 'MOCK');
    
    if (mockOnly || upProviders.length === 0) return 'MOCK';
    if (upProviders.length === enabledProviders.length) return 'LIVE';
    return 'MIXED';
  }
  
  async getStatus(): Promise<SystemStatusDto> {
    const ts = new Date().toISOString();
    const alerts: AlertDto[] = [];
    
    // Get providers
    const providerEntries = listProviders();
    const providers: ProviderStatusDto[] = providerEntries.map((entry: any) => {
      const provider = entry.provider;
      const config = entry.config;
      const health = entry.health;
      
      const status: ProviderStatusDto = {
        id: provider?.id || config?.id || 'UNKNOWN',
        enabled: config?.enabled ?? false,
        priority: config?.priority ?? 0,
        health: health?.status ?? 'DOWN',
        latencyMs: health?.latencyMs,
        lastOkAt: health?.lastOkAt ? new Date(health.lastOkAt).toISOString() : undefined,
        lastError: health?.notes?.[0],
      };
      
      // Generate alerts
      if (status.enabled && status.health !== 'UP') {
        alerts.push({
          severity: status.health === 'DOWN' ? 'CRITICAL' : 'WARN',
          code: `PROVIDER_${status.id}_${status.health}`,
          message: `${status.id} is ${status.health}${status.lastError ? `: ${status.lastError}` : ''}`,
        });
      }
      
      return status;
    });
    
    // Get proxy status
    let proxy: any = { mode: 'direct' };
    try {
      const config = await getNetworkConfig();
      if (config?.proxy?.enabled) {
        proxy = {
          mode: 'proxy',
          type: config.proxy.type || 'HTTP',
          host: config.proxy.host,
          port: config.proxy.port,
          authEnabled: !!(config.proxy.username),
        };
      }
    } catch (err) {
      // Ignore
    }
    
    // Get WS status
    const wsStatuses = wsManager.statusAll();
    const ws: WsStatusDto[] = wsStatuses.map((s: any) => ({
      providerId: s.provider,
      running: s.state === 'RUNNING',
      state: s.state,
      lastHeartbeatAt: s.lastHeartbeatAt,
      reconnects: s.reconnects,
      lastError: s.lastError,
    }));
    
    // WS alerts
    for (const w of ws) {
      if (w.state === 'DOWN') {
        alerts.push({
          severity: 'CRITICAL',
          code: `WS_${w.providerId}_DOWN`,
          message: `WebSocket ${w.providerId} is DOWN`,
        });
      } else if (w.state === 'DEGRADED') {
        alerts.push({
          severity: 'WARN',
          code: `WS_${w.providerId}_DEGRADED`,
          message: `WebSocket ${w.providerId} is DEGRADED`,
        });
      }
    }
    
    const dataMode = this.computeDataMode(providers);
    
    return {
      ts,
      dataMode,
      providers,
      proxy,
      ws,
      alerts,
    };
  }
}

export const systemStatusService = new SystemStatusService();

console.log('[Phase 2.1] System Status Service loaded');
