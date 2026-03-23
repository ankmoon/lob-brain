/**
 * LOB Brain — Gemini Embedding Usage Tracker
 *
 * Persists cumulative call stats to embed_stats.json so they survive server restarts.
 * Stats are updated atomically on every successful Gemini embedding call.
 */

import * as fs from 'fs';

export interface EmbedStats {
  gemini_calls: number;      // Total Gemini API calls
  gemini_chars: number;      // Total characters sent to Gemini
  gemini_tokens_est: number; // Estimated tokens (chars / 4)
  fallback_calls: number;    // Times we fell back to local TF-IDF
  last_call_at: string | null; // ISO timestamp of last Gemini call
  since: string;             // When tracking started
}

let statsPath = '';
let stats: EmbedStats = createEmpty();

function createEmpty(): EmbedStats {
  return {
    gemini_calls: 0,
    gemini_chars: 0,
    gemini_tokens_est: 0,
    fallback_calls: 0,
    last_call_at: null,
    since: new Date().toISOString(),
  };
}

/** Initialize the stats file. Call once at server startup. */
export function initEmbedStats(path: string): void {
  statsPath = path;
  if (fs.existsSync(path)) {
    try {
      stats = JSON.parse(fs.readFileSync(path, 'utf-8'));
    } catch {
      stats = createEmpty();
    }
  } else {
    save();
  }
}

function save(): void {
  if (!statsPath) return;
  try {
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf-8');
  } catch {
    // Non-critical — stats are best-effort
  }
}

/** Record a successful Gemini embedding call. */
export function recordGeminiCall(charCount: number): void {
  stats.gemini_calls++;
  stats.gemini_chars += charCount;
  stats.gemini_tokens_est = Math.round(stats.gemini_chars / 4);
  stats.last_call_at = new Date().toISOString();
  save();
}

/** Record a fallback to local TF-IDF. */
export function recordFallback(): void {
  stats.fallback_calls++;
  save();
}

/** Return a snapshot of the current stats. */
export function getEmbedStats(): EmbedStats {
  return { ...stats };
}

/** Reset stats (used via dashboard). */
export function resetEmbedStats(): void {
  stats = createEmpty();
  save();
}
