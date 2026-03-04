/**
 * SEED PREDICTION SNAPSHOTS
 * 
 * Creates sample prediction history data for demonstration.
 * Run: node seed_snapshots.js
 */

const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'fractal_platform';

async function seedSnapshots() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  
  const db = client.db(DB_NAME);
  const collection = db.collection('prediction_snapshots');
  
  // Create indexes
  await collection.createIndex({ asset: 1, view: 1, horizonDays: 1, asOf: -1 });
  
  // Get current SPX price from candles
  const spxCandles = db.collection('spx_candles');
  const latestCandle = await spxCandles.findOne({}, { sort: { date: -1 } });
  const currentPrice = latestCandle?.close || 6000;
  
  console.log(`Current SPX price: ${currentPrice}`);
  
  // Generate snapshots for the last 6 months
  const snapshots = [];
  const now = new Date();
  
  // Sample stances that show model evolution
  const stanceHistory = [
    { monthsAgo: 6, stance: 'BEARISH', confidence: 0.65, drift: -0.08 },
    { monthsAgo: 5, stance: 'BEARISH', confidence: 0.55, drift: -0.05 },
    { monthsAgo: 4, stance: 'HOLD', confidence: 0.45, drift: 0.02 },
    { monthsAgo: 3, stance: 'HOLD', confidence: 0.50, drift: 0.03 },
    { monthsAgo: 2, stance: 'BULLISH', confidence: 0.60, drift: 0.06 },
    { monthsAgo: 1, stance: 'HOLD', confidence: 0.52, drift: 0.02 },
  ];
  
  for (const { monthsAgo, stance, confidence, drift } of stanceHistory) {
    const asOf = new Date(now);
    asOf.setMonth(asOf.getMonth() - monthsAgo);
    
    const asOfPrice = currentPrice * (1 - drift * (monthsAgo / 3));
    
    // Generate prediction series (180 days forward from asOf)
    const series = [];
    const startDate = new Date(asOf);
    
    for (let day = 0; day <= 180; day += 7) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + day);
      
      // Prediction with some noise
      const trend = stance === 'BULLISH' ? 0.0003 : stance === 'BEARISH' ? -0.0002 : 0.0001;
      const noise = (Math.random() - 0.5) * 0.002;
      const price = asOfPrice * (1 + (trend + noise) * day);
      
      series.push({
        t: date.toISOString(),
        v: Math.round(price * 100) / 100
      });
    }
    
    const hash = require('crypto')
      .createHash('sha256')
      .update(JSON.stringify({ series, stance, confidence }))
      .digest('hex')
      .slice(0, 16);
    
    snapshots.push({
      asset: 'SPX',
      view: 'crossAsset',
      horizonDays: 180,
      asOf: asOf.toISOString(),
      asOfPrice: Math.round(asOfPrice * 100) / 100,
      series,
      metadata: {
        stance,
        confidence,
        quality: 0.7 + Math.random() * 0.2,
        modelVersion: 'v3.1.0'
      },
      hash,
      createdAt: asOf.toISOString()
    });
  }
  
  // Also create for DXY and BTC
  for (const asset of ['DXY', 'BTC']) {
    const basePrice = asset === 'DXY' ? 104 : 95000;
    
    for (let i = 0; i < 4; i++) {
      const asOf = new Date(now);
      asOf.setMonth(asOf.getMonth() - (i + 1));
      
      const stance = i % 3 === 0 ? 'BULLISH' : i % 3 === 1 ? 'BEARISH' : 'HOLD';
      const confidence = 0.45 + Math.random() * 0.25;
      
      const series = [];
      for (let day = 0; day <= 180; day += 7) {
        const date = new Date(asOf);
        date.setDate(date.getDate() + day);
        const trend = stance === 'BULLISH' ? 0.0002 : stance === 'BEARISH' ? -0.0002 : 0;
        const price = basePrice * (1 + trend * day + (Math.random() - 0.5) * 0.01);
        series.push({ t: date.toISOString(), v: Math.round(price * 100) / 100 });
      }
      
      const hash = require('crypto')
        .createHash('sha256')
        .update(JSON.stringify({ series, stance, confidence }))
        .digest('hex')
        .slice(0, 16);
      
      snapshots.push({
        asset,
        view: asset === 'DXY' ? 'macro' : 'crossAsset',
        horizonDays: 180,
        asOf: asOf.toISOString(),
        asOfPrice: basePrice,
        series,
        metadata: { stance, confidence, quality: 0.65, modelVersion: 'v3.1.0' },
        hash,
        createdAt: asOf.toISOString()
      });
    }
  }
  
  // Clear existing and insert
  await collection.deleteMany({ metadata: { $exists: true } });
  await collection.insertMany(snapshots);
  
  console.log(`Seeded ${snapshots.length} prediction snapshots`);
  console.log('Assets:', [...new Set(snapshots.map(s => s.asset))].join(', '));
  
  await client.close();
}

seedSnapshots().catch(console.error);
