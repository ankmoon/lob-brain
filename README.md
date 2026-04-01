<div align="center">

# 🧠 LOB Brain

**Lambda-Obsidian Brain — AI Memory Engine with λ-Decay Algorithm**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)

*What if your AI Agent never forgot anything important — and automatically forgot what's no longer relevant?*

</div>

---

## 🔥 The Problem

Every AI Agent has amnesia. Each session starts from scratch. You re-explain the same context, lose architectural decisions, and watch your token bill climb with redundant prompting.

## 💡 The Solution

LOB Brain is a **local-first memory engine** that gives AI Agents a persistent, self-managing memory — backed by SQLite and synced to your Obsidian vault as human-readable Markdown.

```
AI Agent  ←──  LOB Brain Engine  ←──→  SQLite DB (brain.db)
                                  ←──→  Obsidian Vault (.md files)
                                  ←──→  Gemini / Local TF-IDF Embeddings
```

---

## 🧮 The Algorithm — λ-Decay Scoring

LOB Brain's core is a **λ-decay memory scoring system**, inspired by physics of radioactive decay and Ebbinghaus's forgetting curve:

$$\text{Score} = \text{Importance} \times e^{-\lambda \cdot \Delta t}$$

Where:
- **Importance** — rated 1–5 when storing (you decide what matters)
- **λ (lambda)** — decay constant controlling how fast memories fade
- **Δt** — hours elapsed since last access (reading resets the clock)

Each memory is assigned a **fidelity tier** based on its live score:

| Score | Tier | Description |
|---|---|---|
| > 3.5 | 🔥 HOT | Full text — high relevance, recently used |
| 2.0–3.5 | 🌡️ WARM | Summary only |
| 1.0–2.0 | 🧊 COOL | Essence (≤15 words) |
| 0.1–1.0 | 🌫️ FADED | Hash reference only |
| < 0.1 | 💨 GONE | Excluded from context entirely |

When assembling context for an AI prompt, memories are loaded at their appropriate fidelity tier, fitting the maximum amount of useful information into a fixed token budget — automatically.

