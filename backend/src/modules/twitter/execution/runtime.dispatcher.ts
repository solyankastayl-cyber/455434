// B3 Integration - Runtime Dispatcher
// Connects Execution Core (B2) with Runtime Layer (B3)
// Replaces direct HTTP calls with runtime abstraction

import { ParserInstance, ParserTask, ExecutionResult, ExecutionErrorCodes } from './types.js';
import {
  createTwitterRuntime,
  TwitterRuntime,
  RuntimeResponse,
  RuntimeStatus,
  runtimeRegistry,
  runtimeHealthService,
  SlotConfig,
} from '../runtime/index.js';

/**
 * Convert ParserInstance to SlotConfig for runtime factory
 */
function toSlotConfig(instance: ParserInstance): SlotConfig {
  return {
    id: instance.id,
    type: instance.kind as any,
    accountId: instance.accountId,
    baseUrl: instance.baseUrl,
    proxyUrl: instance.proxyUrl,
    worker: instance.baseUrl ? { baseUrl: instance.baseUrl } : undefined,
    proxy: instance.proxyUrl ? { url: instance.proxyUrl } : undefined,
  };
}

/**
 * Convert RuntimeResponse to ExecutionResult
 */
function toExecutionResult(
  response: RuntimeResponse<any>,
  instance: ParserInstance,
  task: ParserTask,
  duration: number
): ExecutionResult {
  if (response.ok) {
    return {
      ok: true,
      data: response.data,
      meta: {
        accountId: instance.accountId || 'unknown',
        instanceId: instance.id,
        taskId: task.id,
        duration,
      },
    };
  }

  // Map runtime status to error code
  let errorCode = ExecutionErrorCodes.REMOTE_ERROR;
  switch (response.status) {
    case 'RATE_LIMITED':
      errorCode = ExecutionErrorCodes.SLOT_RATE_LIMITED;
      break;
    case 'AUTH_REQUIRED':
      errorCode = ExecutionErrorCodes.REMOTE_ERROR;
      break;
    case 'DOWN':
      errorCode = ExecutionErrorCodes.REMOTE_ERROR;
      break;
  }

  return {
    ok: false,
    error: response.error || 'Unknown runtime error',
    errorCode,
    meta: {
      accountId: instance.accountId || 'unknown',
      instanceId: instance.id,
      taskId: task.id,
      duration,
    },
  };
}

export class RuntimeDispatcher {
  /**
   * Dispatch task using Runtime Layer
   */
  async dispatch(
    instance: ParserInstance,
    task: ParserTask
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Get or create runtime for this slot
      let runtime = runtimeRegistry.getRuntime(instance.id);
      
      if (!runtime) {
        const config = toSlotConfig(instance);
        runtime = createTwitterRuntime(config);
        runtimeRegistry.register(instance.id, runtime);
        
        // Initial health check
        const health = await runtimeHealthService.check(runtime);
        runtimeRegistry.setHealth(instance.id, health);
      }

      // Execute task based on type
      let response: RuntimeResponse<any>;

      switch (task.type) {
        case 'SEARCH':
          response = await runtime.fetchTweetsByKeyword({
            keyword: task.payload.q || task.payload.query || task.payload.keyword,
            limit: task.payload.limit || task.payload.maxResults || 20,
          });
          break;

        case 'ACCOUNT_TWEETS':
          response = await runtime.fetchAccountTweets(
            task.payload.username,
            task.payload.limit || task.payload.maxResults || 20
          );
          break;

        case 'ACCOUNT_FOLLOWERS':
          // Not implemented in runtime interface yet
          response = {
            ok: false,
            status: 'ERROR',
            error: 'ACCOUNT_FOLLOWERS not implemented in runtime',
          };
          break;

        default:
          response = {
            ok: false,
            status: 'ERROR',
            error: `Unknown task type: ${task.type}`,
          };
      }

      const duration = Date.now() - startTime;

      // Update health based on response
      if (!response.ok) {
        const currentHealth = runtimeRegistry.getHealth(instance.id);
        if (currentHealth) {
          currentHealth.status = response.status;
          currentHealth.lastCheckedAt = Date.now();
          currentHealth.error = response.error;
        }
      }

      return toExecutionResult(response, instance, task, duration);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      return {
        ok: false,
        error: error?.message || 'Dispatch error',
        errorCode: ExecutionErrorCodes.REMOTE_ERROR,
        meta: {
          accountId: instance.accountId || 'unknown',
          instanceId: instance.id,
          taskId: task.id,
          duration,
        },
      };
    }
  }

  /**
   * Check health of a slot's runtime
   */
  async checkHealth(instance: ParserInstance): Promise<RuntimeStatus> {
    let runtime = runtimeRegistry.getRuntime(instance.id);
    
    if (!runtime) {
      const config = toSlotConfig(instance);
      runtime = createTwitterRuntime(config);
      runtimeRegistry.register(instance.id, runtime);
    }

    const health = await runtimeHealthService.check(runtime);
    runtimeRegistry.setHealth(instance.id, health);
    
    return health.status;
  }

  /**
   * Get all runtime health statuses
   */
  getRuntimeHealthSummary() {
    return runtimeRegistry.getSummary();
  }
}

// Singleton export
export const runtimeDispatcher = new RuntimeDispatcher();
