/**
 * A.3 - Twitter Admin Module
 * 
 * Admin Control Plane for Twitter Integration
 * Isolated from user-facing routes
 */

export { registerAdminTwitterRoutes } from './routes/admin.routes.js';
export { requireAdmin, isAdmin, getRequestAdmin } from './auth/require-admin.hook.js';
export { AdminUsersService } from './services/admin-users.service.js';
export { AdminUserDetailService } from './services/admin-user-detail.service.js';
export { AdminActionsService } from './services/admin-actions.service.js';
export { AdminActionLogModel } from './models/admin-action-log.model.js';
