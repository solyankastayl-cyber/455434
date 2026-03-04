// B3 - Slot Health Service
// Checks and updates health status of egress slots

import axios from 'axios';
import { ParserInstance, EgressSlotHealthStatus } from '../types.js';

const HEALTH_TIMEOUT = 5000; // 5 seconds

export interface HealthCheckResult {
  status: EgressSlotHealthStatus;
  responseTime?: number;
  error?: string;
  parserStatus?: string;
}

export class SlotHealthService {
  /**
   * Check health of a single slot
   */
  async checkHealth(slot: ParserInstance): Promise<HealthCheckResult> {
    if (!slot.enabled) {
      return { status: 'UNKNOWN', error: 'Slot disabled' };
    }

    if (slot.kind === 'REMOTE_WORKER') {
      return this.checkRemoteWorkerHealth(slot);
    } else if (slot.kind === 'PROXY') {
      return this.checkProxyHealth(slot);
    } else if (slot.kind === 'LOCAL_PARSER') {
      return this.checkLocalParserHealth(slot);
    }

    return { status: 'UNKNOWN', error: 'Unknown slot kind' };
  }

  /**
   * Check health of LOCAL_PARSER slot
   */
  private async checkLocalParserHealth(slot: ParserInstance): Promise<HealthCheckResult> {
    const parserUrl = slot.baseUrl || process.env.TWITTER_PARSER_URL || 'http://localhost:5001';
    const startTime = Date.now();

    try {
      const response = await axios.get(`${parserUrl}/health`, {
        timeout: HEALTH_TIMEOUT,
        validateStatus: () => true,
      });

      const responseTime = Date.now() - startTime;

      if (response.status === 200) {
        return {
          status: 'HEALTHY',
          responseTime,
          parserStatus: response.data?.status || response.data?.state || 'OK',
        };
      }

      return {
        status: 'DEGRADED',
        responseTime,
        error: `HTTP ${response.status}`,
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        status: 'ERROR',
        responseTime,
        error: error.message || 'Local parser not available',
      };
    }
  }

  /**
   * Check health of REMOTE_WORKER (Railway)
   */
  private async checkRemoteWorkerHealth(slot: ParserInstance): Promise<HealthCheckResult> {
    if (!slot.baseUrl) {
      return { status: 'ERROR', error: 'No baseUrl configured' };
    }

    const startTime = Date.now();

    try {
      const response = await axios.get(`${slot.baseUrl}/health`, {
        timeout: HEALTH_TIMEOUT,
        validateStatus: () => true, // Accept any status
      });

      const responseTime = Date.now() - startTime;

      if (response.status === 200) {
        const data = response.data;
        return {
          status: 'HEALTHY',
          responseTime,
          parserStatus: data?.status || data?.state || 'OK',
        };
      }

      if (response.status === 503 || response.status === 502) {
        return {
          status: 'DEGRADED',
          responseTime,
          error: `HTTP ${response.status}`,
        };
      }

      return {
        status: 'ERROR',
        responseTime,
        error: `HTTP ${response.status}`,
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      if (error.code === 'ECONNREFUSED') {
        return { status: 'ERROR', responseTime, error: 'Connection refused' };
      }
      if (error.code === 'ENOTFOUND') {
        return { status: 'ERROR', responseTime, error: 'Host not found' };
      }
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        return { status: 'DEGRADED', responseTime, error: 'Timeout' };
      }

      return {
        status: 'ERROR',
        responseTime,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Check health of PROXY slot
   * For proxy, we check if the local parser is running
   */
  private async checkProxyHealth(slot: ParserInstance): Promise<HealthCheckResult> {
    const localParserUrl = process.env.TWITTER_PARSER_URL || 'http://localhost:5001';
    const startTime = Date.now();

    try {
      const response = await axios.get(`${localParserUrl}/health`, {
        timeout: HEALTH_TIMEOUT,
        validateStatus: () => true,
      });

      const responseTime = Date.now() - startTime;

      if (response.status === 200) {
        return {
          status: 'HEALTHY',
          responseTime,
          parserStatus: response.data?.status || response.data?.state || 'OK',
        };
      }

      return {
        status: 'DEGRADED',
        responseTime,
        error: `HTTP ${response.status}`,
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        status: 'ERROR',
        responseTime,
        error: 'Local parser not available',
      };
    }
  }

  /**
   * Update slot with health check result
   */
  updateSlotHealth(slot: ParserInstance, result: HealthCheckResult): void {
    slot.health = result.status;

    // Note: We don't directly modify the slot object's properties here
    // This is handled by the execution adapter which persists to MongoDB
  }

  /**
   * Check health of all slots
   */
  async checkAllSlots(slots: ParserInstance[]): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();

    await Promise.all(
      slots.map(async (slot) => {
        const result = await this.checkHealth(slot);
        results.set(slot.id, result);
      })
    );

    return results;
  }
}

// Singleton export
export const slotHealthService = new SlotHealthService();
