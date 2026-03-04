/**
 * Entity Attribution Service (P2.2)
 * 
 * Applies Attribution Engine to entities and updates their classification
 */

import { EntityModel, IEntity } from '../entities/entities.model.js';
import { WalletProfileModel } from '../wallets/wallet_profile.model.js';
import { AttributionClaimModel } from './attribution_claims.model.js';
import { 
  attributeEntity, 
  walletProfileToMetrics, 
  AttributionResult,
  AttributionType,
  AttributionMetrics 
} from './attribution.engine.js';

export interface EntityAttributionResult {
  entityId: string;
  entitySlug: string;
  attribution: AttributionResult;
  addressesAnalyzed: number;
  updatedAt: Date;
}

class EntityAttributionService {
  /**
   * Run attribution analysis for a specific entity
   */
  async analyzeEntity(entitySlug: string): Promise<EntityAttributionResult | null> {
    // Find entity
    const entity = await EntityModel.findOne({ slug: entitySlug });
    if (!entity) return null;
    
    // Get all addresses for this entity
    const claims = await AttributionClaimModel.find({
      subjectType: 'entity',
      subjectId: entitySlug,
      status: { $in: ['confirmed', 'suspected'] }
    });
    
    if (claims.length === 0) {
      console.log(`[Attribution] No claims found for entity ${entitySlug}`);
      return null;
    }
    
    // Aggregate metrics from all addresses
    const aggregatedMetrics = await this.aggregateEntityMetrics(
      claims.map(c => c.address)
    );
    
    if (!aggregatedMetrics) {
      console.log(`[Attribution] No metrics available for entity ${entitySlug}`);
      return null;
    }
    
    // Run attribution engine
    const attribution = attributeEntity(aggregatedMetrics);
    
    // Update entity with attribution
    await this.updateEntityAttribution(entity, attribution);
    
    return {
      entityId: entity._id.toString(),
      entitySlug: entity.slug,
      attribution,
      addressesAnalyzed: claims.length,
      updatedAt: new Date(),
    };
  }
  
  /**
   * Aggregate metrics from multiple addresses
   */
  private async aggregateEntityMetrics(addresses: string[]): Promise<AttributionMetrics | null> {
    if (addresses.length === 0) return null;
    
    // Get wallet profiles for all addresses
    const profiles = await WalletProfileModel.find({
      address: { $in: addresses.map(a => a.toLowerCase()) }
    });
    
    if (profiles.length === 0) {
      // No profiles yet, return minimal metrics
      return {
        counterpartyCount: 0,
        counterpartyDiversity: 0,
        assetCount: 0,
        assetDiversity: 0,
        flowSymmetry: 0.5,
        inflowDominance: 0,
        outflowDominance: 0,
        avgTxSize: 0,
        maxTxSize: 0,
        txFrequency: 0,
        burstScore: 0,
        activeDays: 0,
        earlyCohortPct: 0,
        midCohortPct: 0,
        newCohortPct: 0,
        bridgeUsage: 0,
        hotColdRotation: false,
        contractInteractionPct: 0,
        depositClustering: false,
        dataQuality: 0.1,
      };
    }
    
    // Aggregate metrics
    let totalCounterparties = 0;
    let totalAssets = 0;
    let totalTxCount = 0;
    let totalInflow = 0;
    let totalOutflow = 0;
    let sumTxSize = 0;
    let maxTxSize = 0;
    let totalActiveDays = 0;
    let sumBurst = 0;
    let bridgeUsers = 0;
    let contractUsers = 0;
    let cexLike = 0;
    
    for (const profile of profiles) {
      totalCounterparties += profile.tokens.interactedCount;
      totalAssets += profile.tokens.interactedCount;
      totalTxCount += profile.activity.txCount;
      totalInflow += profile.flows.totalIn;
      totalOutflow += profile.flows.totalOut;
      sumTxSize += profile.flows.avgTxSize * profile.activity.txCount;
      maxTxSize = Math.max(maxTxSize, profile.flows.maxTxSize || 0);
      totalActiveDays += profile.activity.activeDays;
      sumBurst += profile.behavior.burstinessScore;
      
      if (profile.tags.includes('bridge-user')) bridgeUsers++;
      if (profile.tags.includes('contract')) contractUsers++;
      if (profile.tags.includes('cex-like')) cexLike++;
    }
    
    const profileCount = profiles.length;
    const avgTxSize = totalTxCount > 0 ? sumTxSize / totalTxCount : 0;
    const totalFlow = totalInflow + totalOutflow;
    const flowSymmetry = totalFlow > 0 ? totalInflow / totalFlow : 0.5;
    
    // Calculate diversities
    const counterpartyDiversity = Math.min(totalCounterparties / (profileCount * 50), 1.0);
    const assetDiversity = Math.min(totalAssets / (profileCount * 30), 1.0);
    
    // Hot/cold rotation detection (simple heuristic)
    const hotColdRotation = profiles.some(p => 
      p.tags.includes('cex-like') && totalOutflow > totalInflow * 0.5
    );
    
    return {
      counterpartyCount: Math.round(totalCounterparties / profileCount),
      counterpartyDiversity,
      assetCount: Math.round(totalAssets / profileCount),
      assetDiversity,
      flowSymmetry,
      inflowDominance: totalFlow > 0 ? totalInflow / totalFlow : 0,
      outflowDominance: totalFlow > 0 ? totalOutflow / totalFlow : 0,
      avgTxSize,
      maxTxSize,
      txFrequency: totalActiveDays > 0 ? totalTxCount / totalActiveDays : 0,
      burstScore: sumBurst / profileCount,
      activeDays: Math.round(totalActiveDays / profileCount),
      earlyCohortPct: 0, // TODO: Calculate from cohort service
      midCohortPct: 0,
      newCohortPct: 0,
      bridgeUsage: bridgeUsers / profileCount,
      hotColdRotation,
      contractInteractionPct: (contractUsers / profileCount) * 100,
      depositClustering: cexLike > profileCount * 0.5,
      dataQuality: 0.7, // Decent quality if we have profiles
    };
  }
  
