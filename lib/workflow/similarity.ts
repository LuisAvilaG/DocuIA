function normalizeText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(text.split(" ").filter((t) => t.length >= 2));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const token of a) {
    if (b.has(token)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function computeSimilarity(a: string, b: string): number {
  const aNorm = normalizeText(a);
  const bNorm = normalizeText(b);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;

  const aTokens = tokenize(aNorm);
  const bTokens = tokenize(bNorm);
  const tokenScore = jaccardSimilarity(aTokens, bTokens);

  const maxLen = Math.max(aNorm.length, bNorm.length);
  const lev = levenshtein(aNorm.slice(0, 60), bNorm.slice(0, 60));
  const levScore = maxLen > 0 ? 1 - lev / maxLen : 0;

  const containsBonus =
    aNorm.includes(bNorm) || bNorm.includes(aNorm)
      ? Math.min(aNorm.length, bNorm.length) >= 8 ? 0.12 : 0.04
      : 0;

  let score = Math.min(0.55 * tokenScore + 0.45 * levScore + containsBonus, 1);

  if (levScore >= 0.95 && Math.abs(aNorm.length - bNorm.length) <= 2) {
    score = Math.max(score, 0.92);
  }

  return score;
}

export function normalizeForLookup(value: string): string {
  return normalizeText(value)
    .replace(/\b(invoice|bill|ship|remit|payment|due|date|account|phone|fax|email|street|st|ave|blvd)\b/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
