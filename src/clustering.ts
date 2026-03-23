/**
 * LOB Brain — Memory Clustering (Phase 7)
 *
 * Groups memories into topic clusters using embedding similarity.
 * Uses simple k-means on local embeddings (128-dim vectors).
 *
 * Why cluster? Helps the user see what topics their brain covers,
 * identify gaps, and lets the agent retrieve topic-coherent context.
 */

import { bufferToEmbed, cosineSimilarity } from './embeddings.js';

/** A cluster of related memories. */
export interface MemoryCluster {
  id: number;
  centroid: number[];
  members: string[]; // memory hashes
  topTags: string[];
}

/**
 * Simple k-means clustering on embedding vectors.
 * Returns cluster assignments for each memory.
 */
export function kMeansClusters(
  items: Array<{ hash: string; embedding: Buffer | null; tags?: string }>,
  k: number = 5,
  maxIterations: number = 20
): MemoryCluster[] {
  // Filter items with valid embeddings
  const valid = items
    .filter(i => i.embedding && i.embedding.length > 0)
    .map(i => ({
      hash: i.hash,
      vec: bufferToEmbed(i.embedding!),
      tags: i.tags ? JSON.parse(i.tags) as string[] : [],
    }));

  if (valid.length === 0) return [];
  const dim = valid[0].vec.length;

  // Adjust k if fewer items than clusters
  k = Math.min(k, valid.length);
  if (k <= 0) return [];

  // Initialize centroids: pick k random items
  const centroids: number[][] = [];
  const picked = new Set<number>();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * valid.length);
    if (!picked.has(idx)) {
      picked.add(idx);
      centroids.push([...valid[idx].vec]);
    }
  }

  // Assign items to clusters
  let assignments = new Array(valid.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assign each item to nearest centroid
    for (let i = 0; i < valid.length; i++) {
      let bestCluster = 0;
      let bestSim = -1;
      for (let c = 0; c < k; c++) {
        const sim = cosineSimilarity(valid[i].vec, centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed) break;

    // Recompute centroids
    for (let c = 0; c < k; c++) {
      const members = valid.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue;

      for (let d = 0; d < dim; d++) {
        centroids[c][d] = members.reduce((s, m) => s + m.vec[d], 0) / members.length;
      }
    }
  }

  // Build cluster objects
  const clusters: MemoryCluster[] = [];
  for (let c = 0; c < k; c++) {
    const memberIndices = valid
      .map((_, i) => i)
      .filter(i => assignments[i] === c);

    if (memberIndices.length === 0) continue;

    // Count tags across members
    const tagCounts: Record<string, number> = {};
    for (const idx of memberIndices) {
      for (const tag of valid[idx].tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);

    clusters.push({
      id: c,
      centroid: centroids[c],
      members: memberIndices.map(i => valid[i].hash),
      topTags,
    });
  }

  return clusters.sort((a, b) => b.members.length - a.members.length);
}
