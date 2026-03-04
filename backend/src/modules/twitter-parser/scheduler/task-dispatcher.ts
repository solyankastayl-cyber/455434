/**
 * Twitter Parser Module — Task Dispatcher
 * 
 * Coordinates task execution with core logic.
 * Based on: v4.2-final
 */

import type { QueueTask, DispatchResult } from './types.js';
import { extractErrorCode, handleTaskFailure, getExecutionPath } from './worker.logic.js';
import { RetryDecision } from '../core/retry/index.js';

/**
 * Dispatch context for task execution
 */
export interface DispatchContext {
  task: QueueTask;
  onBeforeExecute?: (task: QueueTask) => Promise<void>;
  onAfterExecute?: (task: QueueTask, result: DispatchResult) => Promise<void>;
  onError?: (task: QueueTask, error: Error) => Promise<void>;
}

/**
 * Task dispatcher interface
 */
export interface ITaskDispatcher {
  dispatch(context: DispatchContext, executor: TaskExecutor): Promise<DispatchResult>;
}

/**
 * Task executor function type
 */
export type TaskExecutor = (task: QueueTask) => Promise<DispatchResult>;

/**
 * Task dispatcher implementation
 */
export class TaskDispatcher implements ITaskDispatcher {
  
  async dispatch(context: DispatchContext, executor: TaskExecutor): Promise<DispatchResult> {
    const { task, onBeforeExecute, onAfterExecute, onError } = context;
    
    try {
      // Pre-execution hook
      if (onBeforeExecute) {
        await onBeforeExecute(task);
      }
      
      // Determine execution path
      const path = getExecutionPath(task);
      console.log(`[TaskDispatcher] Executing task ${task.id} via ${path} path`);
      
      // Execute task
      const result = await executor(task);
      
      // Post-execution hook
      if (onAfterExecute) {
        await onAfterExecute(task, result);
      }
      
      return result;
      
    } catch (error: any) {
      const errorCode = extractErrorCode(error.message);
      
      // Error hook
      if (onError) {
        await onError(task, error);
      }
      
      // Determine retry behavior
      const failureResult = handleTaskFailure(task, errorCode);
      
      return {
        ok: false,
        error: error.message,
        errorCode,
      };
    }
  }
}

export const taskDispatcher = new TaskDispatcher();
