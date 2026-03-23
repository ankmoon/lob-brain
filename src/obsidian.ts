/**
 * Lambda Brain — Obsidian Vault Integration
 *
 * Each memory is exported as a `.md` file with YAML frontmatter.
 * The body contains the full text and context_log for human review.
 * Supports bi-directional sync: write → md, read md → SQLite.
 */

import * as fs from 'fs';
import * as path from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import {
  type LambdaMemoryEntry,
  MemoryType,
  Sensitivity,
} from './types.js';

/**
 * Generate a slug-safe filename from a memory entry.
 * Format: {date}_{hash-short}_{first-tag-or-type}.md
 */
function memoryFilename(entry: LambdaMemoryEntry): string {
  const date = new Date(entry.created_at * 1000)
    .toISOString()
    .split('T')[0];
  const hashShort = entry.hash.substring(0, 7);
  const label =
    entry.tags.length > 0
      ? entry.tags[0].replace(/[^a-zA-Z0-9-]/g, '-')
      : entry.memory_type;
  return `${date}_${hashShort}_${label}.md`;
}

/**
 * Build YAML frontmatter + Markdown body from a memory entry.
 */
function entryToMarkdown(entry: LambdaMemoryEntry): string {
  const frontmatter: Record<string, unknown> = {
    hash: entry.hash,
    importance: entry.importance,
    memory_type: entry.memory_type,
    sensitivity: entry.sensitivity,
    tags: entry.tags,
    project: entry.project || 'none',
    session_id: entry.session_id,
    created_at: new Date(entry.created_at * 1000).toISOString(),
    last_accessed: new Date(entry.last_accessed * 1000).toISOString(),
    access_count: entry.access_count,
  };

  const parts: string[] = [
    '---',
    yamlStringify(frontmatter).trim(),
    '---',
    '',
    `# ${entry.essence_text}`,
    '',
    '## Summary',
    entry.summary_text,
    '',
    '## Full Detail',
    entry.full_text,
  ];

  // Context log: the decision trail, chat history, reasoning
  if (entry.context_log) {
    parts.push(
      '',
      '## Context Log',
      '_Full conversation / reasoning trail that led to this memory:_',
      '',
      entry.context_log
    );
  }

  // Obsidian-style links for project and tags
  if (entry.project) {
    parts.push('', '## Links', `- Project: [[${entry.project}]]`);
    for (const tag of entry.tags) {
      parts.push(`- Tag: [[${tag}]]`);
    }
  }

  return parts.join('\n') + '\n';
}

/**
 * Parse a markdown file back into a partial LambdaMemoryEntry.
 * Used for syncing Obsidian edits back to SQLite.
 */
function markdownToEntry(
  content: string
): Partial<LambdaMemoryEntry> | null {
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!fmMatch) return null;

  try {
    const fm = yamlParse(fmMatch[1]) as Record<string, unknown>;

    // Extract body sections
    const body = content.slice(fmMatch[0].length);
    const summaryMatch = body.match(
      /## Summary\n([\s\S]*?)(?=\n## |$)/
    );
    const fullMatch = body.match(
      /## Full Detail\n([\s\S]*?)(?=\n## |$)/
    );
    const contextMatch = body.match(
      /## Context Log\n_[^_]*_\n\n([\s\S]*?)(?=\n## |$)/
    );

    return {
      hash: fm.hash as string,
      importance: fm.importance as number,
      memory_type: (fm.memory_type as MemoryType) || MemoryType.CONVERSATION,
      sensitivity: (fm.sensitivity as Sensitivity) || Sensitivity.PUBLIC,
      tags: (fm.tags as string[]) || [],
      project: fm.project === 'none' ? null : (fm.project as string),
      session_id: fm.session_id as string,
      created_at: Math.floor(
        new Date(fm.created_at as string).getTime() / 1000
      ),
      last_accessed: Math.floor(
        new Date(fm.last_accessed as string).getTime() / 1000
      ),
      access_count: (fm.access_count as number) || 0,
      summary_text: summaryMatch ? summaryMatch[1].trim() : '',
      full_text: fullMatch ? fullMatch[1].trim() : '',
      context_log: contextMatch ? contextMatch[1].trim() : null,
      essence_text: '', // Will be extracted from heading
    };
  } catch {
    return null;
  }
}

// --- Public API ---

export class ObsidianVault {
  private vaultPath: string;
  private memoriesDir: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.memoriesDir = path.join(vaultPath, 'memories');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.memoriesDir, { recursive: true });
    fs.mkdirSync(path.join(this.vaultPath, 'projects'), { recursive: true });
  }

  /**
   * Write a memory as an .md file.
   * SECRET memories are NOT exported to the vault.
   */
  writeMemory(entry: LambdaMemoryEntry): string | null {
    if (entry.sensitivity === Sensitivity.SECRET) return null;

    const filename = memoryFilename(entry);
    const filepath = path.join(this.memoriesDir, filename);
    const md = entryToMarkdown(entry);

    fs.writeFileSync(filepath, md, 'utf-8');
    return filepath;
  }

  /**
   * Read all .md files from the vault and parse them.
   * Used for sync: Obsidian → SQLite.
   */
  readAllMemories(): Array<Partial<LambdaMemoryEntry>> {
    if (!fs.existsSync(this.memoriesDir)) return [];

    const files = fs.readdirSync(this.memoriesDir).filter((f) =>
      f.endsWith('.md')
    );

    const entries: Array<Partial<LambdaMemoryEntry>> = [];
    for (const file of files) {
      const content = fs.readFileSync(
        path.join(this.memoriesDir, file),
        'utf-8'
      );
      const parsed = markdownToEntry(content);
      if (parsed && parsed.hash) {
        entries.push(parsed);
      }
    }

    return entries;
  }

  /**
   * Delete the .md file for a memory that has been GC'd.
   */
  deleteMemory(hash: string): void {
    const files = fs.readdirSync(this.memoriesDir);
    const hashShort = hash.substring(0, 7);
    const target = files.find((f) => f.includes(hashShort));
    if (target) {
      fs.unlinkSync(path.join(this.memoriesDir, target));
    }
  }
}
