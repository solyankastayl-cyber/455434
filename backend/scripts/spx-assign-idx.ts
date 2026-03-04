/**
 * SPX CANDLE INDEX ASSIGNMENT SCRIPT
 * 
 * B6.4.1-1 — Add idx field to spx_candles for deterministic outcome resolution
 * 
 * Run once: npx ts-node scripts/spx-assign-idx.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/fractal_dev';

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URL);
  
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection failed');
  }
  
  const col = db.collection('spx_candles');
  
  // Create index for idx field
  console.log('Creating indexes...');
  await col.createIndex({ symbol: 1, idx: 1 }, { unique: true, sparse: true });
  
  console.log('Fetching SPX candles sorted by date...');
  
  const cursor = col.find({ symbol: 'SPX' })
    .sort({ date: 1 })
    .project({ _id: 1 });
  
  let idx = 0;
  const bulkOps: any[] = [];
  let processed = 0;
  
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;
    
    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { idx } }
      }
    });
    
    idx++;
    processed++;
    
    if (bulkOps.length === 1000) {
      await col.bulkWrite(bulkOps, { ordered: false });
      bulkOps.length = 0;
      console.log(`Processed: ${processed}`);
    }
  }
  
  if (bulkOps.length > 0) {
    await col.bulkWrite(bulkOps, { ordered: false });
  }
  
  console.log('Done.');
  console.log(`Total indexed: ${processed}`);
  
  // Verification
  const stats = await col.aggregate([
    { $match: { symbol: 'SPX' } },
    {
      $group: {
        _id: null,
        minIdx: { $min: '$idx' },
        maxIdx: { $max: '$idx' },
        count: { $sum: 1 }
      }
    }
  ]).toArray();
  
  if (stats.length > 0) {
    console.log('Verification:');
    console.log(`  minIdx: ${stats[0].minIdx}`);
    console.log(`  maxIdx: ${stats[0].maxIdx}`);
    console.log(`  count: ${stats[0].count}`);
    console.log(`  expected maxIdx: ${stats[0].count - 1}`);
    console.log(`  valid: ${stats[0].maxIdx === stats[0].count - 1 ? '✓' : '✗'}`);
  }
  
  await mongoose.disconnect();
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
