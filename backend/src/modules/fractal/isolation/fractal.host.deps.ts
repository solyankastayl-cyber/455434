/**
 * BLOCK B.1 — Host Dependencies Contract
 * Полная абстракция внешних зависимостей для изоляции Fractal модуля
 * 
 * Принцип: Fractal модуль НЕ должен импортировать напрямую из:
 * - External APIs (axios, fetch)
 * - Database drivers (mongoose, mongodb)
 * - Process/OS modules (process.env напрямую)
 * - Other domain modules
 * 
 * Все зависимости должны инжектиться через FractalHostDeps
 */

import { FastifyInstance } from 'fastify';

// ═══════════════════════════════════════════════════════════════
// CORE INTERFACES
// ═══════════════════════════════════════════════════════════════

export interface Logger {
  info: (obj: any, msg?: string) => void;
  warn: (obj: any, msg?: string) => void;
  error: (obj: any, msg?: string) => void;
  debug?: (obj: any, msg?: string) => void;
}

export interface Clock {
  now: () => number; // milliseconds epoch
  utcNow: () => Date;
  toISOString: (ts: number) => string;
}

export interface DbCollection<T = any> {
  find: (query: any, options?: any) => Promise<T[]>;
  findOne: (query: any, options?: any) => Promise<T | null>;
  insertOne: (doc: T) => Promise<{ insertedId: string }>;
  insertMany: (docs: T[]) => Promise<{ insertedIds: string[] }>;
  updateOne: (query: any, update: any, options?: any) => Promise<{ modifiedCount: number }>;
  updateMany: (query: any, update: any, options?: any) => Promise<{ modifiedCount: number }>;
  deleteOne: (query: any) => Promise<{ deletedCount: number }>;
  deleteMany: (query: any) => Promise<{ deletedCount: number }>;
  countDocuments: (query?: any) => Promise<number>;
  aggregate: (pipeline: any[]) => Promise<T[]>;
}

export interface Db {
  getCollection: <T = any>(name: string) => DbCollection<T>;
  isConnected: () => boolean;
}

export interface Settings {
  get: <T = any>(key: string, defaultValue?: T) => T;
  getBool: (key: string, defaultValue?: boolean) => boolean;
  getNum: (key: string, defaultValue?: number) => number;
  getStr: (key: string, defaultValue?: string) => string;
  getArray: <T = string>(key: string, defaultValue?: T[]) => T[];
}

export interface HttpClient {
  get: <T = any>(url: string, options?: RequestOptions) => Promise<HttpResponse<T>>;
  post: <T = any>(url: string, body?: any, options?: RequestOptions) => Promise<HttpResponse<T>>;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

export interface HttpResponse<T> {
  ok: boolean;
  status: number;
  data: T;
  headers?: Record<string, string>;
}

export interface TelegramNotifier {
  sendMessage: (chatId: string, text: string, options?: TelegramOptions) => Promise<boolean>;
  sendAlert: (level: 'INFO' | 'ALERT' | 'CRITICAL', message: string) => Promise<boolean>;
}

export interface TelegramOptions {
  parse_mode?: 'HTML' | 'Markdown';
  disable_notification?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// MAIN HOST DEPS INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface FractalHostDeps {
  app: FastifyInstance;
  logger: Logger;
  clock: Clock;
  db: Db;
  settings: Settings;
  http?: HttpClient;
  telegram?: TelegramNotifier;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

export const defaultLogger: Logger = {
  info: (obj, msg) => console.log(`[INFO] ${msg || ''}`, obj),
  warn: (obj, msg) => console.warn(`[WARN] ${msg || ''}`, obj),
  error: (obj, msg) => console.error(`[ERROR] ${msg || ''}`, obj),
  debug: (obj, msg) => console.debug(`[DEBUG] ${msg || ''}`, obj),
};

export const defaultClock: Clock = {
  now: () => Date.now(),
  utcNow: () => new Date(),
  toISOString: (ts) => new Date(ts).toISOString(),
};

export const createSettingsFromEnv = (): Settings => ({
  get: <T>(key: string, defaultValue?: T): T => {
    const val = process.env[key];
    if (val === undefined) return defaultValue as T;
    return val as unknown as T;
  },
  getBool: (key, def = false) => {
    const val = process.env[key];
    if (!val) return def;
    return val === 'true' || val === '1';
  },
  getNum: (key, def = 0) => {
    const val = process.env[key];
    if (!val) return def;
    const num = Number(val);
    return isNaN(num) ? def : num;
  },
  getStr: (key, def = '') => process.env[key] ?? def,
  getArray: <T = string>(key: string, def: T[] = []): T[] => {
    const val = process.env[key];
    if (!val) return def;
    try {
      return JSON.parse(val) as T[];
    } catch {
      return val.split(',') as T[];
    }
  },
});

// ═══════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════

export function isValidHostDeps(deps: Partial<FractalHostDeps>): deps is FractalHostDeps {
  return !!(deps.app && deps.logger && deps.clock && deps.db && deps.settings);
}

export function assertHostDeps(deps: Partial<FractalHostDeps>): asserts deps is FractalHostDeps {
  if (!isValidHostDeps(deps)) {
    const missing: string[] = [];
    if (!deps.app) missing.push('app');
    if (!deps.logger) missing.push('logger');
    if (!deps.clock) missing.push('clock');
    if (!deps.db) missing.push('db');
    if (!deps.settings) missing.push('settings');
    throw new Error(`[FractalHostDeps] Missing required dependencies: ${missing.join(', ')}`);
  }
}
