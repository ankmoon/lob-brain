/**
 * LOB Brain — Document Ingestion Pipeline (Phase 10)
 *
 * Chunks text documents (MD, TXT) into smaller pieces,
 * embeds each chunk, and stores as memories for RAG retrieval.
 *
 * Supported formats: .md, .txt (plain text)
 * PDF/DOCX support can be added via external parsers later.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { getEmbedding, embedToBuffer } from './embeddings.js';
import { BrainDatabase } from './database.js';
import { type LambdaMemoryEntry, MemoryType, Sensitivity } from './types.js';

/** Result of ingesting a document. */
export interface IngestResult {
  path: string;
  chunks: number;
  totalChars: number;
  hashes: string[];
}

/**
 * Split text into chunks of approximately `chunkSize` characters.
 * Tries to split at paragraph boundaries (\n\n) for clean chunks.
 */
export function chunkText(text: string, chunkSize: number = 2000): string[] {
  if (text.length <= chunkSize) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + para;
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/**
 * Ingest a file: read, chunk, embed, store each chunk as a memory.
 */
export async function ingestFile(
  filePath: string,
  project: string | null,
  db: BrainDatabase,
  chunkSize: number = 2000,
  geminiApiKey?: string
): Promise<IngestResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.md', '.txt', '.markdown'].includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Supported: .md, .txt`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  const chunks = chunkText(content, chunkSize);
  const hashes: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const hash = createHash('sha256')
      .update(`${filePath}:chunk${i}:${now}`)
      .digest('hex')
      .substring(0, 16);

    // Create summary from first 150 chars
    const summary = chunk.substring(0, 150).replace(/\n/g, ' ').trim() + (chunk.length > 150 ? '...' : '');
    // Essence from first 50 chars
    const essence = `[${fileName}:${i + 1}/${chunks.length}] ${chunk.substring(0, 50).replace(/\n/g, ' ')}`;

    const entry: LambdaMemoryEntry = {
      hash,
      created_at: now,
      last_accessed: now,
      access_count: 0,
      importance: 2, // Documents get medium importance by default
      explicit_save: false,
      full_text: chunk,
      summary_text: summary,
      essence_text: essence,
      context_log: null,
      tags: ['document', 'rag', fileName],
      memory_type: 'knowledge' as MemoryType,
      sensitivity: 'public' as Sensitivity,
      project,
      session_id: `ingest_${now}`,
      owner_id: 'default',
    };

    db.store(entry);

    // Generate and store embedding — use Gemini if key available, fallback to TF-IDF
    try {
      const embedding = await getEmbedding(chunk, geminiApiKey ?? null);
      db.storeEmbedding(hash, embedToBuffer(embedding));
    } catch (embedErr) {
      console.error('[lob-brain] Embedding failed in ingest (chunk saved without embedding):', (embedErr as Error).message);
    }

    hashes.push(hash);
  }

  return {
    path: filePath,
    chunks: chunks.length,
    totalChars: content.length,
    hashes,
  };
}
