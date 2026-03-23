/**
 * Lambda Brain — Unit Tests for SQLite Database Layer
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrainDatabase } from '../src/database.js';
import { MemoryType, Sensitivity, type LambdaMemoryEntry } from '../src/types.js';

let db: BrainDatabase;
let tmpDbPath: string;

function makeEntry(overrides: Partial<LambdaMemoryEntry> = {}): LambdaMemoryEntry {
  const now = Math.floor(Date.now() / 1000);
  return {
    hash: `hash_${Math.random().toString(36).substring(2, 10)}`,
    created_at: now,
    last_accessed: now,
    access_count: 0,
    importance: 3,
    explicit_save: false,
    full_text: 'Full text content for testing.',
    summary_text: 'Summary text.',
    essence_text: 'Essence.',
    context_log: null,
    tags: ['test', 'unit'],
    memory_type: MemoryType.CONVERSATION,
    sensitivity: Sensitivity.PUBLIC,
    project: 'test-project',
    session_id: 'session_test',
    ...overrides,
  };
}

beforeEach(() => {
  tmpDbPath = path.join(os.tmpdir(), `brain_test_${Date.now()}.db`);
  db = new BrainDatabase(tmpDbPath);
});

afterEach(() => {
  db.close();
  try { fs.unlinkSync(tmpDbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(tmpDbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(tmpDbPath + '-shm'); } catch { /* ignore */ }
});

describe('BrainDatabase.store + queryCandidates', () => {
  it('should store and retrieve memories', () => {
    const e1 = makeEntry({ hash: 'hash_aaa', importance: 5 });
    const e2 = makeEntry({ hash: 'hash_bbb', importance: 2 });
    const e3 = makeEntry({ hash: 'hash_ccc', importance: 4 });

    db.store(e1);
    db.store(e2);
    db.store(e3);

    const results = db.queryCandidates(10);
    assert.equal(results.length, 3);
    // Should be ordered by importance DESC
    assert.equal(results[0].hash, 'hash_aaa');
    assert.equal(results[1].hash, 'hash_ccc');
    assert.equal(results[2].hash, 'hash_bbb');
  });

  it('should filter by project', () => {
    db.store(makeEntry({ hash: 'p1_a', project: 'alpha' }));
    db.store(makeEntry({ hash: 'p1_b', project: 'alpha' }));
    db.store(makeEntry({ hash: 'p2_a', project: 'beta' }));

    const alphas = db.queryCandidates(10, 'alpha');
    assert.equal(alphas.length, 2);
    alphas.forEach((e) => assert.equal(e.project, 'alpha'));
  });
});

describe('BrainDatabase.recall', () => {
  it('should recall by hash prefix', () => {
    db.store(makeEntry({ hash: 'abcdef1234567890', full_text: 'Secret sauce' }));

    const result = db.recall('abcdef');
    assert.ok(result);
    assert.equal(result.full_text, 'Secret sauce');
  });

  it('should return null for unknown hash', () => {
    const result = db.recall('zzzzz');
    assert.equal(result, null);
  });
});

describe('BrainDatabase.touch', () => {
  it('should update last_accessed and increment access_count', () => {
    const oldTime = Math.floor(Date.now() / 1000) - 3600;
    db.store(
      makeEntry({ hash: 'touch_test', last_accessed: oldTime, access_count: 0 })
    );

    db.touch('touch_test');

    const entry = db.getByHash('touch_test');
    assert.ok(entry);
    assert.ok(entry.last_accessed > oldTime);
    assert.equal(entry.access_count, 1);
  });
});

describe('BrainDatabase.ftsSearch', () => {
  it('should find memories by keyword', () => {
    db.store(
      makeEntry({
        hash: 'fts_1',
        summary_text: 'Authentication flow using JWT tokens',
        essence_text: 'JWT auth',
        tags: ['auth', 'security'],
      })
    );
    db.store(
      makeEntry({
        hash: 'fts_2',
        summary_text: 'Database schema design for users',
        essence_text: 'DB schema',
        tags: ['database'],
      })
    );

    const results = db.ftsSearch('JWT');
    assert.ok(results.length >= 1);
    assert.equal(results[0].hash, 'fts_1');
  });
});

describe('BrainDatabase.gc', () => {
  it('should remove old unimportant memories', () => {
    const veryOld = Math.floor(Date.now() / 1000) - 60 * 24 * 3600; // 60 days ago
    db.store(
      makeEntry({ hash: 'old_1', importance: 1, last_accessed: veryOld })
    );
    db.store(
      makeEntry({ hash: 'old_2', importance: 2, last_accessed: veryOld })
    );
    db.store(
      makeEntry({ hash: 'important', importance: 4, last_accessed: veryOld })
    );

    const deleted = db.gc();
    assert.equal(deleted, 2); // old_1 and old_2

    const remaining = db.queryCandidates(10);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].hash, 'important');
  });

  it('should keep explicitly saved memories', () => {
    const veryOld = Math.floor(Date.now() / 1000) - 60 * 24 * 3600;
    db.store(
      makeEntry({
        hash: 'saved',
        importance: 1,
        explicit_save: true,
        last_accessed: veryOld,
      })
    );

    const deleted = db.gc();
    assert.equal(deleted, 0);
  });
});

describe('BrainDatabase.stats', () => {
  it('should return correct statistics', () => {
    db.store(makeEntry({ hash: 's1', project: 'alpha', memory_type: MemoryType.DECISION }));
    db.store(makeEntry({ hash: 's2', project: 'alpha', memory_type: MemoryType.KNOWLEDGE }));
    db.store(makeEntry({ hash: 's3', project: 'beta', memory_type: MemoryType.DECISION }));

    const st = db.stats();
    assert.equal(st.total, 3);
    assert.equal(st.byProject['alpha'], 2);
    assert.equal(st.byProject['beta'], 1);
    assert.equal(st.byType['decision'], 2);
    assert.equal(st.byType['knowledge'], 1);
  });
});
