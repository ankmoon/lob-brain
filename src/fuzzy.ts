/**
 * Fuzzy Project Name Resolution
 *
 * Prevents duplicate project entries caused by typos, case differences,
 * or formatting inconsistencies (e.g. "Life is Game" vs "life-is-game").
 *
 * Uses lightweight string algorithms (zero external dependencies, zero API calls).
 */

import type { BrainDatabase } from './database.js';

/**
 * Compute Levenshtein edit distance between two strings.
 * O(m*n) where m,n are string lengths — fine for short project names.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Optimize: use single-row DP to avoid allocating full matrix
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Strip formatting characters and lowercase for comparison.
 * "Life is Game" → "lifeisgame"
 * "life-is-game" → "lifeisgame"
 */
export function normalizeProjectName(name: string): string {
  return name.toLowerCase().replace(/[-_\s.]+/g, '');
}

export interface FuzzyResult {
  /** The project name to use (existing or original). */
  resolved: string;
  /** Whether the name was auto-corrected to an existing one. */
  corrected: boolean;
  /** The original name passed in. */
  original: string;
  /** Which matching strategy was used. */
  strategy?: 'exact' | 'case-insensitive' | 'normalized' | 'levenshtein';
}

/**
 * Resolve an incoming project name against existing project names in the DB.
 *
 * Matching priority:
 * 1. Exact match → use as-is
 * 2. Case-insensitive exact → use existing casing
 * 3. Normalized match (strip dashes/spaces/underscores) → use existing
 * 4. Levenshtein distance ≤ threshold → use existing (catches typos)
 *
 * The Levenshtein threshold scales with name length:
 * - Names ≤ 4 chars: max 1 edit (avoid "CRM" → "Crypto")
 * - Names 5-10 chars: max 2 edits
 * - Names > 10 chars: max 3 edits
 */
export function resolveProjectName(
  db: BrainDatabase,
  incoming: string
): FuzzyResult {
  if (!incoming || !incoming.trim()) {
    return { resolved: incoming, corrected: false, original: incoming };
  }

  const trimmed = incoming.trim();
  const projects = db.getDistinctProjects();
  const existingNames = projects
    .map((p) => p.project)
    .filter((p) => p !== '_untagged');

  if (existingNames.length === 0) {
    return { resolved: trimmed, corrected: false, original: trimmed };
  }

  // 1. Exact match
  if (existingNames.includes(trimmed)) {
    return { resolved: trimmed, corrected: false, original: trimmed, strategy: 'exact' };
  }

  // 2. Case-insensitive exact match
  const lowerIncoming = trimmed.toLowerCase();
  const caseMatch = existingNames.find(
    (n) => n.toLowerCase() === lowerIncoming
  );
  if (caseMatch) {
    return { resolved: caseMatch, corrected: true, original: trimmed, strategy: 'case-insensitive' };
  }

  // 3. Normalized match (strip all formatting)
  const incomingNorm = normalizeProjectName(trimmed);
  const normMatch = existingNames.find(
    (n) => normalizeProjectName(n) === incomingNorm
  );
  if (normMatch) {
    return { resolved: normMatch, corrected: true, original: trimmed, strategy: 'normalized' };
  }

  // 4. Levenshtein distance (catch typos like Prodweave → Prodweaver)
  let bestMatch = '';
  let bestDist = Infinity;

  for (const name of existingNames) {
    const dist = levenshteinDistance(lowerIncoming, name.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = name;
    }
  }

  // Dynamic threshold based on name length
  const maxDist = trimmed.length <= 4 ? 1 : trimmed.length <= 10 ? 2 : 3;

  if (bestDist > 0 && bestDist <= maxDist && bestMatch) {
    return { resolved: bestMatch, corrected: true, original: trimmed, strategy: 'levenshtein' };
  }

  // No match → genuinely new project
  return { resolved: trimmed, corrected: false, original: trimmed };
}