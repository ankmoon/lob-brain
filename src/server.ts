/**
 * LOB Brain — MCP Server
 *
 * Exposes 10 tools via the Model Context Protocol:
 *   brain_store, brain_query, brain_recall, brain_context, brain_sync, brain_status,
 *   brain_snapshot_file, brain_log_session, brain_ingest, brain_clusters
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'crypto';
import { BrainDatabase } from './database.js';
import { ObsidianVault } from './obsidian.js';
import {
  type LambdaMemoryEntry,
  type LambdaMemoryConfig,
  MemoryType,
  Sensitivity,
  DEFAULT_CONFIG,
} from './types.js';
import {
  decayScore,
  selectFidelity,
  formatMemory,
  assembleContext,
} from './decay.js';
import {
  localEmbed,
  getEmbedding,
  embedToBuffer,
  bufferToEmbed,
  cosineSimilarity,
} from './embeddings.js';
import { ingestFile } from './ingestion.js';
import { kMeansClusters } from './clustering.js';

/**
 * Create and configure the MCP server with all brain tools.
 * @param allowedProjects  null = master key (full access). Non-null = restrict to these projects only.
 */
export function createBrainServer(
  db: BrainDatabase,
  vault: ObsidianVault | null,
  config: LambdaMemoryConfig,
  allowedProjects: string[] | null = null
): McpServer {
  const server = new McpServer({
    name: 'lambda-brain',
    version: '1.0.0',
  });

  // ─── Tool 1: brain_store ──────────────────────────────────
  server.tool(
    'brain_store',
    'Store a new memory into the Lambda Brain. Memories decay over time but can always be recalled.',
    {
      content: z.string().describe('Full text of the memory'),
      summary: z.string().describe('Concise summary (1-2 sentences)'),
      essence: z.string().describe('Ultra-short essence (< 15 words)'),
      importance: z
        .number()
        .min(1)
        .max(5)
        .describe('Importance level 1-5 (5 = critical decision)'),
      tags: z
        .array(z.string())
        .default([])
        .describe('Tags for categorization'),
      project: z
        .string()
        .optional()
        .describe('Project name this memory belongs to'),
      memory_type: z
        .enum(['conversation', 'knowledge', 'learning', 'decision', 'architecture'])
        .default('conversation')
        .describe('Semantic category of the memory'),
      sensitivity: z
        .enum(['public', 'internal', 'secret'])
        .default('public')
        .describe('Controls visibility: secret = SQLite only, not exported to vault'),
      owner_id: z
        .string()
        .optional()
        .describe('User/agent ID who owns this memory (default: "default")'),
      context_log: z
        .string()
        .optional()
        .describe(
          'Full conversation / reasoning trail. Stored in the .md file body for human review.'
        ),
    },
    async (params) => {
      const now = Math.floor(Date.now() / 1000);
      const hash = createHash('sha256')
        .update(`${now}:${params.content}`)
        .digest('hex')
        .substring(0, 16);

      const entry: LambdaMemoryEntry = {
        hash,
        created_at: now,
        last_accessed: now,
        access_count: 0,
        importance: params.importance,
        explicit_save: false,
        full_text: params.content,
        summary_text: params.summary,
        essence_text: params.essence,
        context_log: params.context_log || null,
        tags: params.tags,
        memory_type: params.memory_type as MemoryType,
        sensitivity: params.sensitivity as Sensitivity,
        project: params.project || null,
        session_id: `session_${now}`,
        owner_id: params.owner_id || 'default',
      };

      db.store(entry);

      // Phase 6: Auto-generate embedding (Gemini API if available, local fallback)
      // Wrapped in try-catch so embedding failure never blocks memory storage
      try {
        const embedText = `${params.summary} ${params.essence} ${params.tags.join(' ')}`;
        const embedding = await getEmbedding(embedText, config.gemini_api_key);
        db.storeEmbedding(hash, embedToBuffer(embedding));
      } catch (embedErr) {
        console.error('[lob-brain] Embedding failed in brain_store (memory saved without embedding):', (embedErr as Error).message);
      }

      let vaultPath: string | null = null;
      if (vault) {
        vaultPath = vault.writeMemory(entry);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              stored: true,
              hash,
              vault_file: vaultPath,
              importance: params.importance,
              decay_info: `This memory will stay HOT for ~${Math.round(
                Math.log(params.importance / config.thresholds.hot) /
                  config.decay_lambda
              )}h before fading.`,
            }),
          },
        ],
      };
    }
  );

  // ─── Tool 2: brain_query ──────────────────────────────────
  server.tool(
    'brain_query',
    'Search the Lambda Brain. Returns memories ranked by decay score (recent + important = higher). Uses FTS5 full-text search when a query is provided.',
    {
      query: z
        .string()
        .optional()
        .describe('Search query (FTS5 syntax supported). Leave empty to get top memories.'),
      project: z
        .string()
        .optional()
        .describe('Filter by project name'),
      limit: z
        .number()
        .default(10)
        .describe('Max number of results'),
      owner_id: z
        .string()
        .optional()
        .describe('User/agent ID for permission filtering'),
    },
    async (params) => {
      const now = Math.floor(Date.now() / 1000);
      let candidates: LambdaMemoryEntry[];

      // Enforce project scope: if key is project-scoped, override or reject unscoped queries
      const scopedProject = allowedProjects
        ? (params.project && allowedProjects.includes(params.project)
            ? params.project
            : allowedProjects[0])  // default to first allowed project
        : params.project;
      if (params.query) {
        // Run FTS5 and Gemini semantic search in parallel for best coverage
        // Wrap getEmbedding to prevent network errors from crashing the entire query
        const [ftsResults, queryEmbed] = await Promise.all([
          Promise.resolve(db.ftsSearch(params.query, params.limit * 2)),
          getEmbedding(params.query, config.gemini_api_key).catch((err) => {
            console.error('[lob-brain] Embedding failed in brain_query, using local fallback:', (err as Error).message);
            return localEmbed(params.query!);
          }),
        ]);

        const ftsCandidates = ftsResults
          .map((r) => db.getByHash(r.hash))
          .filter((e): e is LambdaMemoryEntry => e !== null);

        // Semantic search across embeddings (filtered by project scope)
        const allWithEmbed = db.getAllWithEmbeddings(
          scopedProject || undefined,
          params.owner_id || undefined
        );
        const ftsHashes = new Set(ftsCandidates.map(c => c.hash));

        // Score all embeddings — boost FTS hits by 0.5
        const scored = allWithEmbed
          .filter(m => m.embedding)
          .map(m => ({
            hash: m.hash,
            similarity: cosineSimilarity(queryEmbed, bufferToEmbed(m.embedding!))
              + (ftsHashes.has(m.hash) ? 0.5 : 0),
          }))
          .filter(s => s.similarity > 0.25)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, params.limit);

        const seen = new Set<string>();
        candidates = [];
        for (const s of scored) {
          if (seen.has(s.hash)) continue;
          seen.add(s.hash);
          const entry = db.getByHash(s.hash);
          if (entry) candidates.push(entry);
        }

        // Fallback: if no semantic results (e.g. empty DB), use FTS candidates
        if (candidates.length === 0) candidates = ftsCandidates.slice(0, params.limit);
      } else {
        candidates = db.queryCandidates(params.limit, scopedProject, params.owner_id);
      }


      const results = candidates.map((entry) => {
        const score = decayScore(entry, now, config.decay_lambda);
        const fidelity = selectFidelity(score, config.thresholds);
        return {
          hash: entry.hash.substring(0, 7),
          fidelity,
          score: Number(score.toFixed(3)),
          project: entry.project,
          tags: entry.tags,
          text: formatMemory(entry, fidelity, score),
        };
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // ─── Tool 3: brain_recall ─────────────────────────────────
  server.tool(
    'brain_recall',
    'Recall a memory by its hash prefix. This "reheats" the memory, resetting its decay timer and returning the full text.',
    {
      hash_prefix: z
        .string()
        .min(4)
        .describe(
          'First 4+ characters of the memory hash (shown in [brackets] in query results)'
        ),
    },
    async (params) => {
      const entry = db.recall(params.hash_prefix);
      if (!entry) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No memory found with hash prefix "${params.hash_prefix}". Try brain_query to find available memories.`,
            },
          ],
        };
      }

      const score = decayScore(
        entry,
        Math.floor(Date.now() / 1000),
        config.decay_lambda
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                hash: entry.hash,
                importance: entry.importance,
                score: Number(score.toFixed(3)),
                tags: entry.tags,
                project: entry.project,
                full_text: entry.full_text,
                summary: entry.summary_text,
                context_log: entry.context_log
                  ? '(context log available — see vault .md file for details)'
                  : null,
                reheated: true,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Tool 4: brain_context ────────────────────────────────
  server.tool(
    'brain_context',
    'Get a ready-to-use memory context block for a project. Returns memories formatted at appropriate fidelity levels based on decay scoring. Paste this into your system prompt.',
    {
      project: z.string().describe('Project name to get context for'),
      char_budget: z
        .number()
        .default(8000)
        .describe(
          'Max characters for the memory section (default 8000)'
        ),
      owner_id: z
        .string()
        .optional()
        .describe('User/agent ID for permission filtering'),
    },
    async (params) => {
      // Enforce project scope for restricted keys
      const scopedCtxProject = allowedProjects
        ? (params.project && allowedProjects.includes(params.project)
            ? params.project
            : allowedProjects[0])
        : params.project;

      const candidates = db.queryCandidates(
        config.candidate_limit,
        scopedCtxProject,
        params.owner_id
      );

      const contextBlock = assembleContext(
        candidates,
        config.decay_lambda,
        config.thresholds,
        params.char_budget
      );

      return {
        content: [
          {
            type: 'text' as const,
            text:
              contextBlock ||
              `No memories found for project "${params.project}".`,
          },
        ],
      };
    }
  );

  // ─── Tool 5: brain_sync ───────────────────────────────────
  server.tool(
    'brain_sync',
    'Sync between Obsidian Vault (.md files) and SQLite database. Direction: vault → SQLite (imports .md edits) or SQLite → vault (re-exports all memories).',
    {
      direction: z
        .enum(['vault_to_db', 'db_to_vault'])
        .default('vault_to_db')
        .describe('Sync direction'),
    },
    async (params) => {
      if (!vault) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Obsidian vault not configured. Set LAMBDA_BRAIN_VAULT_PATH environment variable.',
            },
          ],
        };
      }

      if (params.direction === 'vault_to_db') {
        const mdEntries = vault.readAllMemories();
        let synced = 0;
        for (const partial of mdEntries) {
          if (!partial.hash) continue;
          const existing = db.getByHash(partial.hash);
          if (existing) {
            // Update fields that might have been edited in Obsidian
            const updated: LambdaMemoryEntry = {
              ...existing,
              summary_text: partial.summary_text || existing.summary_text,
              full_text: partial.full_text || existing.full_text,
              context_log: partial.context_log ?? existing.context_log,
              tags: partial.tags || existing.tags,
              importance: partial.importance ?? existing.importance,
            };
            db.store(updated);
            synced++;
          }
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Synced ${synced} memories from vault → SQLite.`,
            },
          ],
        };
      } else {
        // db_to_vault: export all non-secret memories
        const allEntries = db.getAll();
        let exported = 0;
        for (const entry of allEntries) {
          const path = vault.writeMemory(entry);
          if (path) exported++;
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Exported ${exported} memories from SQLite → vault.`,
            },
          ],
        };
      }
    }
  );

  // ─── Tool 6: brain_status ─────────────────────────────────
  server.tool(
    'brain_status',
    'Get statistics about the Lambda Brain: total memories, breakdown by project and type, and GC info.',
    {},
    async () => {
      const st = db.stats();
      const now = Math.floor(Date.now() / 1000);

      // Sample decay distribution from top candidates
      const sample = db.queryCandidates(100);
      const distribution = { hot: 0, warm: 0, cool: 0, faded: 0, gone: 0 };
      for (const entry of sample) {
        const score = decayScore(entry, now, config.decay_lambda);
        const fidelity = selectFidelity(score, config.thresholds);
        distribution[fidelity]++;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                total_memories: st.total,
                by_project: st.byProject,
                by_type: st.byType,
                fidelity_distribution: distribution,
                config: {
                  decay_lambda: config.decay_lambda,
                  half_life_hours: Math.round(
                    Math.log(2) / config.decay_lambda
                  ),
                  vault_configured: vault !== null,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── Tool 7: brain_snapshot_file ────────────────────────────
  server.tool(
    'brain_snapshot_file',
    'Cache a file summary in the brain to avoid re-reading it every session. Returns existing snapshot if file unchanged.',
    {
      path: z.string().describe('Absolute path to the file'),
      project: z.string().optional().describe('Project name'),
      summary: z.string().describe('AI-generated summary of the file (1-3 sentences)'),
      essence: z.string().describe('Ultra-short essence (< 15 words)'),
      file_hash: z.string().describe('MD5 or SHA256 hash of file content for change detection'),
      size_bytes: z.number().describe('File size in bytes'),
    },
    async (params) => {
      // Check if snapshot exists and file unchanged
      const existing = db.getSnapshot(params.path);
      if (existing && existing.file_hash === params.file_hash) {
        // File unchanged — update last_seen and return cached
        db.storeSnapshot({
          hash: existing.hash,
          path: params.path,
          project: params.project || existing.project,
          summary: existing.summary,
          essence: existing.essence,
          size_bytes: params.size_bytes,
          file_hash: params.file_hash,
        });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              cached: true,
              summary: existing.summary,
              essence: existing.essence,
              message: 'File unchanged — using cached snapshot.',
            }),
          }],
        };
      }

      // New or changed file — store new snapshot
      const hash = createHash('sha256')
        .update(`${Date.now()}:${params.path}`)
        .digest('hex')
        .substring(0, 16);

      db.storeSnapshot({
        hash,
        path: params.path,
        project: params.project || null,
        summary: params.summary,
        essence: params.essence,
        size_bytes: params.size_bytes,
        file_hash: params.file_hash,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            cached: false,
            hash,
            message: existing ? 'File changed — snapshot updated.' : 'New file snapshot created.',
          }),
        }],
      };
    }
  );

  // ─── Tool 8: brain_log_session ─────────────────────────────
  server.tool(
    'brain_log_session',
    'Store a chat session history linked to a brain memory. Enables recalling full conversations.',
    {
      title: z.string().describe('Short title summarizing the session'),
      project: z.string().optional().describe('Project name'),
      memory_hash: z.string().optional().describe('Hash of related brain_store memory'),
      turns: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.string().optional(),
      })).describe('Array of conversation turns'),
    },
    async (params) => {
      const id = createHash('sha256')
        .update(`${Date.now()}:${params.title}`)
        .digest('hex')
        .substring(0, 16);

      // Estimate token count (~4 chars per token)
      const turnsJson = JSON.stringify(params.turns);
      const tokenEstimate = Math.round(turnsJson.length / 4);

      db.storeSession({
        id,
        memory_hash: params.memory_hash || null,
        project: params.project || null,
        title: params.title,
        turns: turnsJson,
        token_count: tokenEstimate,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            stored: true,
            session_id: id,
            turns_count: params.turns.length,
            token_estimate: tokenEstimate,
            linked_memory: params.memory_hash || null,
          }),
        }],
      };
    }
  );

  // ─── Tool 9: brain_ingest ───────────────────────────────
  server.tool(
    'brain_ingest',
    'Ingest a document file (MD/TXT) into the brain as chunked memories for RAG retrieval. Each chunk gets embedded for semantic search.',
    {
      path: z.string().describe('Absolute path to the file to ingest'),
      project: z.string().optional().describe('Project name to associate chunks with'),
      chunk_size: z.number().default(2000).describe('Approximate chunk size in characters (default 2000)'),
    },
    async (params) => {
      try {
        const result = await ingestFile(params.path, params.project || null, db, params.chunk_size, config.gemini_api_key ?? undefined);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ingested: true,
              file: result.path,
              chunks: result.chunks,
              total_chars: result.totalChars,
              token_estimate: Math.round(result.totalChars / 4),
              chunk_hashes: result.hashes.map(h => h.substring(0, 7)),
            }),
          }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err.message }),
          }],
        };
      }
    }
  );

  // ─── Tool 10: brain_clusters ────────────────────────────
  server.tool(
    'brain_clusters',
    'Cluster memories by topic similarity using k-means on embeddings. Returns grouped memories with top tags per cluster.',
    {
      k: z.number().default(5).describe('Number of clusters (default 5)'),
      project: z.string().optional().describe('Filter by project'),
      owner_id: z.string().optional().describe('User/agent ID for permission filtering'),
    },
    async (params) => {
      // Enforce project scope for restricted keys
      const scopedCluster = allowedProjects
        ? (params.project && allowedProjects.includes(params.project)
            ? params.project
            : allowedProjects[0])
        : (params.project || undefined);

      const items = db.getAllWithEmbeddings(scopedCluster, params.owner_id || undefined);
      const clusters = kMeansClusters(items as any, params.k);

      const result = clusters.map(c => ({
        cluster_id: c.id,
        size: c.members.length,
        top_tags: c.topTags,
        sample_hashes: c.members.slice(0, 5).map(h => h.substring(0, 7)),
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total_memories: items.length,
            clusters_found: clusters.length,
            clusters: result,
          }),
        }],
      };
    }
  );

  return server;
}
