// Admin System Parsing Service
// Handles SYSTEM scope accounts, sessions, and tasks

import { TwitterAccountModel, ITwitterAccount } from '../accounts/account.model.js';
import { TwitterSessionModel, ITwitterSession } from '../sessions/session.model.js';
import { TwitterTaskModel, ITwitterTask, TaskStatus, PRIORITY_VALUES } from '../execution/queue/task.model.js';
import { ExecutionScope, OwnerType } from '../core/execution-scope.js';
import { getPolicyLimits, checkPolicy } from '../core/scope-policy.service.js';
import { sessionService } from '../sessions/session.service.js';
import { runTwitterPreflight } from '../preflight/preflight.service.js';
import { SystemParseLogModel, SystemParseLogStatus } from './system-parse-log.model.js';
import { notifySystemParseBlocked, notifySystemParseAborted } from './system-telegram.notifier.js';
import axios from 'axios';
import { env } from '../../../config/env.js';

// ==================== ACCOUNTS ====================

export interface CreateSystemAccountInput {
  username: string;
  displayName?: string;
  label?: string;
  tags?: string[];
}

export async function getSystemAccounts(): Promise<ITwitterAccount[]> {
  return TwitterAccountModel.find({ ownerType: OwnerType.SYSTEM })
    .sort({ createdAt: -1 })
    .lean();
}

export async function getSystemAccountById(id: string): Promise<ITwitterAccount | null> {
  return TwitterAccountModel.findOne({ 
    _id: id, 
    ownerType: OwnerType.SYSTEM 
  }).lean();
}

export async function createSystemAccount(input: CreateSystemAccountInput): Promise<ITwitterAccount> {
  const account = new TwitterAccountModel({
    username: input.username.toLowerCase().replace('@', ''),
    displayName: input.displayName || input.username,
    ownerType: OwnerType.SYSTEM,
    ownerUserId: null,
    label: input.label || `System: ${input.username}`,
    tags: input.tags || [],
    status: 'ACTIVE',
    rateLimit: 200,
  });
  
  await account.save();
  console.log(`[AdminSystem] Created system account: ${account.username}`);
  return account;
}

export async function updateSystemAccount(
  id: string, 
  updates: Partial<{ label: string; tags: string[]; status: string }>
): Promise<ITwitterAccount | null> {
  const account = await TwitterAccountModel.findOneAndUpdate(
    { _id: id, ownerType: OwnerType.SYSTEM },
    { $set: updates },
    { new: true }
  );
  return account;
}

export async function disableSystemAccount(id: string): Promise<boolean> {
  const result = await TwitterAccountModel.updateOne(
    { _id: id, ownerType: OwnerType.SYSTEM },
    { $set: { status: 'DISABLED' } }
  );
  return result.modifiedCount > 0;
}

// Get session stats for account
export async function getAccountSessionStats(accountId: string): Promise<{ ok: number; stale: number; invalid: number }> {
  const sessions = await TwitterSessionModel.find({ 
    accountId, 
    scope: ExecutionScope.SYSTEM 
  }).lean();
  
  return {
    ok: sessions.filter(s => s.status === 'OK').length,
    stale: sessions.filter(s => s.status === 'STALE').length,
    invalid: sessions.filter(s => s.status === 'INVALID' || s.status === 'EXPIRED').length,
  };
}

// ==================== SESSIONS ====================

export async function getSystemSessions(): Promise<ITwitterSession[]> {
  return TwitterSessionModel.find({ scope: ExecutionScope.SYSTEM })
    .populate('accountId', 'username displayName label')
    .sort({ lastSyncedAt: -1 })
    .lean();
}

export async function getSystemSessionById(sessionId: string): Promise<ITwitterSession | null> {
  return TwitterSessionModel.findOne({ 
    sessionId, 
    scope: ExecutionScope.SYSTEM 
  })
    .populate('accountId', 'username displayName label')
    .lean();
}

export async function testSystemSession(sessionId: string): Promise<{
  ok: boolean;
  canRun: boolean;
  cookiesCount: number;
  status: string;
  error?: string;
}> {
  try {
    const preflight = await runTwitterPreflight(sessionId);
    return {
      ok: preflight.canRun,
      canRun: preflight.canRun,
      cookiesCount: preflight.checks.session.cookiesCount,
      status: preflight.status,
      error: preflight.blockers.length > 0 ? preflight.blockers[0].message : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      canRun: false,
      cookiesCount: 0,
      status: 'error',
      error: error.message,
    };
  }
}

