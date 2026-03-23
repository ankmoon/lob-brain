/**
 * Lambda Brain — Unit Tests for Decay Engine
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decayScore,
  effectiveThresholds,
  selectFidelity,
  formatMemory,
  assembleContext,
} from '../src/decay.js';
import {
  Fidelity,
  MemoryType,
  Sensitivity,
  type LambdaMemoryEntry,
  type DecayThresholds,
  DEFAULT_CONFIG,
} from '../src/types.js';

// Helper to create a test entry
function makeEntry(overrides: Partial<LambdaMemoryEntry> = {}): LambdaMemoryEntry {
  const now = Math.floor(Date.now() / 1000);
  return {
    hash: 'abc1234567890def',
    created_at: now,
    last_accessed: now,
    access_count: 0,
    importance: 3,
    explicit_save: false,
    full_text: 'This is the full text of the memory.',
    summary_text: 'Summary of the memory.',
    essence_text: 'Memory essence',
    context_log: null,
    tags: ['test'],
    memory_type: MemoryType.CONVERSATION,
    sensitivity: Sensitivity.PUBLIC,
    project: 'test-project',
    session_id: 'session_1',
    ...overrides,
  };
}

describe('decayScore', () => {
  it('should return importance at t=0 (just accessed)', () => {
    const now = Math.floor(Date.now() / 1000);
    const entry = makeEntry({ importance: 4, last_accessed: now });
    const score = decayScore(entry, now, 0.01);
    assert.equal(score, 4); // e^0 = 1, so score = importance
  });

  it('should decay over time', () => {
    const now = Math.floor(Date.now() / 1000);
    const entry = makeEntry({
      importance: 4,
      last_accessed: now - 3600, // 1 hour ago
    });
    const score = decayScore(entry, now, 0.01);
    // Expected: 4 * e^(-0.01 * 1) ≈ 3.96
    assert.ok(score < 4);
    assert.ok(score > 3.9);
  });

  it('should decay significantly after 100 hours', () => {
    const now = Math.floor(Date.now() / 1000);
    const entry = makeEntry({
      importance: 4,
      last_accessed: now - 100 * 3600, // 100 hours ago
    });
    const score = decayScore(entry, now, 0.01);
    // Expected: 4 * e^(-0.01 * 100) = 4 * e^(-1) ≈ 1.47
    assert.ok(score < 2);
    assert.ok(score > 1);
  });

  it('should handle very old memories (near zero but not zero)', () => {
    const now = Math.floor(Date.now() / 1000);
    const entry = makeEntry({
      importance: 1,
      last_accessed: now - 1000 * 3600, // 1000 hours ago
    });
    const score = decayScore(entry, now, 0.01);
    assert.ok(score > 0); // Never truly gone
    assert.ok(score < 0.01);
  });
});

describe('selectFidelity', () => {
  const thresholds: DecayThresholds = DEFAULT_CONFIG.thresholds;

  it('returns HOT for high scores', () => {
    assert.equal(selectFidelity(3.0, thresholds), Fidelity.HOT);
  });

  it('returns WARM for medium scores', () => {
    assert.equal(selectFidelity(1.5, thresholds), Fidelity.WARM);
  });

  it('returns COOL for low scores', () => {
    assert.equal(selectFidelity(0.5, thresholds), Fidelity.COOL);
  });

  it('returns FADED for very low scores', () => {
    assert.equal(selectFidelity(0.05, thresholds), Fidelity.FADED);
  });

  it('returns GONE for near-zero scores', () => {
    assert.equal(selectFidelity(0.005, thresholds), Fidelity.GONE);
  });
});

describe('effectiveThresholds', () => {
  it('returns base thresholds at full budget', () => {
    const result = effectiveThresholds(8000, 8000, DEFAULT_CONFIG.thresholds);
    assert.equal(result.hot, DEFAULT_CONFIG.thresholds.hot);
  });

  it('raises thresholds when budget is tight', () => {
    const result = effectiveThresholds(1000, 8000, DEFAULT_CONFIG.thresholds);
    assert.ok(result.hot > DEFAULT_CONFIG.thresholds.hot);
    assert.ok(result.warm > DEFAULT_CONFIG.thresholds.warm);
  });
});

describe('formatMemory', () => {
  it('shows full text for HOT memories', () => {
    const entry = makeEntry();
    const output = formatMemory(entry, Fidelity.HOT, 3.5);
    assert.ok(output.includes('🔴'));
    assert.ok(output.includes(entry.full_text));
  });

  it('shows summary for WARM memories', () => {
    const entry = makeEntry();
    const output = formatMemory(entry, Fidelity.WARM, 1.5);
    assert.ok(output.includes('🟡'));
    assert.ok(output.includes(entry.summary_text));
    assert.ok(!output.includes(entry.full_text));
  });

  it('shows essence for COOL memories', () => {
    const entry = makeEntry();
    const output = formatMemory(entry, Fidelity.COOL, 0.5);
    assert.ok(output.includes('🔵'));
    assert.ok(output.includes(entry.essence_text));
  });

  it('returns empty string for GONE memories', () => {
    const entry = makeEntry();
    const output = formatMemory(entry, Fidelity.GONE, 0.001);
    assert.equal(output, '');
  });
});

describe('assembleContext', () => {
  it('assembles multiple memories within budget', () => {
    const now = Math.floor(Date.now() / 1000);
    const entries = [
      makeEntry({ hash: 'hash_a_1234567890', importance: 5, last_accessed: now }),
      makeEntry({ hash: 'hash_b_1234567890', importance: 3, last_accessed: now }),
      makeEntry({ hash: 'hash_c_1234567890', importance: 1, last_accessed: now - 500 * 3600 }),
    ];

    const context = assembleContext(entries, 0.01, DEFAULT_CONFIG.thresholds, 5000);
    assert.ok(context.includes('λ-Memory'));
    assert.ok(context.includes('hash_a')); // Highest importance
  });

  it('returns empty string with no candidates', () => {
    const context = assembleContext([], 0.01, DEFAULT_CONFIG.thresholds);
    assert.equal(context, '');
  });

  it('respects character budget', () => {
    const now = Math.floor(Date.now() / 1000);
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({
        hash: `hash_${i.toString().padStart(3, '0')}_longtext`,
        importance: 5,
        last_accessed: now,
        full_text: 'A'.repeat(500),
      })
    );

    const context = assembleContext(entries, 0.01, DEFAULT_CONFIG.thresholds, 2000);
    assert.ok(context.length <= 2500); // Some overhead for headers
  });
});
