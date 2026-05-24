export type RankedItem = {
  id: string;
  score: number;
};

export type FusedRank = {
  id: string;
  score: number;
  ranks: Record<string, number>;
};

export function reciprocalRankFusion(
  rankedLists: Record<string, RankedItem[]>,
  options?: { k?: number; limit?: number },
): FusedRank[] {
  const k = options?.k ?? 60;
  const scores = new Map<string, FusedRank>();

  for (const [source, list] of Object.entries(rankedLists)) {
    list.forEach((item, index) => {
      const rank = index + 1;
      const existing = scores.get(item.id) ?? {
        id: item.id,
        score: 0,
        ranks: {},
      };

      existing.score += 1 / (k + rank);
      existing.ranks[source] = rank;
      scores.set(item.id, existing);
    });
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, options?.limit ?? 50);
}
