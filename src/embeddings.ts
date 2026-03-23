/**
 * LOB Brain — Embedding Engine (Phase 6)
 *
 * Provides semantic search via vector embeddings.
 * Supports two modes:
 *   1. Local TF-IDF (no API needed, offline fallback)
 *   2. Gemini text-embedding-004 API (high quality, free tier: 1500 req/day)
 *
 * Why not use only FTS5? FTS5 matches exact keywords.
 * Embeddings understand "database" ≈ "PostgreSQL" ≈ "cơ sở dữ liệu".
 */

// --- Gemini Embedding API (Phase 6 upgrade) ---

/** Gemini API endpoint for text-embedding-004 */
const GEMINI_EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';
import { recordGeminiCall, recordFallback } from './embed_stats.js';

/**
 * Call Gemini text-embedding-004 API.
 * Returns 768-dim vector. Free tier: 1500 requests/day.
 */
export async function geminiEmbed(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini embedding API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const vec = data.embedding?.values || [];
  // Track usage: chars / 4 ≈ tokens
  recordGeminiCall(text.length);
  return vec;
}

/**
 * Smart embedding function — tries Gemini API first, falls back to local TF-IDF.
 *
 * @param text       Text to embed
 * @param apiKey     Gemini API key (null = use local)
 * @returns          Embedding vector (768-dim for Gemini, 128-dim for local)
 */
export async function getEmbedding(text: string, apiKey: string | null): Promise<number[]> {
  if (apiKey) {
    try {
      return await geminiEmbed(text, apiKey);
    } catch (err) {
      console.error('[lob-brain] Gemini embedding failed, falling back to local TF-IDF:', (err as Error).message);
      recordFallback();
    }
  }
  recordFallback(); // No API key = local path
  return localEmbed(text);
}

// --- Local TF-IDF (offline fallback) ---

/**
 * Simple local embedding using TF-IDF-like approach.
 * No external API needed. Good enough for hundreds of memories.
 */
export function localEmbed(text: string): number[] {
  // Normalize and tokenize
  const tokens = text
    .toLowerCase()
    .replace(/[^a-záàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

  // Create a fixed-dimension vector using hash bucketing
  const DIM = 128;
  const vec = new Array(DIM).fill(0);

  for (const token of tokens) {
    // Simple hash: sum of char codes mod DIM
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) % DIM;
    }
    vec[hash] += 1;

    // Bigram for context (pair consecutive chars)
    for (let i = 0; i < token.length - 1; i++) {
      const bigram = (token.charCodeAt(i) * 31 + token.charCodeAt(i + 1)) % DIM;
      vec[bigram] += 0.5;
    }
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) vec[i] /= norm;
  }

  return vec;
}

// --- Vector Utilities ---

/**
 * Cosine similarity between two vectors.
 * Handles different dimensions gracefully (pads shorter vector with zeros).
 * Returns 0-1 (1 = identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  // If dimensions differ (Gemini 768 vs local 128), they're incompatible
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Serialize embedding to a compact Buffer for SQLite BLOB storage.
 * Supports any dimension (128 for local, 768 for Gemini).
 */
export function embedToBuffer(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4); // Float32
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

/**
 * Deserialize Buffer back to number array.
 */
export function bufferToEmbed(buf: Buffer): number[] {
  const vec: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    vec.push(buf.readFloatLE(i));
  }
  return vec;
}
