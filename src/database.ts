/**
 * Lambda Brain — SQLite Storage Layer
 *
 * Wraps better-sqlite3 to provide typed CRUD + FTS5 search for λ-memories.
 * Uses WAL mode for concurrent reads from multiple SSE clients.
 */

import Database from 'better-sqlite3';
import {
  type LambdaMemoryEntry,
  type LambdaMemoryRow,
  rowToEntry,
  Sensitivity,
} from './types.js';

export class BrainDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  // --- Schema ---

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lambda_memories (
        hash            TEXT PRIMARY KEY,
        created_at      INTEGER NOT NULL,
        last_accessed   INTEGER NOT NULL,
        access_count    INTEGER NOT NULL DEFAULT 0,
        importance      REAL NOT NULL DEFAULT 1.0,
        explicit_save   INTEGER NOT NULL DEFAULT 0,
        full_text       TEXT NOT NULL,
        summary_text    TEXT NOT NULL,
        essence_text    TEXT NOT NULL,
        context_log     TEXT,
        tags            TEXT NOT NULL DEFAULT '[]',
        memory_type     TEXT NOT NULL DEFAULT 'conversation',
        sensitivity     TEXT NOT NULL DEFAULT 'public',
        project         TEXT DEFAULT NULL,
        session_id      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_project
        ON lambda_memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_importance
        ON lambda_memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_last_accessed
        ON lambda_memories(last_accessed DESC);

      -- Phase 2: File snapshot cache
      CREATE TABLE IF NOT EXISTS file_snapshots (
        hash        TEXT PRIMARY KEY,
        path        TEXT NOT NULL UNIQUE,
        project     TEXT,
        summary     TEXT,
        essence     TEXT,
        size_bytes  INTEGER,
        file_hash   TEXT,
        captured_at INTEGER NOT NULL,
        last_seen   INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_project
        ON file_snapshots(project);

      -- Phase 1: Chat session history
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id          TEXT PRIMARY KEY,
        memory_hash TEXT,
        project     TEXT,
        title       TEXT,
        turns       TEXT NOT NULL,
        token_count INTEGER,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project
        ON chat_sessions(project);
    `);

    // Phase 6: Add embedding column (safe migration — ALTER TABLE IF NOT EXISTS not supported, so try/catch)
    try {
      this.db.exec(`ALTER TABLE lambda_memories ADD COLUMN embedding BLOB DEFAULT NULL`);
    } catch {
      // Column already exists — ignore
    }

    // Phase 9: Add owner_id column for multi-user permission
    try {
      this.db.exec(`ALTER TABLE lambda_memories ADD COLUMN owner_id TEXT DEFAULT 'default'`);
    } catch {
      // Column already exists — ignore
    }
    // Ensure index for owner_id queries
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_owner ON lambda_memories(owner_id)`);


    // FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS lambda_memories_fts
      USING fts5(
        summary_text, essence_text, tags,
        content='lambda_memories', content_rowid='rowid'
      );
    `);

    // Triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS lambda_memories_ai AFTER INSERT ON lambda_memories BEGIN
        INSERT INTO lambda_memories_fts(rowid, summary_text, essence_text, tags)
        VALUES (new.rowid, new.summary_text, new.essence_text, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS lambda_memories_ad AFTER DELETE ON lambda_memories BEGIN
        INSERT INTO lambda_memories_fts(lambda_memories_fts, rowid, summary_text, essence_text, tags)
        VALUES ('delete', old.rowid, old.summary_text, old.essence_text, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS lambda_memories_au AFTER UPDATE ON lambda_memories BEGIN
        INSERT INTO lambda_memories_fts(lambda_memories_fts, rowid, summary_text, essence_text, tags)
        VALUES ('delete', old.rowid, old.summary_text, old.essence_text, old.tags);
        INSERT INTO lambda_memories_fts(rowid, summary_text, essence_text, tags)
        VALUES (new.rowid, new.summary_text, new.essence_text, new.tags);
      END;
    `);
  }

  // --- CRUD ---

  /** Store or replace a memory entry. */
  store(entry: LambdaMemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO lambda_memories
        (hash, created_at, last_accessed, access_count, importance,
         explicit_save, full_text, summary_text, essence_text, context_log,
         tags, memory_type, sensitivity, project, session_id, owner_id)
      VALUES
        (@hash, @created_at, @last_accessed, @access_count, @importance,
         @explicit_save, @full_text, @summary_text, @essence_text, @context_log,
         @tags, @memory_type, @sensitivity, @project, @session_id, @owner_id)
    `);

    stmt.run({
      hash: entry.hash,
      created_at: entry.created_at,
      last_accessed: entry.last_accessed,
      access_count: entry.access_count,
      importance: entry.importance,
      explicit_save: entry.explicit_save ? 1 : 0,
      full_text: entry.full_text,
      summary_text: entry.summary_text,
      essence_text: entry.essence_text,
      context_log: entry.context_log,
      tags: JSON.stringify(entry.tags),
      memory_type: entry.memory_type,
      sensitivity: entry.sensitivity,
      project: entry.project,
      session_id: entry.session_id,
      owner_id: entry.owner_id || 'default',
    });
  }

  /** Update an existing memory (Phase 5). */
  update(hash: string, updates: Partial<LambdaMemoryEntry>): void {
    const fields: string[] = [];
    const params: Record<string, any> = { hash };

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'hash') continue;
      fields.push(`${key} = @${key}`);
      params[key] = Array.isArray(value) ? JSON.stringify(value) : value;
    }

    if (fields.length === 0) return;

    this.db
      .prepare(`UPDATE lambda_memories SET ${fields.join(', ')} WHERE hash = @hash`)
      .run(params);
  }

  /** Total delete of a memory. */
  delete(hash: string): void {
    this.db.prepare(`DELETE FROM lambda_memories WHERE hash = ?`).run(hash);
  }

  /**
   * Query top N candidate memories with permission filtering (Phase 9).
   *
   * Permission logic:
   *   - sensitivity='public'   → visible to ALL users
   *   - sensitivity='internal' → visible only to users in the SAME project
   *   - sensitivity='secret'   → visible only to the SAME owner_id
   */
  queryCandidates(
    limit: number = 50,
    project?: string,
    ownerId?: string
  ): LambdaMemoryEntry[] {
    let sql = `SELECT * FROM lambda_memories WHERE 1=1`;
    const params: Record<string, unknown> = { limit };

    if (ownerId) {
      // Phase 9: Permission filter
      // Show: public memories + internal memories from same project + secret memories from same owner
      sql += ` AND (
        sensitivity = 'public'
        OR (sensitivity = 'internal' AND project = @filterProject)
        OR (sensitivity = 'secret' AND owner_id = @ownerId)
      )`;
      params.ownerId = ownerId;
      params.filterProject = project || null;
    } else {
      // Legacy mode: hide secret memories (backward compatible)
      sql += ` AND sensitivity != 'secret'`;
    }

    if (project) {
      sql += ` AND project = @project`;
      params.project = project;
    }

    sql += ` ORDER BY importance DESC, last_accessed DESC LIMIT @limit`;

    const rows = this.db.prepare(sql).all(params) as LambdaMemoryRow[];
    return rows.map(rowToEntry);
  }

  /** Recall a memory by hash prefix — also touches it (reheat). */
  recall(hashPrefix: string): LambdaMemoryEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM lambda_memories WHERE hash LIKE @pattern LIMIT 1`)
      .get({ pattern: `${hashPrefix}%` }) as LambdaMemoryRow | undefined;

    if (!row) return null;

    // Reheat: update last_accessed and increment access_count
    this.touch(row.hash);

    return rowToEntry(row);
  }

  /** Update last_accessed timestamp and increment access_count. */
  touch(hash: string): void {
    this.db
      .prepare(
        `UPDATE lambda_memories
         SET last_accessed = @now, access_count = access_count + 1
         WHERE hash = @hash`
      )
      .run({ hash, now: Math.floor(Date.now() / 1000) });
  }

  /** Full-text search via FTS5. Returns hashes with BM25 relevance rank. */
  ftsSearch(
    query: string,
    limit: number = 20
  ): Array<{ hash: string; rank: number }> {
    // Escape the query for FTS5: wrap each token in double-quotes to prevent
    // single words from being misinterpreted as column names (e.g. "brain" →
    // FTS5 error: no such column: brain). Double-quote escape internal quotes.
    const escapedQuery = query
      .trim()
      .split(/\s+/)
      .map(token => `"${token.replace(/"/g, '""')}"`)
      .join(' ');

    const rows = this.db
      .prepare(
        `SELECT m.hash, fts.rank
         FROM lambda_memories_fts fts
         JOIN lambda_memories m ON m.rowid = fts.rowid
         WHERE lambda_memories_fts MATCH @query
         ORDER BY fts.rank
         LIMIT @limit`
      )
      .all({ query: escapedQuery, limit }) as Array<{ hash: string; rank: number }>;

    return rows;
  }

  /**
   * Garbage collection — remove old unimportant memories.
   * Keeps: explicit_save, importance >= 3, or accessed within last 30 days.
   */
  gc(): number {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;

    const result = this.db
      .prepare(
        `DELETE FROM lambda_memories
         WHERE explicit_save = 0
           AND importance < 3
           AND last_accessed < @cutoff`
      )
      .run({ cutoff: thirtyDaysAgo });

    return result.changes;
  }

  /** Get statistics about the brain. */
  stats(): {
    total: number;
    byProject: Record<string, number>;
    byType: Record<string, number>;
  } {
    const total = (
      this.db.prepare(`SELECT COUNT(*) as cnt FROM lambda_memories`).get() as {
        cnt: number;
      }
    ).cnt;

    const projectRows = this.db
      .prepare(
        `SELECT COALESCE(project, '_untagged') as proj, COUNT(*) as cnt
         FROM lambda_memories GROUP BY project`
      )
      .all() as Array<{ proj: string; cnt: number }>;

    const typeRows = this.db
      .prepare(
        `SELECT memory_type, COUNT(*) as cnt
         FROM lambda_memories GROUP BY memory_type`
      )
      .all() as Array<{ memory_type: string; cnt: number }>;

    const byProject: Record<string, number> = {};
    for (const r of projectRows) byProject[r.proj] = r.cnt;

    const byType: Record<string, number> = {};
    for (const r of typeRows) byType[r.memory_type] = r.cnt;

    return { total, byProject, byType };
  }

  // --- Project Management ---

  /** Return all distinct project names with memory counts, sorted by count desc. */
  getDistinctProjects(): Array<{ project: string; count: number }> {
    return this.db
      .prepare(
        `SELECT COALESCE(project, '_untagged') as project, COUNT(*) as count
         FROM lambda_memories
         GROUP BY project
         ORDER BY count DESC`
      )
      .all() as Array<{ project: string; count: number }>;
  }

  /**
   * Rename/merge all memories from `oldProject` to `newProject`.
   * This is how the user "merges" duplicate project names.
   * Returns the number of memories updated.
   */
  renameProject(oldProject: string, newProject: string): number {
    const result = this.db
      .prepare(
        `UPDATE lambda_memories SET project = @newProject
         WHERE COALESCE(project, '_untagged') = @oldProject`
      )
      .run({ newProject, oldProject });
    return result.changes;
  }

  // --- Embeddings (Phase 6) ---


  /** Store embedding vector for a memory. */
  storeEmbedding(hash: string, embedding: Buffer): void {
    this.db
      .prepare(`UPDATE lambda_memories SET embedding = @embedding WHERE hash = @hash`)
      .run({ hash, embedding });
  }

  /** Get all memories with their embeddings (for semantic search). Phase 9: permission-aware. */
  getAllWithEmbeddings(project?: string, ownerId?: string): Array<{ hash: string; embedding: Buffer | null; importance: number; last_accessed: number; tags: string }> {
    let sql = `SELECT hash, embedding, importance, last_accessed, tags FROM lambda_memories WHERE 1=1`;
    const params: Record<string, unknown> = {};

    if (ownerId) {
      sql += ` AND (
        sensitivity = 'public'
        OR (sensitivity = 'internal' AND project = @filterProject)
        OR (sensitivity = 'secret' AND owner_id = @ownerId)
      )`;
      params.ownerId = ownerId;
      params.filterProject = project || null;
    } else {
      sql += ` AND sensitivity != 'secret'`;
    }

    if (project) {
      sql += ` AND project = @project`;
      params.project = project;
    }

    return this.db.prepare(sql).all(params) as any[];
  }

  /** Get a single entry by exact hash. */
  getByHash(hash: string): LambdaMemoryEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM lambda_memories WHERE hash = @hash`)
      .get({ hash }) as LambdaMemoryRow | undefined;

    return row ? rowToEntry(row) : null;
  }

  /** Get all entries (for sync). */
  getAll(): LambdaMemoryEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM lambda_memories ORDER BY created_at DESC`)
      .all() as LambdaMemoryRow[];
    return rows.map(rowToEntry);
  }

  close(): void {
    this.db.close();
  }

  // --- File Snapshots (Phase 2) ---

  /** Upsert a file snapshot. */
  storeSnapshot(snapshot: {
    hash: string;
    path: string;
    project: string | null;
    summary: string | null;
    essence: string | null;
    size_bytes: number;
    file_hash: string;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO file_snapshots (hash, path, project, summary, essence, size_bytes, file_hash, captured_at, last_seen)
         VALUES (@hash, @path, @project, @summary, @essence, @size_bytes, @file_hash, @now, @now)
         ON CONFLICT(path) DO UPDATE SET
           summary = @summary,
           essence = @essence,
           size_bytes = @size_bytes,
           file_hash = @file_hash,
           last_seen = @now`
      )
      .run({ ...snapshot, now });
  }

  /** Get snapshot by file path. */
  getSnapshot(path: string): {
    hash: string;
    path: string;
    project: string | null;
    summary: string | null;
    essence: string | null;
    file_hash: string;
    captured_at: number;
    last_seen: number;
  } | null {
    return this.db
      .prepare(`SELECT * FROM file_snapshots WHERE path = @path`)
      .get({ path }) as any || null;
  }

  /** Get all snapshots for a project. */
  getSnapshotsByProject(project: string): any[] {
    return this.db
      .prepare(`SELECT * FROM file_snapshots WHERE project = @project ORDER BY last_seen DESC`)
      .all({ project });
  }

  // --- Chat Sessions (Phase 1) ---

  /** Store a chat session. */
  storeSession(session: {
    id: string;
    memory_hash: string | null;
    project: string | null;
    title: string;
    turns: string;
    token_count: number | null;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO chat_sessions (id, memory_hash, project, title, turns, token_count, created_at)
         VALUES (@id, @memory_hash, @project, @title, @turns, @token_count, @now)`
      )
      .run({ ...session, now });
  }

  /** Get session by ID. */
  getSession(id: string): any | null {
    return this.db
      .prepare(`SELECT * FROM chat_sessions WHERE id = @id`)
      .get({ id }) || null;
  }

  /** Get all sessions for a project. */
  getSessionsByProject(project: string, limit: number = 20): any[] {
    return this.db
      .prepare(`SELECT id, memory_hash, project, title, token_count, created_at FROM chat_sessions WHERE project = @project ORDER BY created_at DESC LIMIT @limit`)
      .all({ project, limit });
  }

  /** Get all sessions (for dashboard). */
  getAllSessions(limit: number = 50): any[] {
    return this.db
      .prepare(`SELECT id, memory_hash, project, title, token_count, created_at FROM chat_sessions ORDER BY created_at DESC LIMIT @limit`)
      .all({ limit });
  }
}
