/**
 * Twitter Parser Module — Entry Point
 * 
 * Autonomous Twitter parsing subsystem.
 * Based on: v4.2-final
 * 
 * SAFETY RULES:
 * - NO process.env inside module
 * - NO auto-sync / silent retry
 * - NO changes to init order
 * - Config is the ONLY way to pass dependencies
 */

import { Application } from 'express';

export interface TelegramConfig {
  token: string;
  adminChatId?: string;
}

export interface LoggerInterface {
  info: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
  debug: (message: string, meta?: any) => void;
}

export interface TwitterParserConfig {
  /** MongoDB connection string */
  mongoUrl: string;
  
  /** AES-256-GCM encryption key for cookies */
  encryptionKey: string;
  
  /** Telegram notification config (optional) */
  telegram?: TelegramConfig;
  
  /** Express/Fastify app instance for routes */
  app: Application;
  
  /** Logger instance (optional, defaults to console) */
  logger?: LoggerInterface;
  
  /** API route prefix (default: /api/v4) */
  apiPrefix?: string;
}

/**
 * Initialize Twitter Parser Module
 * 
 * INIT ORDER (DO NOT CHANGE):
 * 1. storage (Mongo)
 * 2. encryption / COOKIE_ENC_KEY
 * 3. session selector
 * 4. parser runtime
 * 5. scheduler
 * 6. worker
 * 7. API routes
 * 8. telegram notifier
 */
export async function initTwitterParser(config: TwitterParserConfig): Promise<void> {
  const logger = config.logger || console;
  const apiPrefix = config.apiPrefix || '/api/v4';
  
  logger.info('[TwitterParser] Initializing module...', { apiPrefix });
  
  // TODO: Phase 10.5 — actual implementation
  // 1. init storage
  // 2. init encryption service
  // 3. init session selector
  // 4. init parser runtime
  // 5. init scheduler
  // 6. init worker
  // 7. init API routes (public + admin)
  // 8. init telegram notifications
  
  logger.info('[TwitterParser] Module initialized');
}

/**
 * Shutdown Twitter Parser Module gracefully
 */
export async function shutdownTwitterParser(): Promise<void> {
  // TODO: graceful shutdown
  // 1. stop worker
  // 2. stop scheduler
  // 3. close connections
}

// Re-export core public interface
export { initStorage } from './storage/index.js';
export { TelegramMessageBuilder, eventRouter } from './telegram/index.js';
export { runPreflightCheck, validateCookies } from './extension/index.js';
export { schedulerLogic, taskDispatcher } from './scheduler/index.js';
export { assessQuality, shouldRetry, TimingStrategy } from './core/index.js';
export { syncHandlers } from './api/index.js';
