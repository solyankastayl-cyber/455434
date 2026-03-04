// B3 - Remote Dispatcher with Endpoint Mapping
// Dispatches tasks to Railway/Remote workers with configurable endpoint mapping

import axios, { AxiosError } from 'axios';
import { ParserInstance, ParserTask, ExecutionResult, ExecutionErrorCodes } from '../types.js';

// Endpoint mapping configuration
// Allows customizing parser API paths without code changes
const ENDPOINT_MAPPING = {
  SEARCH: process.env.TW_PARSER_ENDPOINT_SEARCH || '/search/keyword',
  ACCOUNT_SUMMARY: process.env.TW_PARSER_ENDPOINT_ACCOUNT_SUMMARY || '/account/{username}',
  ACCOUNT_TWEETS: process.env.TW_PARSER_ENDPOINT_ACCOUNT_TWEETS || '/account/{username}/tweets',
  ACCOUNT_FOLLOWERS: process.env.TW_PARSER_ENDPOINT_ACCOUNT_FOLLOWERS || '/account/{username}/followers',
};

// Default timeout
const REQUEST_TIMEOUT = parseInt(process.env.TW_PARSER_TIMEOUT || '30000', 10);

export class RemoteDispatcher {
  /**
   * Dispatch task to remote worker (Railway)
   */
  async dispatch(
    instance: ParserInstance,
    task: ParserTask
  ): Promise<ExecutionResult> {
    if (!instance.baseUrl) {
      return {
        ok: false,
        error: 'REMOTE_WORKER missing baseUrl',
        errorCode: ExecutionErrorCodes.REMOTE_ERROR,
      };
    }

    const startTime = Date.now();

    try {
      const { url, method, params } = this.buildRequest(instance.baseUrl, task);
      
      const response = await axios({
        method,
        url,
        params: method === 'GET' ? params : undefined,
        data: method === 'POST' ? params : undefined,
        timeout: REQUEST_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          'X-Task-ID': task.id,
          'X-Task-Type': task.type,
        },
        validateStatus: (status) => status < 500, // Accept 4xx for parsing
      });

      const duration = Date.now() - startTime;

      // Handle 429 Rate Limit
      if (response.status === 429) {
        return {
          ok: false,
          error: 'Rate limited by parser',
          errorCode: ExecutionErrorCodes.SLOT_RATE_LIMITED,
          meta: this.buildMeta(instance, task, duration),
        };
      }

      // Handle other client errors
      if (response.status >= 400) {
        return {
          ok: false,
          error: `Parser returned HTTP ${response.status}`,
          errorCode: ExecutionErrorCodes.REMOTE_ERROR,
          meta: this.buildMeta(instance, task, duration),
        };
      }

      // Success
      return {
        ok: true,
        data: response.data,
        meta: this.buildMeta(instance, task, duration),
      };
    } catch (error: any) {
      return this.handleError(error, instance, task, startTime);
    }
  }

  /**
   * Build request URL and parameters based on task type
   */
  private buildRequest(
    baseUrl: string,
    task: ParserTask
  ): { url: string; method: 'GET' | 'POST'; params: Record<string, any> } {
    const { type, payload } = task;

    switch (type) {
      case 'SEARCH': {
        const endpoint = ENDPOINT_MAPPING.SEARCH;
        return {
          url: `${baseUrl}${endpoint}`,
          method: 'GET',
          params: {
            q: payload.q || payload.query,
            limit: payload.limit || payload.maxResults || 100,
          },
        };
      }

      case 'ACCOUNT_SUMMARY': {
        const endpoint = ENDPOINT_MAPPING.ACCOUNT_SUMMARY.replace('{username}', payload.username);
        return {
          url: `${baseUrl}${endpoint}`,
          method: 'GET',
          params: {},
        };
      }

      case 'ACCOUNT_TWEETS': {
        const endpoint = ENDPOINT_MAPPING.ACCOUNT_TWEETS.replace('{username}', payload.username);
        return {
          url: `${baseUrl}${endpoint}`,
          method: 'GET',
          params: {
            limit: payload.limit || payload.maxResults || 100,
          },
        };
      }

      case 'ACCOUNT_FOLLOWERS': {
        const endpoint = ENDPOINT_MAPPING.ACCOUNT_FOLLOWERS.replace('{username}', payload.username);
        return {
          url: `${baseUrl}${endpoint}`,
          method: 'GET',
          params: {
            limit: payload.limit || payload.maxResults || 100,
          },
        };
      }

      default:
        // Generic POST for unknown types
        return {
          url: `${baseUrl}/execute`,
          method: 'POST',
          params: { type, ...payload },
        };
    }
  }

  /**
   * Build metadata for result
   */
  private buildMeta(
    instance: ParserInstance,
    task: ParserTask,
    duration: number
  ) {
    return {
      accountId: instance.accountId || 'unknown',
      instanceId: instance.id,
      taskId: task.id,
      duration,
    };
  }

  /**
   * Handle errors
   */
  private handleError(
    error: any,
    instance: ParserInstance,
    task: ParserTask,
    startTime: number
  ): ExecutionResult {
    const duration = Date.now() - startTime;

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      // Timeout
      if (axiosError.code === 'ECONNABORTED') {
        return {
          ok: false,
          error: 'Request timed out',
          errorCode: ExecutionErrorCodes.REMOTE_TIMEOUT,
          meta: this.buildMeta(instance, task, duration),
        };
      }

      // Connection refused
      if (axiosError.code === 'ECONNREFUSED') {
        return {
          ok: false,
          error: 'Connection refused - parser may be down',
          errorCode: ExecutionErrorCodes.REMOTE_ERROR,
          meta: this.buildMeta(instance, task, duration),
        };
      }

      // Network error
      if (axiosError.code === 'ENOTFOUND') {
        return {
          ok: false,
          error: 'Host not found',
          errorCode: ExecutionErrorCodes.REMOTE_ERROR,
          meta: this.buildMeta(instance, task, duration),
        };
      }
    }

    return {
      ok: false,
      error: error.message || 'Unknown error',
      errorCode: ExecutionErrorCodes.REMOTE_ERROR,
      meta: this.buildMeta(instance, task, duration),
    };
  }
}

// Singleton export
export const remoteDispatcher = new RemoteDispatcher();
