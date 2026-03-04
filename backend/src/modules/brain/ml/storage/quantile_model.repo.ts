/**
 * P8.0-B2 — Quantile Model Repository
 * 
 * Save/load trained model weights from MongoDB.
 */

import { getMongoDb } from '../../../../db/mongoose.js';
import { ModelDocument, TrainedModelWeights } from '../contracts/quantile_train.contract.js';
import * as crypto from 'crypto';

const COLLECTION = 'brain_quantile_models';

export class QuantileModelRepo {
  
  private get col() {
    return getMongoDb()!.collection(COLLECTION);
  }
  
  /**
   * Save trained model weights
   */
  async save(weights: TrainedModelWeights): Promise<string> {
    const weightsId = `weights_${weights.asset}_${crypto.randomBytes(6).toString('hex')}`;
    
    const doc: ModelDocument = {
      asset: weights.asset,
      modelVersion: weights.modelVersion,
      weightsId,
      trainedAt: weights.trainedAt,
      weights,
      active: true,
      createdAt: new Date().toISOString(),
    };
    
    // Deactivate previous models for this asset
    await this.col.updateMany(
      { asset: weights.asset, active: true },
      { $set: { active: false } }
    );
    
    // Insert new model
    await this.col.insertOne(doc as any);
    
    console.log(`[QuantileModelRepo] Saved model ${weightsId} for ${weights.asset}`);
    return weightsId;
  }
  
  /**
   * Load active model for asset
   */
  async loadActive(asset: string): Promise<TrainedModelWeights | null> {
    const doc = await this.col.findOne(
      { asset, active: true },
      { projection: { _id: 0 } }
    ) as unknown as ModelDocument | null;
    
    return doc?.weights ?? null;
  }
  
  /**
   * Load model by weightsId
   */
  async loadById(weightsId: string): Promise<TrainedModelWeights | null> {
    const doc = await this.col.findOne(
      { weightsId },
      { projection: { _id: 0 } }
    ) as unknown as ModelDocument | null;
    
    return doc?.weights ?? null;
  }
  
  /**
   * Get status info for asset
   */
  async getStatus(asset: string): Promise<{
    available: boolean;
    weightsId: string | null;
    trainedAt: string | null;
    modelVersion: string | null;
  }> {
    const doc = await this.col.findOne(
      { asset, active: true },
      { projection: { _id: 0, weightsId: 1, trainedAt: 1, modelVersion: 1 } }
    ) as unknown as Partial<ModelDocument> | null;
    
    return {
      available: !!doc,
      weightsId: doc?.weightsId ?? null,
      trainedAt: doc?.trainedAt ?? null,
      modelVersion: doc?.modelVersion ?? null,
    };
  }
}

// Singleton
let instance: QuantileModelRepo | null = null;

export function getQuantileModelRepo(): QuantileModelRepo {
  if (!instance) {
    instance = new QuantileModelRepo();
  }
  return instance;
}
