/**
 * Lambda Brain — Core Type Definitions
 *
 * Defines the data structures underpinning the λ-Memory system:
 * entries, config, enums for fidelity tiers and memory types.
 */

// --- Enums ---

/** Fidelity tier determines how much detail is shown for a memory. */
export enum Fidelity {
  HOT = 'hot',
  WARM = 'warm',
  COOL = 'cool',
  FADED = 'faded',
  GONE = 'gone',
}

/** Semantic category of a memory. */
export enum MemoryType {
  CONVERSATION = 'conversation',
  KNOWLEDGE = 'knowledge',
  LEARNING = 'learning',
  DECISION = 'decision',
  ARCHITECTURE = 'architecture',
}

/** Sensitivity level — controls Obsidian vault export. */
export enum Sensitivity {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  SECRET = 'secret',
}

// --- Core Data ---

/** A single λ-Memory entry stored in SQLite. */
export interface LambdaMemoryEntry {
  hash: string;
  created_at: number;        // Unix epoch seconds
  last_accessed: number;      // Unix epoch seconds
  access_count: number;
  importance: number;         // 1–5 scale
  explicit_save: boolean;
  full_text: string;
  summary_text: string;
  essence_text: string;
  context_log: string | null; // Full chat / reasoning trail for human review
  tags: string[];
  memory_type: MemoryType;
  sensitivity: Sensitivity;
  project: string | null;
  session_id: string;
  owner_id: string;           // Phase 9: User/agent who created this memory
}

/** Row shape coming out of SQLite (JSON-encoded tags, integer booleans). */
export interface LambdaMemoryRow {
  hash: string;
  created_at: number;
  last_accessed: number;
  access_count: number;
  importance: number;
  explicit_save: number;     // 0 | 1
  full_text: string;
  summary_text: string;
  essence_text: string;
  context_log: string | null;
  tags: string;              // JSON array
  memory_type: string;
  sensitivity: string;
  project: string | null;
  session_id: string;
  owner_id: string;          // Phase 9
}

// --- Config ---

export interface DecayThresholds {
  hot: number;
  warm: number;
  cool: number;
  faded: number;
}

export interface LambdaMemoryConfig {
  enabled: boolean;
  decay_lambda: number;          // Decay rate constant (default 0.01)
  thresholds: DecayThresholds;
  candidate_limit: number;       // Max candidates per query
  obsidian_vault_path: string | null;
  db_path: string;
  api_key: string | null;        // Required for SSE mode
  gemini_api_key: string | null;  // Phase 6: Gemini embedding API key
}

/** Sensible defaults — half-life ~69 hours (≈3 days). */
export const DEFAULT_CONFIG: LambdaMemoryConfig = {
  enabled: true,
  decay_lambda: 0.01,
  thresholds: {
    hot: 2.0,
    warm: 1.0,
    cool: 0.3,
    faded: 0.01,
  },
  candidate_limit: 50,
  obsidian_vault_path: null,
  db_path: '',  // Resolved at runtime
  api_key: null,
  gemini_api_key: null,
};

// --- Helper to convert Row → Entry ---

export function rowToEntry(row: LambdaMemoryRow): LambdaMemoryEntry {
  return {
    hash: row.hash,
    created_at: row.created_at,
    last_accessed: row.last_accessed,
    access_count: row.access_count,
    importance: row.importance,
    explicit_save: row.explicit_save === 1,
    full_text: row.full_text,
    summary_text: row.summary_text,
    essence_text: row.essence_text,
    context_log: row.context_log,
    tags: JSON.parse(row.tags || '[]'),
    memory_type: row.memory_type as MemoryType,
    sensitivity: (row.sensitivity || 'public') as Sensitivity,
    project: row.project,
    session_id: row.session_id,
    owner_id: row.owner_id || 'default',
  };
}