export async function invalidateSystemSession(sessionId: string): Promise<boolean> {
  const result = await TwitterSessionModel.updateOne(
    { sessionId, scope: ExecutionScope.SYSTEM },
    { $set: { status: 'INVALID', lastStatusChangeAt: new Date() } }
  );
  return result.modifiedCount > 0;
}

// ==================== TASKS ====================

export interface RunSystemParseInput {
  sessionId: string;
  target: string; // @username or keyword
  type: 'SEARCH' | 'ACCOUNT_TWEETS';
  limit?: number;
}

export async function getSystemTasks(limit: number = 50): Promise<ITwitterTask[]> {
  return TwitterTaskModel.find({ scope: ExecutionScope.SYSTEM })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export async function runSystemParse(input: RunSystemParseInput): Promise<{
  ok: boolean;
  taskId?: string;
  error?: string;
  data?: any;
  blocked?: boolean;
  blockers?: Array<{ code: string; message: string }>;
}> {
  // 1. Get session to get account info
  const session = await TwitterSessionModel.findOne({ sessionId: input.sessionId })
    .populate('accountId', 'username label')
    .lean();
  
  if (!session) {
    return { ok: false, error: 'Session not found' };
  }
  
  const accountUsername = (session.accountId as any)?.username || 'unknown';
  
  // 2. PREFLIGHT GATE - Hard block if not OK
  const preflight = await runTwitterPreflight(input.sessionId);
  
  if (!preflight.canRun) {
    // Log the blocked attempt
    await SystemParseLogModel.create({
      sessionId: input.sessionId,
      accountId: session.accountId?.toString(),
      target: input.target,
      status: SystemParseLogStatus.BLOCKED,
      reason: 'PREFLIGHT_FAILED',
      blockers: preflight.blockers,
    });
    
    // Send Telegram alert (async, don't await)
    notifySystemParseBlocked(input.sessionId, accountUsername, preflight.blockers).catch(err => {
      console.error('[SystemParse] Failed to send blocked alert:', err);
    });
    
    console.log(`[SystemParse] BLOCKED: ${accountUsername} - ${preflight.blockers.map(b => b.code).join(', ')}`);
    
    return {
      ok: false,
      blocked: true,
      error: 'Preflight check failed - parse blocked',
      blockers: preflight.blockers,
    };
  }
  
  // 3. Log parse start
  const startTime = Date.now();
  await SystemParseLogModel.create({
    sessionId: input.sessionId,
    accountId: session.accountId?.toString(),
    target: input.target,
    status: SystemParseLogStatus.STARTED,
  });
  
  // 4. Create task record
  const task = new TwitterTaskModel({
    ownerType: OwnerType.SYSTEM,
    scope: ExecutionScope.SYSTEM,
    status: TaskStatus.RUNNING,
    type: input.type,
    payload: {
      target: input.target,
      limit: input.limit || 10,
      sessionId: input.sessionId,
    },
    accountId: session.accountId?.toString(),
    priority: 'HIGH',
    priorityValue: PRIORITY_VALUES.HIGH,
    startedAt: new Date(),
  });
  await task.save();
  
  // 5. Execute parse via parser service
  try {
    const parserUrl = env.PARSER_URL || 'http://localhost:5001';
    const cookies = await sessionService.getCookies(input.sessionId);
    
    let endpoint = '';
    let payload: any = { cookies, limit: input.limit || 10 };
    
    if (input.type === 'SEARCH') {
      endpoint = '/search';
      payload.keyword = input.target.replace('@', '');
    } else {
      endpoint = '/user/tweets';
      payload.username = input.target.replace('@', '');
    }
    
    const response = await axios.post(`${parserUrl}${endpoint}`, payload, {
      timeout: 60000,
    });
    
    const duration = Date.now() - startTime;
    const tweetsFetched = response.data?.data?.length || 0;
    
    // Update task with results
    await TwitterTaskModel.updateOne(
      { _id: task._id },
      {
        $set: {
          status: TaskStatus.DONE,
          completedAt: new Date(),
          result: {
            tweetsFetched,
            data: response.data,
          },
        },
      }
    );
    
    // Log success
    await SystemParseLogModel.create({
      sessionId: input.sessionId,
      accountId: session.accountId?.toString(),
      target: input.target,
      status: SystemParseLogStatus.DONE,
      taskId: task._id.toString(),
      tweetsFetched,
      duration,
    });
    
    console.log(`[SystemParse] SUCCESS: ${accountUsername} - ${tweetsFetched} tweets in ${Math.round(duration/1000)}s`);
    
    return {
      ok: true,
      taskId: task._id.toString(),
      data: response.data,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    // Update task with error
    await TwitterTaskModel.updateOne(
      { _id: task._id },
      {
        $set: {
          status: TaskStatus.FAILED,
          completedAt: new Date(),
          lastError: error.message,
        },
      }
    );
    
    // Log abort
    await SystemParseLogModel.create({
      sessionId: input.sessionId,
      accountId: session.accountId?.toString(),
      target: input.target,
      status: SystemParseLogStatus.ABORTED,
      reason: error.code || 'RUNTIME_ERROR',
      taskId: task._id.toString(),
      duration,
      error: error.message,
    });
    
    // Send Telegram alert
    notifySystemParseAborted(
      input.sessionId,
      accountUsername,
      error.code || 'RUNTIME_ERROR',
      0,
      duration,
      task._id.toString()
    ).catch(err => {
      console.error('[SystemParse] Failed to send aborted alert:', err);
    });
    
    console.log(`[SystemParse] ABORTED: ${accountUsername} - ${error.message}`);
    
    return {
      ok: false,
      taskId: task._id.toString(),
      error: error.message,
    };
  }
}

export async function abortSystemTask(taskId: string): Promise<boolean> {
  const result = await TwitterTaskModel.updateOne(
    { _id: taskId, scope: ExecutionScope.SYSTEM, status: TaskStatus.RUNNING },
    { $set: { status: TaskStatus.FAILED, lastError: 'Aborted by admin', completedAt: new Date() } }
  );
  return result.modifiedCount > 0;
}

// ==================== HEALTH ====================

export interface SystemHealth {
  parser: { status: string; url: string };
  browser: { status: string };
  sessions: { total: number; ok: number; stale: number; invalid: number };
  tasks: { running: number; pending: number; failedToday: number };
  limits: ReturnType<typeof getPolicyLimits>;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const parserUrl = env.PARSER_URL || 'http://localhost:5001';
  
  // Parser health
  let parserStatus = 'down';
  let browserStatus = 'unknown';
  try {
    const res = await axios.get(`${parserUrl}/health`, { timeout: 3000 });
    parserStatus = res.data?.status === 'running' ? 'ok' : 'degraded';
    browserStatus = res.data?.status === 'running' ? 'ready' : 'not_ready';
  } catch {
    parserStatus = 'down';
    browserStatus = 'down';
  }
  
  // Sessions stats
  const sessions = await TwitterSessionModel.find({ scope: ExecutionScope.SYSTEM }).lean();
  const sessionsStats = {
    total: sessions.length,
    ok: sessions.filter(s => s.status === 'OK').length,
    stale: sessions.filter(s => s.status === 'STALE').length,
    invalid: sessions.filter(s => s.status === 'INVALID' || s.status === 'EXPIRED').length,
  };
  
  // Tasks stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const runningTasks = await TwitterTaskModel.countDocuments({ 
    scope: ExecutionScope.SYSTEM, 
    status: TaskStatus.RUNNING 
  });
  const pendingTasks = await TwitterTaskModel.countDocuments({ 
    scope: ExecutionScope.SYSTEM, 
    status: TaskStatus.PENDING 
  });
  const failedToday = await TwitterTaskModel.countDocuments({
    scope: ExecutionScope.SYSTEM,
    status: TaskStatus.FAILED,
    createdAt: { $gte: today },
  });
  
  return {
    parser: { status: parserStatus, url: parserUrl },
    browser: { status: browserStatus },
    sessions: sessionsStats,
    tasks: { running: runningTasks, pending: pendingTasks, failedToday },
    limits: getPolicyLimits(ExecutionScope.SYSTEM),
  };
}