  /**
   * Update entity with attribution result
   */
  private async updateEntityAttribution(
    entity: IEntity, 
    attribution: AttributionResult
  ): Promise<void> {
    // Map attribution type to entity category
    const categoryMap: Record<AttributionType, string> = {
      'exchange_like': 'exchange',
      'fund_like': 'fund',
      'market_maker_like': 'market_maker',
      'custody_like': 'custody',
      'unknown': 'unknown',
    };
    
    entity.category = categoryMap[attribution.attributionType] as any;
    entity.coverage = attribution.coverage;
    
    // Store attribution evidence
    if (!entity.attribution) {
      entity.attribution = {
        method: 'rule_based_engine',
        confidence: Math.max(...Object.values(attribution.scores)) * 100,
        evidence: attribution.evidence,
      };
    } else {
      entity.attribution.method = 'rule_based_engine';
      entity.attribution.confidence = Math.max(...Object.values(attribution.scores)) * 100;
      entity.attribution.evidence = attribution.evidence;
    }
    
    await entity.save();
    
    console.log(`[Attribution] Updated entity ${entity.slug}: ${attribution.attributionType} (coverage: ${attribution.coverage}%)`);
  }
  
  /**
   * Run attribution for all entities
   */
  async analyzeAllEntities(): Promise<EntityAttributionResult[]> {
    const entities = await EntityModel.find({});
    const results: EntityAttributionResult[] = [];
    
    for (const entity of entities) {
      const result = await this.analyzeEntity(entity.slug);
      if (result) {
        results.push(result);
      }
    }
    
    console.log(`[Attribution] Analyzed ${results.length} entities`);
    return results;
  }
  
  /**
   * Get attribution result for entity (without updating)
   */
  async getEntityAttribution(entitySlug: string): Promise<AttributionResult | null> {
    const entity = await EntityModel.findOne({ slug: entitySlug });
    if (!entity) return null;
    
    const claims = await AttributionClaimModel.find({
      subjectType: 'entity',
      subjectId: entitySlug,
      status: { $in: ['confirmed', 'suspected'] }
    });
    
    if (claims.length === 0) return null;
    
    const aggregatedMetrics = await this.aggregateEntityMetrics(
      claims.map(c => c.address)
    );
    
    if (!aggregatedMetrics) return null;
    
    return attributeEntity(aggregatedMetrics);
  }
}

export const entityAttributionService = new EntityAttributionService();
