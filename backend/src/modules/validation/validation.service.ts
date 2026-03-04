/**
 * C2.2 — Validation Service
 * ==========================
 * 
 * Service for computing and persisting validation results.
 */

import {
  validationEngine,
  ValidationResult,
  ExchangeVerdict,
  ExchangeInput,
} from './validation.engine.js';

import { ValidationResultModel, IValidationResultDoc } from './validation.model.js';
import { onchainPersistenceBuilder } from '../onchain/onchain.persistence.js';
import { deriveOnchainState, OnchainWindow } from '../onchain/onchain.contracts.js';

class ValidationService {
  /**
   * Compute validation for a symbol at t0
   * 
   * Requires both Exchange verdict and On-chain observation to exist.
   */
  async compute(
    symbol: string,
    exchangeVerdict: ExchangeVerdict,
    exchangeConfidence: number,
    t0?: number,
    window: OnchainWindow = '1h'
  ): Promise<{ ok: boolean; validation?: ValidationResult; error?: string }> {
    const effectiveT0 = t0 || Date.now();
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    // Get or create on-chain observation at t0
    let observation = await onchainPersistenceBuilder.getAt(normalizedSymbol, effectiveT0, window);
    
    if (!observation) {
      // Try to create observation
      const tickResult = await onchainPersistenceBuilder.tick(normalizedSymbol, effectiveT0, window, true);
      if (tickResult.ok && tickResult.observation) {
        observation = tickResult.observation;
      }
    }
    
    if (!observation) {
      return {
        ok: false,
        error: 'On-chain observation not available',
      };
    }
    
    // Compute validation
    const validation = validationEngine.validateWithObservation(
      normalizedSymbol,
      effectiveT0,
      exchangeVerdict,
      exchangeConfidence,
      observation
    );
    
    // Persist result
    await this.saveValidation(validation);
    
    return { ok: true, validation };
  }
  
  /**
   * Get latest validation for a symbol
   */
  async getLatest(symbol: string): Promise<ValidationResult | null> {
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    const doc = await ValidationResultModel.findOne(
      { symbol: normalizedSymbol },
      {},
      { sort: { t0: -1 } }
    );
    
    return doc ? this.docToResult(doc) : null;
  }
  
  /**
   * Get validation history for a symbol
   */
  async getHistory(
    symbol: string,
    from: number,
    to: number,
    limit: number = 100
  ): Promise<ValidationResult[]> {
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    const docs = await ValidationResultModel.find({
      symbol: normalizedSymbol,
      t0: { $gte: from, $lte: to },
    })
    .sort({ t0: -1 })
    .limit(limit);
    
    return docs.map(d => this.docToResult(d));
  }
  
  /**
   * Get aggregated statistics
   */
  async getStats(
    symbol: string,
    from: number,
    to: number
  ): Promise<{
    total: number;
    confirms: number;
    contradicts: number;
    noData: number;
    confirmRate: number;
    avgStrength: number;
  }> {
    const normalizedSymbol = symbol.toUpperCase().replace('-', '');
    
    const results = await ValidationResultModel.find({
      symbol: normalizedSymbol,
      t0: { $gte: from, $lte: to },
    }).lean();
    
    const total = results.length;
    const confirms = results.filter(r => r.validation.result === 'CONFIRMS').length;
    const contradicts = results.filter(r => r.validation.result === 'CONTRADICTS').length;
    const noData = results.filter(r => r.validation.result === 'NO_DATA').length;
    
    const usableResults = results.filter(r => r.integrity.usable);
    const avgStrength = usableResults.length > 0
      ? usableResults.reduce((sum, r) => sum + r.validation.strength, 0) / usableResults.length
      : 0;
    
    const usableTotal = confirms + contradicts;
    const confirmRate = usableTotal > 0 ? confirms / usableTotal : 0;
    
    return {
      total,
      confirms,
      contradicts,
      noData,
      confirmRate,
      avgStrength: Math.round(avgStrength * 100) / 100,
    };
  }
  
  /**
   * Save validation result to MongoDB
   */
  private async saveValidation(validation: ValidationResult): Promise<void> {
    try {
      await ValidationResultModel.findOneAndUpdate(
        { symbol: validation.symbol, t0: validation.t0 },
        validation,
        { upsert: true }
      );
    } catch (error) {
      if ((error as any).code !== 11000) {
        throw error;
      }
    }
  }
  
  /**
   * Convert MongoDB doc to ValidationResult
   */
  private docToResult(doc: IValidationResultDoc): ValidationResult {
    return {
      symbol: doc.symbol,
      t0: doc.t0,
      exchange: doc.exchange,
      onchain: doc.onchain,
      validation: doc.validation,
      integrity: doc.integrity,
      createdAt: doc.createdAt,
    };
  }
}

export const validationService = new ValidationService();

console.log('[C2.2] ValidationService loaded');
