/**
 * MongoDB Connection Helper
 * 
 * Provides access to native MongoDB Db instance for aggregations
 */

import { mongoose } from './mongoose.js';
import { Db } from 'mongodb';

/**
 * Get native MongoDB Db instance from Mongoose connection
 */
export function getDb(): Db {
  if (!mongoose.connection.db) {
    throw new Error('MongoDB not connected. Call connectMongo() first.');
  }
  return mongoose.connection.db;
}