> 💡 **Credit**: The λ-decay approach for AI memory management was inspired by the **[Temm1e project](https://github.com/temm1e-labs/temm1e)** by [temm1e-labs](https://github.com/temm1e-labs). We are grateful for their foundational research on adaptive memory decay models for AI systems.

---

## 📦 What's in This Repo (Core Engine)

This repository contains the **open-source brain core library**:

| Module | Description |
|---|---|
| `src/database.ts` | SQLite operations — store, query, recall, GC, FTS5 full-text search |
| `src/decay.ts` | λ-decay scoring, fidelity tier selection, token-budget context assembly |
| `src/embeddings.ts` | Gemini `text-embedding-004` + local TF-IDF fallback |
| `src/embed_stats.ts` | Gemini API usage tracking (calls, estimated tokens) |
| `src/clustering.ts` | K-means clustering of memories by topic similarity |
| `src/obsidian.ts` | Bidirectional sync with Obsidian vault (Markdown ↔ SQLite) |
| `src/ingestion.ts` | Chunked ingestion of Markdown/TXT files for RAG |
| `src/types.ts` | Shared TypeScript type definitions |
| `tests/` | Unit tests for core logic (27 passing) |

---

## 🔌 MCP Integration Layer

The **MCP server** that exposes these capabilities as AI tools (for Claude Desktop, Antigravity, Cursor, etc.) is available separately.

It includes:
- 10 ready-to-use MCP tools (`brain_store`, `brain_query`, `brain_recall`, `brain_context`, `brain_clusters`...)
- SSE server for multi-machine / team setups
- Web dashboard for memory management
- Project-scoped API key access control

**Want the full MCP integration? Contact me:**

[![Facebook](https://img.shields.io/badge/Facebook-immaghostcreator-1877F2?logo=facebook&logoColor=white)](https://www.facebook.com/immaghostcreator)
[![X](https://img.shields.io/badge/X-GhostCreat5825-000000?logo=x&logoColor=white)](https://x.com/GhostCreat5825)
[![Threads](https://img.shields.io/badge/Threads-immaghostcreator-000000?logo=threads&logoColor=white)](https://www.threads.com/@immaghostcreator)
[![Whop](https://img.shields.io/badge/Shop-Whop-7c3aed?logo=shopify&logoColor=white)](https://whop.com/joined/imma-ghost/)

---

## 🚀 Getting Started (Core Library)

```bash
git clone https://github.com/ankmoon/lob-brain.git
cd lob-brain
npm install
```

### 🔒 Security & Local Setup
Sensitive proxy and access control rules are intentionally excluded from this public repository. Before building the project, you need to set up the local security files:

1. **Rename the sample files in `src/`:**
   ```bash
   mv src/transport.sample.ts src/transport.ts
   mv src/access_control.sample.ts src/access_control.ts
   ```
2. **Implement your custom logic:** Open the newly renamed files and add your authentication and routing rules if needed.
3. **Build the project:**
   ```bash
   npm run build
   ```

### Using the Core in Your Project

```typescript
import { BrainDatabase } from './src/database.js';
import { assembleContext, decayScore } from './src/decay.js';
import { getEmbedding } from './src/embeddings.js';

// Initialize the brain
const db = new BrainDatabase('./brain.db');

// Store a memory
db.store({
  hash: 'abc123',
  full_text: 'Decided to use PostgreSQL for the auth service',
  summary: 'PostgreSQL chosen for auth service',
  essence: 'PostgreSQL for auth — decided 2026-03',
  importance: 4,
  project: 'my-project',
  memory_type: 'decision',
  sensitivity: 'public',
  tags: ['database', 'auth', 'architecture'],
  owner_id: 'default',
  created_at: new Date().toISOString(),
  last_accessed: new Date().toISOString(),
  access_count: 0,
});

// Query memories
const results = db.ftsSearch('PostgreSQL', 'my-project', 10);

// Get context block (respects token budget)
const candidates = db.queryCandidates('my-project', 50);
const context = assembleContext(candidates, 8000);
console.log(context); // Ready to inject into system prompt
```

### Run Tests

```bash
npm test
# 27 tests, 0 failures
```

---

## ⚙️ Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Optional — enables Gemini `text-embedding-004` for semantic search. Falls back to local TF-IDF if not set. Free tier: 1500 req/day at [aistudio.google.com](https://aistudio.google.com/apikey) |
| `LAMBDA_BRAIN_DB_PATH` | Optional — custom path to SQLite database (default: `./brain.db`) |

---

## 🤝 Contributing

Contributions to the core engine are welcome!

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Run tests: `npm test`
4. Open a Pull Request

---

## 📄 License

[MIT](LICENSE) — Core library is free to use, modify, and build upon.

---

<div align="center">

Built with ❤️ for the AI Agent community.  
*Special thanks to **[temm1e-labs/temm1e](https://github.com/temm1e-labs/temm1e)** for the λ-decay memory model that powers this project.*

---

**ghostcreator**

[![GitHub](https://img.shields.io/badge/GitHub-ankmoon-181717?logo=github)](https://github.com/ankmoon/lob-brain)
[![Facebook](https://img.shields.io/badge/Facebook-immaghostcreator-1877F2?logo=facebook&logoColor=white)](https://www.facebook.com/immaghostcreator)
[![X](https://img.shields.io/badge/X-GhostCreat5825-000000?logo=x&logoColor=white)](https://x.com/GhostCreat5825)
[![Threads](https://img.shields.io/badge/Threads-immaghostcreator-000000?logo=threads&logoColor=white)](https://www.threads.com/@immaghostcreator)
[![Whop](https://img.shields.io/badge/Shop-Whop-7c3aed?logo=shopify&logoColor=white)](https://whop.com/joined/imma-ghost/)

</div>
