/**
 * Tokens Model - PLACEHOLDER
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ITokens extends Document {
  createdAt: Date;
  updatedAt: Date;
}

const TokensSchema = new Schema<ITokens>(
  {},
  { timestamps: true }
);

export const TokensModel = mongoose.model<ITokens>('Tokens', TokensSchema);
