import mongoose from 'mongoose';
import { env } from '../config/env.js';

export async function connectMongo(): Promise<void> {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    console.log('[MongoDB] Connected');
  });

  mongoose.connection.on('error', (err) => {
    console.error('[MongoDB] Connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('[MongoDB] Disconnected');
  });

  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false, // Prevent duplicate index warnings
  });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

export function getMongoDb() {
  return mongoose.connection.db;
}

export { mongoose };
