#!/usr/bin/env node
/**
 * Lambda Brain — Entry Point
 *
 * Usage:
 *   # Local mode (STDIO) — default
 *   lambda-brain
 *
 *   # Network mode (SSE)
 *   lambda-brain --sse --port 3020 --api-key YOUR_SECRET
 *
 * Environment variables (alternative to CLI flags):
 *   LAMBDA_BRAIN_DB_PATH        — SQLite database path (default: ~/.lambda-brain/brain.db)
 *   LAMBDA_BRAIN_VAULT_PATH     — Obsidian vault path (optional)
 *   LAMBDA_BRAIN_API_KEY        — API key for SSE mode
 *   LAMBDA_BRAIN_PORT           — Port for SSE mode (default: 3020)
 *   LAMBDA_BRAIN_DECAY_LAMBDA   — Decay rate constant (default: 0.01)
 *   GEMINI_API_KEY              — Gemini API key for semantic embeddings (Phase 6)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrainDatabase } from './database.js';
import { ObsidianVault } from './obsidian.js';
import { createBrainServer } from './server.js';
import { startStdioServer, startSSEServer } from './transport.js';
import { type LambdaMemoryConfig, DEFAULT_CONFIG } from './types.js';
import { decayScore, selectFidelity } from './decay.js';
import { initEmbedStats } from './embed_stats.js';

// --- Parse CLI args ---
const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const useSSE = args.includes('--sse');
const port = parseInt(getArg('port') || process.env.LAMBDA_BRAIN_PORT || '3020', 10);
const apiKey = getArg('api-key') || process.env.LAMBDA_BRAIN_API_KEY || '';

// --- Resolve paths ---
const defaultDir = path.join(os.homedir(), '.lambda-brain');
fs.mkdirSync(defaultDir, { recursive: true });

const dbPath =
  process.env.LAMBDA_BRAIN_DB_PATH || path.join(defaultDir, 'brain.db');
const vaultPath = process.env.LAMBDA_BRAIN_VAULT_PATH || getArg('vault') || null;
const decayLambda = parseFloat(
  process.env.LAMBDA_BRAIN_DECAY_LAMBDA || `${DEFAULT_CONFIG.decay_lambda}`
);
const geminiApiKey = process.env.GEMINI_API_KEY || null;

// --- Build config ---
const config: LambdaMemoryConfig = {
  ...DEFAULT_CONFIG,
  db_path: dbPath,
  decay_lambda: decayLambda,
  obsidian_vault_path: vaultPath,
  api_key: apiKey || null,
  gemini_api_key: geminiApiKey,
};

// --- Initialize ---
console.error(`[lob-brain] Database: ${dbPath}`);
const db = new BrainDatabase(dbPath);

let vault: ObsidianVault | null = null;
if (vaultPath) {
  vault = new ObsidianVault(vaultPath);
  console.error(`[lob-brain] Obsidian Vault: ${vaultPath}`);
} else {
  console.error('[lob-brain] Obsidian Vault: not configured');
}

// Phase 6: Log Gemini embedding status
if (geminiApiKey) {
  console.error('[lob-brain] Gemini Embedding: enabled (text-embedding-004)');
} else {
  console.error('[lob-brain] Gemini Embedding: disabled (using local TF-IDF fallback)');
}

// Init embedding stats (persisted alongside brain.db)
const statsPath = dbPath.replace(/brain\.db$/, 'embed_stats.json');
initEmbedStats(statsPath);

const server = createBrainServer(db, vault, config);

// --- Start ---
if (useSSE) {
  if (!apiKey) {
    console.error(
      '[lob-brain] ERROR: SSE mode requires --api-key or LAMBDA_BRAIN_API_KEY'
    );
    process.exit(1);
  }
  // Pass a factory so each SSE connection gets a fresh McpServer instance
  const rulesPath = dbPath.replace(/brain\.db$/, 'access_rules.json');
  startSSEServer(
    (allowedProjects) => createBrainServer(db, vault, config, allowedProjects),
    port,
    apiKey,
    { db, vault, config, decayScore, selectFidelity, rulesPath, statsPath }
  ).catch((err) => {
    console.error('[lob-brain] Fatal error:', err);
    process.exit(1);
  });
  
  // Keep process alive in SSE mode
  setInterval(() => {}, 1000); 
} else {
  const server = createBrainServer(db, vault, config);
  startStdioServer(server).catch((err) => {
    console.error('[lob-brain] Fatal error:', err);
    process.exit(1);
  });
}

// --- Graceful shutdown ---
process.on('SIGINT', () => {
  console.error('[lob-brain] Shutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

// --- Crash guards: prevent silent death from unhandled errors ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('[lob-brain] ⚠️ Unhandled Promise Rejection (server NOT crashing):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[lob-brain] ⚠️ Uncaught Exception (server NOT crashing):', err);
  // NOTE: Do NOT process.exit() here — we want the server to stay alive.
  // Only truly fatal errors (out of memory) should kill the process.
});
