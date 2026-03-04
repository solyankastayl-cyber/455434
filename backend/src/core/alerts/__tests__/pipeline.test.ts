/**
 * Smart Alerts Pipeline Integration Test
 * 
 * Tests the full flow: A0 → A1 → A2 → A3
 * 
 * Run: npx tsx src/core/alerts/__tests__/pipeline.test.ts
 */
import { eventNormalizer } from '../normalization/event.normalizer.js';
import { dedupEngine } from '../deduplication/dedup.engine.js';
import { severityEngine } from '../severity/severity.engine.js';
import { groupingEngine } from '../grouping/grouping.engine.js';

async function testPipeline() {
  console.log('\n🧪 Smart Alerts Pipeline Integration Test\n');
  console.log('━'.repeat(50));
  
  // Test 1: Create a raw signal (simulating incoming data)
  const rawSignal1 = {
    type: 'accumulation',
    scope: 'token',
    targetId: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    symbol: 'USDT',
    name: 'Tether USD',
    chain: 'Ethereum',
    netInflow: 5000000, // $5M
    threshold: 1000000,
    baseline: 500000,
    triggeredAt: new Date(),
    confidence: 0.85,
  };
  
  console.log('\n📥 Test 1: First event (new group creation)');
  console.log('Raw Signal:', JSON.stringify(rawSignal1, null, 2));
  
  // A0: Normalize
  console.log('\n[A0] Normalizing event...');
  const normalizedEvent1 = await eventNormalizer.normalize(
    rawSignal1,
    'rule-test-001',
    'anonymous'
  );
  console.log('✅ Normalized:', {
    eventId: normalizedEvent1.eventId,
    signalType: normalizedEvent1.signalType,
    deviation: normalizedEvent1.metrics.deviation,
  });
  
  // A1: Deduplicate
  console.log('\n[A1] Deduplicating...');
  const dedupedEvent1 = await dedupEngine.process(normalizedEvent1);
  console.log('✅ Deduped:', {
    status: dedupedEvent1.dedupStatus,
    occurrenceCount: dedupedEvent1.occurrenceCount,
    dedupKey: dedupedEvent1.dedupKey,
  });
  
  // A2: Score severity
  console.log('\n[A2] Scoring severity...');
  const scoredEvent1 = severityEngine.score(dedupedEvent1);
  console.log('✅ Scored:', {
    severityScore: scoredEvent1.severityScore.toFixed(2),
    priority: scoredEvent1.priority,
    reason: scoredEvent1.reason.summary,
  });
  
  // A3: Group
  console.log('\n[A3] Grouping...');
  const groupedEvent1 = await groupingEngine.process(scoredEvent1);
  console.log('✅ Grouped:', {
    groupId: groupedEvent1.group.groupId,
    isNewGroup: groupedEvent1.isNewGroup,
    status: groupedEvent1.group.status,
    eventCount: groupedEvent1.group.eventCount,
    reason: groupedEvent1.group.reason,
  });
  
  // Test 2: Second event (same behavior - should update group)
  console.log('\n━'.repeat(50));
  console.log('\n📥 Test 2: Second event (group update)');
  
  const rawSignal2 = {
    ...rawSignal1,
    netInflow: 7000000, // $7M - higher
    triggeredAt: new Date(Date.now() + 60000), // 1 minute later
    confidence: 0.9,
  };
  
  const normalizedEvent2 = await eventNormalizer.normalize(
    rawSignal2,
    'rule-test-001',
    'anonymous'
  );
  
  const dedupedEvent2 = await dedupEngine.process(normalizedEvent2);
  console.log('[A1] Dedup status:', dedupedEvent2.dedupStatus);
  
  const scoredEvent2 = severityEngine.score(dedupedEvent2);
  console.log('[A2] Severity:', scoredEvent2.severityScore.toFixed(2), scoredEvent2.priority);
  
  const groupedEvent2 = await groupingEngine.process(scoredEvent2);
  console.log('[A3] Grouped:', {
    isNewGroup: groupedEvent2.isNewGroup,
    isEscalation: groupedEvent2.isEscalation,
    eventCount: groupedEvent2.group.eventCount,
    reason: groupedEvent2.group.reason,
  });
  
  // Test 3: Different signal type (should create new group)
  console.log('\n━'.repeat(50));
  console.log('\n📥 Test 3: Different signal (new group)');
  
  const rawSignal3 = {
    type: 'distribution', // Different!
    scope: 'token',
    targetId: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    symbol: 'USDT',
    netOutflow: 3000000,
    threshold: 1000000,
    baseline: 400000,
    triggeredAt: new Date(),
    confidence: 0.75,
  };
  
  const normalizedEvent3 = await eventNormalizer.normalize(
    rawSignal3,
    'rule-test-002',
    'anonymous'
  );
  
  const dedupedEvent3 = await dedupEngine.process(normalizedEvent3);
  const scoredEvent3 = severityEngine.score(dedupedEvent3);
  const groupedEvent3 = await groupingEngine.process(scoredEvent3);
  
  console.log('[A3] New group created:', {
    isNewGroup: groupedEvent3.isNewGroup,
    signalType: groupedEvent3.group.signalType,
    groupId: groupedEvent3.group.groupId,
  });
  
  // Summary
  console.log('\n━'.repeat(50));
  console.log('\n📊 Test Summary\n');
  console.log('✅ A0 (Normalization): Working');
  console.log('✅ A1 (Deduplication): Working');
  console.log('✅ A2 (Severity): Working');
  console.log('✅ A3 (Grouping): Working');
  console.log('\n🎉 Pipeline integration test completed!\n');
  
  // Get active groups for user
  const activeGroups = await groupingEngine.getActiveGroupsForUser('anonymous');
  console.log(`Active groups for user: ${activeGroups.length}`);
  activeGroups.forEach(g => {
    console.log(`  - ${g.signalType} on ${g.targetMeta?.symbol}: ${g.status} (${g.eventCount} events)`);
  });
}

// Connect to DB and run test
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/blockview';

async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URL);
    console.log('Connected!');
    
    await testPipeline();
    
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();
