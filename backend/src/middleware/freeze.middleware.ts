/**
 * PROD FREEZE MIDDLEWARE
 * 
 * Блокирует мутационные операции когда SYSTEM_FROZEN=true
 * Защищает систему от случайных изменений в production
 */

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';

// Паттерны запрещённых роутов в FREEZE режиме
const BLOCKED_PATTERNS = [
  // Lifecycle mutations
  '/api/lifecycle/promote',
  '/api/lifecycle/rollback',
  '/api/*/lifecycle/promote',
  '/api/*/lifecycle/rollback',
  '/api/fractal/v2.1/admin/lifecycle/promote',
  '/api/fractal/v2.1/admin/lifecycle/rollback',
  '/api/fractal/v2.1/admin/lifecycle/initialize',
  '/api/fractal/v2.1/admin/lifecycle/init',
  
  // Config mutations
  '/api/*/model-config',
  '/api/fractal/v2.1/admin/model-config',
  '/api/admin/model-config',
  
  // Seed operations
  '/api/admin/jobs/run?job=seed',
  '/api/fractal/v2.1/admin/seed',
  
  // Dev controls
  '/api/*/lifecycle/dev',
  '/api/fractal/v2.1/admin/lifecycle/drift',
  '/api/fractal/v2.1/admin/lifecycle/samples',
  '/api/fractal/v2.1/admin/lifecycle/constitution',
  '/api/fractal/v2.1/admin/lifecycle/integrity',
  
  // Initialize states
  '/api/lifecycle/init',
  '/api/*/lifecycle/init',
];

// Разрешённые job'ы в FREEZE режиме
const ALLOWED_JOBS = ['full', 'resolve_matured', 'health', 'health_check'];

export function isFrozen(): boolean {
  return process.env.SYSTEM_FROZEN === 'true' || process.env.FREEZE_MODE === 'true';
}

export function isBlockedRoute(url: string, method: string): boolean {
  // Только мутационные методы
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return false;
  }
  
  // Специальная проверка для jobs — сначала, до проверки паттернов
  if (url.includes('/api/admin/jobs/run')) {
    const jobMatch = url.match(/job=([^&]+)/);
    if (jobMatch) {
      const jobName = jobMatch[1];
      // Разрешаем безопасные job'ы
      if (ALLOWED_JOBS.includes(jobName)) {
        return false; // НЕ блокируем
      }
      // Блокируем seed и другие опасные job'ы
      if (jobName.startsWith('seed') || jobName === 'backfill' || jobName === 'reset') {
        return true;
      }
      // Блокируем неизвестные job'ы
      return true;
    }
  }
  
  // Проверка паттернов
  const normalizedUrl = url.split('?')[0]; // Убираем query params для проверки паттернов
  
  for (const pattern of BLOCKED_PATTERNS) {
    const patternBase = pattern.split('?')[0];
    
    // Простое сравнение с wildcard
    if (patternBase.includes('*')) {
      const regex = new RegExp('^' + patternBase.replace(/\*/g, '[^/]+') + '$');
      if (regex.test(normalizedUrl)) {
        return true;
      }
    } else if (normalizedUrl === patternBase || normalizedUrl.startsWith(patternBase)) {
      return true;
    }
  }
  
  return false;
}

export function registerFreezeMiddleware(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isFrozen()) {
      return; // Не в режиме заморозки
    }
    
    const url = request.url;
    const method = request.method;
    
    if (isBlockedRoute(url, method)) {
      console.log(`[FREEZE] Blocked: ${method} ${url}`);
      return reply.status(403).send({
        ok: false,
        error: 'SYSTEM_FROZEN',
        message: 'Система заморожена. Мутационные операции запрещены.',
        blockedRoute: url,
        hint: 'Для разблокировки установите SYSTEM_FROZEN=false в .env'
      });
    }
  });
  
  // Эндпоинт для проверки статуса заморозки
  app.get('/api/admin/freeze-status', async () => ({
    frozen: isFrozen(),
    blockedPatterns: BLOCKED_PATTERNS.length,
    allowedJobs: ALLOWED_JOBS,
    env: {
      SYSTEM_FROZEN: process.env.SYSTEM_FROZEN || 'false',
      FREEZE_MODE: process.env.FREEZE_MODE || 'false',
      APP_MODE: process.env.APP_MODE || 'development'
    }
  }));
  
  console.log(`[Freeze Middleware] Registered. FROZEN=${isFrozen()}`);
}
