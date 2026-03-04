/**
 * Synthetic Dataset Builder Service - P0.1
 * 
 * Generates synthetic datasets through noise injection and time-shifting
 */
import { MongoClient } from 'mongodb';
import { DatasetSyntheticMeta } from '../models/dataset_synthetic_meta.model.js';
import { DatasetMarketMeta } from '../models/dataset_market_meta.model.js';
import { applyNoiseToRow, timeShiftRow } from '../utils/synthetic_noise.js';
import { deduplicateRows } from '../utils/dataset_hash.js';

export interface SyntheticDatasetParams {
  sourceDatasetId: string;
  multiplier: number;
  noisePct: number;
  seed: number;
  timeShiftBuckets?: number[];
  maxRows?: number;
}

export interface SyntheticDatasetResult {
  datasetId: string;
  sourceDatasetId: string;
  rowsGenerated: number;
  rowsOriginal: number;
  deduplicatedRows: number;
}

export class SyntheticDatasetBuilderService {
  private mongoUrl: string;
  
  constructor(mongoUrl?: string) {
    this.mongoUrl = mongoUrl || process.env.MONGO_URL || 'mongodb://localhost:27017';
  }
  
  /**
   * Build synthetic dataset from source
   */
  async buildSyntheticDataset(params: SyntheticDatasetParams): Promise<SyntheticDatasetResult> {
    const {
      sourceDatasetId,
      multiplier,
      noisePct,
      seed,
      timeShiftBuckets = [0],
      maxRows = 1000,
    } = params;
    
    console.log(`[Synthetic] Building synthetic dataset from ${sourceDatasetId}`);
    console.log(`[Synthetic] Multiplier: ${multiplier}x, Noise: ${noisePct}%, Seed: ${seed}`);
    
    // Validate source dataset exists
    const sourceMeta = await DatasetMarketMeta.findOne({ datasetId: sourceDatasetId }).lean();
    if (!sourceMeta) {
      throw new Error(`Source dataset not found: ${sourceDatasetId}`);
    }
    
    // Load source rows
    const sourceRows = await this.loadDatasetRows(sourceDatasetId);
    
    if (sourceRows.length === 0) {
      throw new Error(`Source dataset has no rows: ${sourceDatasetId}`);
    }
    
    console.log(`[Synthetic] Source rows: ${sourceRows.length}`);
    
    // Generate synthetic rows
    const syntheticRows: any[] = [];
    
    for (let i = 0; i < multiplier; i++) {
      for (const timeShift of timeShiftBuckets) {
        for (const sourceRow of sourceRows) {
          // Apply transformations
          let newRow = { ...sourceRow };
          
          // Time shift
          if (timeShift !== 0) {
            newRow = timeShiftRow(newRow, timeShift);
          }
          
          // Apply noise
          newRow = applyNoiseToRow(newRow, noisePct, seed + i);
          
          syntheticRows.push(newRow);
          
          // Safety limit
          if (syntheticRows.length >= maxRows) {
            break;
          }
        }
        
        if (syntheticRows.length >= maxRows) {
          break;
        }
      }
      
      if (syntheticRows.length >= maxRows) {
        break;
      }
    }
    
    console.log(`[Synthetic] Generated rows (before dedup): ${syntheticRows.length}`);
    
    // Deduplicate
    const uniqueRows = deduplicateRows(syntheticRows);
    
    console.log(`[Synthetic] Unique rows (after dedup): ${uniqueRows.length}`);
    
    // Generate new dataset ID
    const timestamp = Date.now();
    const newDatasetId = `synthetic_${sourceDatasetId}_${timestamp}`;
    
    // Update rows with new datasetId
    const finalRows = uniqueRows.map(row => ({
      ...row,
      datasetId: newDatasetId,
      _syntheticSource: sourceDatasetId,
      _syntheticSeed: seed,
    }));
    
    // Save synthetic rows
    await this.saveDatasetRows(newDatasetId, finalRows);
    
    // Save synthetic meta
    await DatasetSyntheticMeta.create({
      datasetId: newDatasetId,
      sourceDatasetId,
      multiplier,
      noisePct,
      timeShiftBuckets,
      seed,
      method: 'bootstrap_v1',
      rowsGenerated: finalRows.length,
    });
    
    // Create dataset meta (compatible with existing system)
    await DatasetMarketMeta.create({
      datasetId: newDatasetId,
      network: sourceMeta.network,
      task: sourceMeta.task || 'market',
      version: 'v3.0-synthetic',
      packAIncluded: sourceMeta.packAIncluded,
      dexIncluded: sourceMeta.dexIncluded || false,
      rows: finalRows.length,
      featureColumns: sourceMeta.featureColumns || [],
      builtAt: new Date(),
      buildDurationMs: 0,
      featurePack: sourceMeta.featurePack,
    });
    
    console.log(`[Synthetic] Saved synthetic dataset: ${newDatasetId}`);
    
    return {
      datasetId: newDatasetId,
      sourceDatasetId,
      rowsGenerated: finalRows.length,
      rowsOriginal: sourceRows.length,
      deduplicatedRows: syntheticRows.length - uniqueRows.length,
    };
  }
  
  /**
   * Load dataset rows from MongoDB
   */
  private async loadDatasetRows(datasetId: string): Promise<any[]> {
    const client = new MongoClient(this.mongoUrl);
    
    try {
      await client.connect();
      const db = client.db('blockview');
      const rows = await db
        .collection('dataset_market_v3')
        .find({ datasetId })
        .project({ _id: 0 })
        .toArray();
      
      return rows;
    } finally {
      await client.close();
    }
  }
  
  /**
   * Save dataset rows to MongoDB
   */
  private async saveDatasetRows(datasetId: string, rows: any[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    
    const client = new MongoClient(this.mongoUrl);
    
    try {
      await client.connect();
      const db = client.db('blockview');
      await db.collection('dataset_market_v3').insertMany(rows);
    } finally {
      await client.close();
    }
  }
  
  /**
   * List synthetic datasets
   */
  async listSyntheticDatasets(sourceDatasetId?: string, limit = 20): Promise<any[]> {
    const query: any = {};
    if (sourceDatasetId) {
      query.sourceDatasetId = sourceDatasetId;
    }
    
    return DatasetSyntheticMeta.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
  
  /**
   * Get synthetic dataset meta
   */
  async getSyntheticMeta(datasetId: string): Promise<any | null> {
    return DatasetSyntheticMeta.findOne({ datasetId }).lean();
  }
}

export default SyntheticDatasetBuilderService;
