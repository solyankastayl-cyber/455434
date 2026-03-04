/**
 * Admin Models
 * 
 * MongoDB collection for admin users.
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { AdminRole, AdminUserDoc } from './admin.types.js';

const AdminUserSchema = new Schema<AdminUserDoc & Document>(
  {
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: { 
      type: String, 
      enum: ['ADMIN', 'MODERATOR'], 
      default: 'MODERATOR' 
    },
    isActive: { type: Boolean, default: true },
    createdAtTs: { type: Number, required: true },
    updatedAtTs: { type: Number, required: true },
    lastLoginTs: { type: Number },
  },
  {
    collection: 'admin_users',
  }
);

export const AdminUserModel = mongoose.models.AdminUser || 
  mongoose.model<AdminUserDoc & Document>('AdminUser', AdminUserSchema);

export default AdminUserModel;
