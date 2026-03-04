/**
 * Actor Sources Model (P1.1)
 * 
 * For audit and explainability of actor data origins.
 * Tracks where each actor's data came from.
 */
import mongoose, { Schema, Document } from 'mongoose';

export type SourceType = 'etherscan' | 'label_db' | 'manual' | 'import' | 'behavioral';

export interface IActorSource extends Document {
  actorId: string;
  sourceType: SourceType;
  confidence: number;           // 0-1
  sourceUrl?: string;           // Reference URL if any
  importedAt: Date;
  importedBy?: string;          // User or system
  notes?: string;
}

const ActorSourceSchema = new Schema<IActorSource>({
  actorId: { 
    type: String, 
    required: true, 
    index: true 
  },
  sourceType: { 
    type: String, 
    enum: ['etherscan', 'label_db', 'manual', 'import', 'behavioral'],
    required: true 
  },
  confidence: { 
    type: Number, 
    default: 0.8,
    min: 0,
    max: 1
  },
  sourceUrl: String,
  importedAt: { 
    type: Date, 
    default: Date.now 
  },
  importedBy: String,
  notes: String,
}, {
  timestamps: true,
  collection: 'actor_sources'
});

ActorSourceSchema.index({ actorId: 1, sourceType: 1 });

export const ActorSourceModel = mongoose.model<IActorSource>('ActorSource', ActorSourceSchema);
