/**
 * Wallets Model - PLACEHOLDER
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IWallets extends Document {
  createdAt: Date;
  updatedAt: Date;
}

const WalletsSchema = new Schema<IWallets>(
  {},
  { timestamps: true }
);

export const WalletsModel = mongoose.model<IWallets>('Wallets', WalletsSchema);
