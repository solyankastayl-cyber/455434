/**
 * Hypothesis Builder Tests
 * 
 * Tests for Phase B (Conflicts), C (Confluence), D (Builder)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHypotheses, defaultConflictResolver, groupPatternsByGroup } from '../hypothesis_builder.js';
import { PatternCandidate, GroupBucket } from '../hypothesis_types.js';
import { resolveConflicts, hasHardConflict } from '../../conflicts/conflict_engine.js';

function cand(partial: Partial<PatternCandidate>): PatternCandidate {
  return {
    id: partial.id ?? (partial.type ?? 'X'),
    type: partial.type ?? 'X',
    group: partial.group ?? 'G',
    direction: partial.direction ?? 'BOTH',
    baseScore: partial.baseScore ?? 0.5,
    finalScore: partial.finalScore ?? 0.5,
    exclusivityKey: partial.exclusivityKey ?? 'none',
    priority: partial.priority ?? 50,
    ...partial,
  };
}

// ═══════════════════════════════════════════════════════════════
// Phase B: Conflict Engine Tests
// ═══════════════════════════════════════════════════════════════

test('Phase B: ASC + DESC triangle conflict', () => {
  assert.ok(hasHardConflict('TRIANGLE_ASC', 'TRIANGLE_DESC'));
  assert.ok(hasHardConflict('TRIANGLE_DESC', 'TRIANGLE_ASC'));
});

test('Phase B: DOUBLE_TOP + DOUBLE_BOTTOM conflict', () => {
  assert.ok(hasHardConflict('DOUBLE_TOP', 'DOUBLE_BOTTOM'));
});

test('Phase B: CHANNEL_UP + CHANNEL_DOWN conflict', () => {
  assert.ok(hasHardConflict('CHANNEL_UP', 'CHANNEL_DOWN'));
});

test('Phase B: Non-conflicting patterns can coexist', () => {
  assert.ok(!hasHardConflict('TRIANGLE_ASC', 'DOUBLE_BOTTOM'));
  assert.ok(!hasHardConflict('CANDLE_HAMMER', 'FLAG_BULL'));
});

test('Phase B: resolveConflicts keeps highest score', () => {
  const patterns = [
    cand({ id: 'A', type: 'TRIANGLE_ASC', finalScore: 0.9 }),
    cand({ id: 'B', type: 'TRIANGLE_DESC', finalScore: 0.8 }),
  ];
  
  const result = resolveConflicts(patterns);
  
  assert.equal(result.kept.length, 1);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.kept[0].type, 'TRIANGLE_ASC');
  assert.equal(result.stats.hardConflicts, 1);
});

test('Phase B: exclusivityKey conflict', () => {
  const patterns = [
    cand({ id: 'A', type: 'TRIANGLE_ASC', finalScore: 0.9, exclusivityKey: 'triangle@tf' }),
    cand({ id: 'B', type: 'WEDGE_RISING', finalScore: 0.85, exclusivityKey: 'triangle@tf' }),
  ];
  
  const result = resolveConflicts(patterns);
  
  assert.equal(result.kept.length, 1);
  assert.equal(result.stats.exclusivityConflicts, 1);
});

// ═══════════════════════════════════════════════════════════════
// Phase D: Hypothesis Builder Tests
// ═══════════════════════════════════════════════════════════════

test('Phase D: Beam search limits hypotheses (no combinatorial explosion)', () => {
  // 10 groups x 5 candidates = naive 5^10 = 9,765,625 combinations
  const buckets: GroupBucket[] = [];
  for (let gi = 0; gi < 10; gi++) {
    const group = `G${gi}`;
    const candidates: PatternCandidate[] = [];
    for (let ci = 0; ci < 5; ci++) {
      candidates.push(cand({
        id: `${group}:${ci}`,
        type: `${group}_P${ci}`,
        group,
        direction: ci % 2 === 0 ? 'BULL' : 'BEAR',
        finalScore: 0.9 - ci * 0.1,
        exclusivityKey: `${group}@tf`,
      }));
    }
    buckets.push({ group, candidates });
  }
  
  const hyps = buildHypotheses('BTC', '1D', buckets, defaultConflictResolver(), {
    beamWidth: 20,
    perGroupK: 3,
    topN: 20,
    minComponents: 2,
  });
  
  assert.ok(hyps.length <= 20, `Expected <= 20, got ${hyps.length}`);
  assert.ok(hyps.every(h => h.components.length <= 10));
});

test('Phase D: 1 pattern per group rule', () => {
  const buckets: GroupBucket[] = [
    { group: 'TRIANGLES', candidates: [
      cand({ id: 'T1', type: 'TRIANGLE_ASC', group: 'TRIANGLES', finalScore: 0.9 }),
      cand({ id: 'T2', type: 'TRIANGLE_SYM', group: 'TRIANGLES', finalScore: 0.8 }),
    ]},
    { group: 'BREAKOUTS', candidates: [
      cand({ id: 'B1', type: 'LEVEL_BREAKOUT', group: 'BREAKOUTS', finalScore: 0.85 }),
    ]},
  ];
  
  const hyps = buildHypotheses('BTC', '1D', buckets, defaultConflictResolver(), {
    beamWidth: 10,
    perGroupK: 3,
    topN: 10,
    minComponents: 2,
  });
  
  // Each hypothesis should have at most 1 from TRIANGLES
  for (const h of hyps) {
    const triangles = h.components.filter(c => c.group === 'TRIANGLES');
    assert.ok(triangles.length <= 1);
  }
});

test('Phase D: Mixed directions apply penalty', () => {
  const buckets: GroupBucket[] = [
    { group: 'REVERSALS', candidates: [
      cand({ id: 'DT', type: 'DOUBLE_TOP', group: 'REVERSALS', direction: 'BEAR', finalScore: 0.9 }),
    ]},
    { group: 'OSCILLATORS', candidates: [
      cand({ id: 'DBR', type: 'DIVERGENCE_BULL_RSI', group: 'OSCILLATORS', direction: 'BULL', finalScore: 0.85 }),
      cand({ id: 'DR', type: 'DIVERGENCE_BEAR_RSI', group: 'OSCILLATORS', direction: 'BEAR', finalScore: 0.85 }),
    ]},
  ];
  
  const hyps = buildHypotheses('BTC', '1D', buckets, defaultConflictResolver(), {
    beamWidth: 20,
    perGroupK: 2,
    topN: 10,
    minComponents: 2,
  });
  
  assert.ok(hyps.length > 0);
  
  // Find consistent (BEAR+BEAR) vs mixed (BEAR+BULL)
  const bearBear = hyps.find(h => 
    h.components.every(c => c.direction === 'BEAR')
  );
  const mixed = hyps.find(h => 
    h.components.some(c => c.direction === 'BULL') && 
    h.components.some(c => c.direction === 'BEAR')
  );
  
  if (bearBear && mixed) {
    assert.ok(bearBear.score > mixed.score, 'Consistent direction should score higher');
  }
});

test('Phase D: Confluence bonus for geometry+breakout', () => {
  const buckets: GroupBucket[] = [
    { group: 'TRIANGLES', candidates: [
      cand({ id: 'T1', type: 'TRIANGLE_ASC', group: 'TRIANGLES', direction: 'BULL', finalScore: 0.8 }),
    ]},
    { group: 'BREAKOUTS', candidates: [
      cand({ id: 'B1', type: 'LEVEL_BREAKOUT', group: 'BREAKOUTS', direction: 'BULL', finalScore: 0.75 }),
    ]},
    { group: 'OTHER', candidates: [
      cand({ id: 'O1', type: 'OTHER_PATTERN', group: 'OTHER', direction: 'BULL', finalScore: 0.75 }),
    ]},
  ];
  
  const hyps = buildHypotheses('BTC', '1D', buckets, defaultConflictResolver(), {
    beamWidth: 10,
    perGroupK: 3,
    topN: 10,
    minComponents: 2,
  });
  
  // Hypothesis with triangle+breakout should exist and have bonus
  const withBonus = hyps.find(h => 
    h.components.some(c => c.type === 'TRIANGLE_ASC') &&
    h.components.some(c => c.type === 'LEVEL_BREAKOUT')
  );
  
  assert.ok(withBonus, 'Should find hypothesis with geometry+breakout');
  assert.ok(withBonus.reasons.some(r => r.includes('geometry+breakout')));
});
