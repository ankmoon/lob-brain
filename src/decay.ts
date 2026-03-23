/**
 * Lambda Brain — λ-Decay Engine
 *
 * Core algorithm: score = importance × e^(−λ × hours_since_last_access)
 * Adapted from TEMM1E's Rust implementation into TypeScript.
 */

import {
  type LambdaMemoryEntry,
  type DecayThresholds,
  Fidelity,
} from './types.js';

/**
 * Compute the decay score for a memory entry.
 * Higher score = more "alive" in the brain.
 */
export function decayScore(
  entry: LambdaMemoryEntry,
  nowEpoch: number,
  lambda: number
): number {
  const hoursSinceAccess = (nowEpoch - entry.last_accessed) / 3600;
  return entry.importance * Math.exp(-lambda * Math.max(0, hoursSinceAccess));
}

/**
 * Dynamically adjust thresholds based on available token budget.
 * When budget is tight, thresholds rise → more memories shown at lower fidelity.
 */
export function effectiveThresholds(
  budget: number,
  maxBudget: number,
  base: DecayThresholds
): DecayThresholds {
  const ratio = Math.max(0.1, budget / maxBudget);
  const scale = 1 / ratio;
  return {
    hot: base.hot * scale,
    warm: base.warm * scale,
    cool: base.cool * scale,
    faded: base.faded * scale,
  };
}

/**
 * Determine fidelity tier from a computed score.
 */
export function selectFidelity(
  score: number,
  thresholds: DecayThresholds
): Fidelity {
  if (score >= thresholds.hot) return Fidelity.HOT;
  if (score >= thresholds.warm) return Fidelity.WARM;
  if (score >= thresholds.cool) return Fidelity.COOL;
  if (score >= thresholds.faded) return Fidelity.FADED;
  return Fidelity.GONE;
}

/**
 * Format a memory for inclusion in an AI context window.
 * Returns the best representation for the given fidelity tier.
 */
export function formatMemory(
  entry: LambdaMemoryEntry,
  fidelity: Fidelity,
  score: number
): string {
  const hashShort = entry.hash.substring(0, 7);
  const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
  const proj = entry.project ? ` @${entry.project}` : '';

  switch (fidelity) {
    case Fidelity.HOT:
      return [
        `## 🔴 [${hashShort}]${proj}${tags} (score: ${score.toFixed(2)})`,
        entry.full_text,
      ].join('\n');

    case Fidelity.WARM:
      return [
        `## 🟡 [${hashShort}]${proj}${tags} (score: ${score.toFixed(2)})`,
        entry.summary_text,
        `> Recall full: hash \`${hashShort}\``,
      ].join('\n');

    case Fidelity.COOL:
      return [
        `## 🔵 [${hashShort}]${proj}${tags} (score: ${score.toFixed(2)})`,
        entry.essence_text,
        `> Recall full: hash \`${hashShort}\``,
      ].join('\n');

    case Fidelity.FADED:
      return `## ⚪ [${hashShort}]${proj} — ${entry.essence_text} _(recall to restore)_`;

    case Fidelity.GONE:
    default:
      return ''; // Invisible to the agent
  }
}

/**
 * Assemble the λ-Memory section for an agent's context.
 * Takes candidate entries, scores them, sorts by score desc, and packs
 * into formatted blocks until the token budget is exhausted.
 *
 * Phase 3: Smart Token Budget — auto-downgrades fidelity when tight.
 */
export function assembleContext(
  candidates: LambdaMemoryEntry[],
  lambda: number,
  thresholds: DecayThresholds,
  charBudget: number = 8000
): string {
  const now = Math.floor(Date.now() / 1000);
  // ~4 chars per token approximation
  const tokenBudget = Math.round(charBudget / 4);

  const scored = candidates
    .map((entry) => ({
      entry,
      score: decayScore(entry, now, lambda),
    }))
    .sort((a, b) => b.score - a.score);

  const blocks: string[] = [];
  let usedChars = 0;
  let includedCount = 0;

  for (const { entry, score } of scored) {
    let fidelity = selectFidelity(score, thresholds);
    if (fidelity === Fidelity.GONE) continue;

    let block = formatMemory(entry, fidelity, score);

    // Smart downgrade: if block exceeds remaining budget, try lower fidelity
    const remaining = charBudget - usedChars;
    if (block.length > remaining && fidelity === Fidelity.HOT) {
      fidelity = Fidelity.WARM;
      block = formatMemory(entry, fidelity, score);
    }
    if (block.length > remaining && fidelity === Fidelity.WARM) {
      fidelity = Fidelity.COOL;
      block = formatMemory(entry, fidelity, score);
    }
    if (block.length > remaining && fidelity === Fidelity.COOL) {
      fidelity = Fidelity.FADED;
      block = formatMemory(entry, fidelity, score);
    }
    if (block.length > remaining) break; // Even FADED doesn't fit

    blocks.push(block);
    usedChars += block.length;
    includedCount++;
  }

  if (blocks.length === 0) return '';

  const usedTokens = Math.round(usedChars / 4);
  return [
    '# λ-Memory',
    `_${includedCount} memories loaded | ~${usedTokens}/${tokenBudget} tokens | ${usedChars} chars_`,
    '',
    ...blocks,
  ].join('\n');
}
