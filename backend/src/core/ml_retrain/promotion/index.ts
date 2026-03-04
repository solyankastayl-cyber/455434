/**
 * BATCH 4: Promotion Module
 * 
 * Безопасный promotion (SHADOW → ACTIVE) и rollback.
 * ACTIVE меняется ТОЛЬКО через этот модуль.
 */

export { PromotionService, type PromotionResult } from './promotion.service.js';
export { adminMlPromotionRoutes } from './admin.ml.promotion.routes.js';
