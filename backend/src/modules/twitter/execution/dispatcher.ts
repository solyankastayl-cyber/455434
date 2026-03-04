// B2 Execution Core - Dispatcher
// Executes tasks via selected slot (Railway or Proxy)

import axios, { AxiosError } from 'axios';
import { ParserInstance, ParserTask, ExecutionResult, ExecutionErrorCodes } from './types.js';

const REQUEST_TIMEOUT = 30000; // 30 seconds

export class Dispatcher {
  /**
   * Dispatch task to the appropriate parser instance
   */
  async dispatch(
    instance: ParserInstance,
    task: ParserTask
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      let result: ExecutionResult;

      if (instance.kind === 'REMOTE_WORKER') {
        result = await this.dispatchRemote(instance, task);
      } else if (instance.kind === 'PROXY') {
        result = await this.dispatchProxy(instance, task);
      } else if (instance.kind === 'LOCAL_PARSER') {
        result = await this.dispatchLocalParser(instance, task);
      } else {
        return {
          ok: false,
          error: `Unknown instance kind: ${instance.kind}`,
          errorCode: 'UNKNOWN_KIND',
        };
      }

      // Add execution metadata
      if (result.ok) {
        result.meta = {
          accountId: instance.accountId || 'unknown',
          instanceId: instance.id,
          taskId: task.id,
          duration: Date.now() - startTime,
        };
      }

      return result;
    } catch (error: any) {
      return this.handleError(error, instance, task, startTime);
    }
  }

  /**
   * Dispatch to Railway/Remote Worker
   */
  private async dispatchRemote(
    instance: ParserInstance,
    task: ParserTask
  ): Promise<ExecutionResult> {
    if (!instance.baseUrl) {
      return {
        ok: false,
        error: 'Remote worker baseUrl not configured',
        errorCode: ExecutionErrorCodes.REMOTE_ERROR,
      };
    }

    // Map task type to endpoint
    const endpoint = this.getEndpointForTask(task);
    const url = `${instance.baseUrl}${endpoint}`;

    const response = await axios({
      method: 'GET', // Parser uses GET with query params
      url,
      params: task.payload,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'X-Task-ID': task.id,
      },
    });

    return {
      ok: true,
      data: response.data,
    };
  }

  /**
   * Dispatch via Proxy (local parser with proxy)
   * For now returns not implemented - will be added when we have proxy support
   */
  private async dispatchProxy(
    instance: ParserInstance,
    task: ParserTask
  ): Promise<ExecutionResult> {
    // In dev mode without proxy, we can call local parser directly
    const localParserUrl = process.env.TWITTER_PARSER_URL || 'http://localhost:5001';
    
    const endpoint = this.getEndpointForTask(task);
    const url = `${localParserUrl}${endpoint}`;

    try {
      const response = await axios({
        method: 'GET',
        url,
        params: task.payload,
        timeout: REQUEST_TIMEOUT,
      });

      return {
        ok: true,
        data: response.data,
      };
    } catch (error: any) {
      // If local parser not available, return proxy not implemented
      if (error.code === 'ECONNREFUSED') {
        return {
          ok: false,
          error: 'Proxy mode requires local parser service running',
          errorCode: ExecutionErrorCodes.PROXY_NOT_IMPLEMENTED,
        };
      }
      throw error;
    }
  }

  /**
   * Dispatch via LOCAL_PARSER (uses USER session from user_twitter_sessions)
   */
  private async dispatchLocalParser(
    instance: ParserInstance,
    task: ParserTask
  ): Promise<ExecutionResult> {
    const { createLocalParserRuntime } = await import('../runtime/adapters/local-parser.runtime.js');
    
    const parserUrl = instance.baseUrl || process.env.TWITTER_PARSER_URL || 'http://localhost:5001';
    const runtime = createLocalParserRuntime(parserUrl, 'USER');

    try {
      if (task.type === 'SEARCH') {
        const result = await runtime.fetchTweetsByKeyword({
          keyword: task.payload.query || task.payload.keyword || '',
          limit: task.payload.maxTweets || task.payload.limit || 50,
        });
        
        return {
          ok: result.ok,
          data: result.data,
          error: result.error,
          errorCode: result.ok ? undefined : ExecutionErrorCodes.REMOTE_ERROR,
        };
      }
      
      if (task.type === 'ACCOUNT_TWEETS') {
        const username = task.payload.username || task.payload.query || '';
        const result = await runtime.fetchAccountTweets(
          username,
          task.payload.maxTweets || task.payload.limit || 50
        );
        
        return {
          ok: result.ok,
          data: result.data,
          error: result.error,
          errorCode: result.ok ? undefined : ExecutionErrorCodes.REMOTE_ERROR,
        };
      }
      
      return {
        ok: false,
        error: `Unsupported task type: ${task.type}`,
        errorCode: ExecutionErrorCodes.REMOTE_ERROR,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Local parser error',
        errorCode: ExecutionErrorCodes.REMOTE_ERROR,
      };
    }
  }

  /**
   * Map task type to parser endpoint
   */
  private getEndpointForTask(task: ParserTask): string {
    switch (task.type) {
      case 'SEARCH':
        return `/search/${encodeURIComponent(task.payload.query || task.payload.keyword || '')}`;
      case 'ACCOUNT_TWEETS':
        // Username can be in 'username' or 'query' field
        const username = task.payload.username || task.payload.query || '';
        return `/tweets/${encodeURIComponent(username)}`;
      case 'ACCOUNT_FOLLOWERS':
        return `/account/${encodeURIComponent(task.payload.username || task.payload.query || '')}/followers`;
      default:
        return '/execute';
    }
  }

  /**
   * Handle errors and map to ExecutionResult
   */
  private handleError(
    error: any,
    instance: ParserInstance,
    task: ParserTask,
    startTime: number
  ): ExecutionResult {
    const duration = Date.now() - startTime;
    
    // Axios error
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      // Rate limit
      if (axiosError.response?.status === 429) {
        return {
          ok: false,
          error: 'Rate limited by Twitter',
          errorCode: ExecutionErrorCodes.SLOT_RATE_LIMITED,
          meta: {
            accountId: instance.accountId || 'unknown',
            instanceId: instance.id,
            taskId: task.id,
            duration,
          },
        };
      }

      // Timeout
      if (axiosError.code === 'ECONNABORTED') {
        return {
          ok: false,
          error: 'Request timed out',
          errorCode: ExecutionErrorCodes.REMOTE_TIMEOUT,
          meta: {
            accountId: instance.accountId || 'unknown',
            instanceId: instance.id,
            taskId: task.id,
            duration,
          },
        };
      }

      // Other HTTP errors
      return {
        ok: false,
        error: axiosError.message || 'Remote request failed',
        errorCode: ExecutionErrorCodes.REMOTE_ERROR,
        meta: {
          accountId: instance.accountId || 'unknown',
          instanceId: instance.id,
          taskId: task.id,
          duration,
        },
      };
    }

    // Generic error
    return {
      ok: false,
      error: error?.message || 'Unknown error',
      errorCode: ExecutionErrorCodes.REMOTE_ERROR,
    };
  }
}

// Singleton export
export const dispatcher = new Dispatcher();
