// B3 - Execution Task Model
// Persistent storage for execution tasks

export type ExecutionTaskType = 'SEARCH' | 'ACCOUNT_SUMMARY' | 'ACCOUNT_TWEETS' | 'ACCOUNT_FOLLOWERS';
export type ExecutionTaskStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
export type ExecutionTaskPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface ExecutionTaskPayload {
  query?: string;      // for SEARCH
  username?: string;   // for ACCOUNT_*
  limit?: number;
  [key: string]: any;
}

export interface ExecutionTaskError {
  code: string;
  message: string;
  raw?: any;
}

export interface ExecutionTaskResultRef {
  collection: string;  // e.g., 'twitter_parsed_tweets'
  ids: string[];       // ObjectId strings
}

export interface ExecutionTask {
  _id?: string;
  type: ExecutionTaskType;
  payload: ExecutionTaskPayload;
  priority: ExecutionTaskPriority;
  status: ExecutionTaskStatus;
  
  // Retry
  attempts: number;
  maxAttempts: number;
  
  // Execution binding
  accountId?: string;
  slotId?: string;
  
  // Timestamps
  createdAt: number;
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  
  // Results
  resultRef?: ExecutionTaskResultRef;
  resultCount?: number;
  
  // Error
  error?: ExecutionTaskError;
  
  updatedAt: number;
}

export interface ExecutionTaskDoc extends ExecutionTask {
  _id: any;
}

// DTO for creating tasks
export interface CreateExecutionTaskDto {
  type: ExecutionTaskType;
  payload: ExecutionTaskPayload;
  priority?: ExecutionTaskPriority;
  maxAttempts?: number;
}

// DTO for API responses
export interface ExecutionTaskDTO {
  id: string;
  type: ExecutionTaskType;
  payload: ExecutionTaskPayload;
  priority: ExecutionTaskPriority;
  status: ExecutionTaskStatus;
  attempts: number;
  maxAttempts: number;
  slotId?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  resultCount?: number;
  error?: ExecutionTaskError;
}

// Transform to DTO
export function executionTaskToDTO(task: ExecutionTask): ExecutionTaskDTO {
  return {
    id: task._id || '',
    type: task.type,
    payload: task.payload,
    priority: task.priority,
    status: task.status,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    slotId: task.slotId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    resultCount: task.resultCount,
    error: task.error,
  };
}

// Create new task
export function createExecutionTask(dto: CreateExecutionTaskDto): Omit<ExecutionTask, '_id'> {
  const now = Date.now();
  return {
    type: dto.type,
    payload: dto.payload,
    priority: dto.priority || 'NORMAL',
    status: 'QUEUED',
    attempts: 0,
    maxAttempts: dto.maxAttempts || 3,
    createdAt: now,
    queuedAt: now,
    updatedAt: now,
  };
}
