/**
 * Supplier name matching for GET /suppliers?q=, shared so the T15 mock and W4's API score names the
 * same way. Confidence is normalised token overlap (Jaccard): shared words over all words, after
 * NFKC folding, lower-casing, splitting on punctuation and dropping company suffixes.
 */

/** Company-form words that say nothing about which supplier it is. */
const IGNORED_WORDS: ReadonlySet<string> = new Set(["pty", "ltd", "limited", "inc", "co"]);

/** The distinguishing words of a supplier name, in first-seen order. */
export function supplierNameTokens(name: string): Set<string> {
  const words = name
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && !IGNORED_WORDS.has(word));
  return new Set(words);
}

/**
 * Normalised token overlap of two names, 0..1: |A ∩ B| / |A ∪ B|. "Karoo Textiles (Pty) Ltd" against
 * "Karoo Textiles" is 1; a single shared word out of two is 0.5. 0 when either name has no words.
 */
export function supplierNameConfidence(query: string, name: string): number {
  const a = supplierNameTokens(query);
  const b = supplierNameTokens(name);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}
