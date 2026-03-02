import { PorterStemmer } from "./porterStemmer";

export interface MergeableConcept {
  id: string;
  name: string;
  category: string;
  synonyms: string[];
  importance: 'high' | 'medium' | 'low';
  enabled: boolean;
}

export interface MergedConcept extends MergeableConcept {
  mergedFrom?: string[]; // IDs of concepts that were merged into this one
}

export interface MergeResult {
  concepts: MergedConcept[];
  mergeCount: number; // how many merges occurred
}

/** Tokenize a string into individual lowercase words */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[\s\-_\/]+/).filter(w => w.length >= 2);
}

/** Build a stem set for a concept: stem all words from name + synonyms */
function buildStemSet(concept: MergeableConcept): Set<string> {
  const stems = new Set<string>();
  const words = [
    ...tokenize(concept.name),
    ...concept.synonyms.flatMap(s => tokenize(s)),
  ];
  for (const w of words) {
    stems.add(PorterStemmer.stem(w));
  }
  return stems;
}

/** Compute Jaccard similarity between two sets */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const IMPORTANCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Merge overlapping concepts using stem-based Jaccard similarity.
 *
 * Heuristic:
 * 1. Build stem set for each concept (name words + synonym words)
 * 2. Compute pairwise Jaccard similarity of stem sets
 * 3. If Jaccard > threshold (default 0.35), merge the pair:
 *    - Keep higher-importance concept's name/category
 *    - Union all synonyms
 *    - Track mergedFrom IDs
 * 4. Return deduplicated concept list
 */
export function mergeConcepts(
  concepts: MergeableConcept[],
  threshold: number = 0.35
): MergeResult {
  if (concepts.length <= 1) {
    return { concepts: concepts.map(c => ({ ...c })), mergeCount: 0 };
  }

  // Work with copies that include merge tracking
  const working: (MergedConcept & { stemSet: Set<string>; merged: boolean })[] =
    concepts.map(c => ({
      ...c,
      mergedFrom: undefined,
      stemSet: buildStemSet(c),
      merged: false,
    }));

  let mergeCount = 0;

  // Greedy pairwise merge
  for (let i = 0; i < working.length; i++) {
    if (working[i].merged) continue;
    for (let j = i + 1; j < working.length; j++) {
      if (working[j].merged) continue;

      const sim = jaccard(working[i].stemSet, working[j].stemSet);
      if (sim > threshold) {
        // Merge j into i — keep whichever has higher importance
        const keepI = (IMPORTANCE_RANK[working[i].importance] ?? 2) >=
                      (IMPORTANCE_RANK[working[j].importance] ?? 2);
        const keeper = keepI ? working[i] : working[j];
        const donor = keepI ? working[j] : working[i];

        // Union synonyms
        const synSet = new Set([
          ...keeper.synonyms,
          ...donor.synonyms,
          // Add the donor's name as a synonym if different
          ...(keeper.name.toLowerCase() !== donor.name.toLowerCase() ? [donor.name] : []),
        ]);
        // Remove the keeper's own name from synonyms
        synSet.delete(keeper.name);

        keeper.synonyms = Array.from(synSet);
        keeper.mergedFrom = [
          ...(keeper.mergedFrom || []),
          donor.id,
          ...(donor.mergedFrom || []),
        ];

        // Update stem set for further merges
        keeper.stemSet = new Set([...keeper.stemSet, ...donor.stemSet]);

        donor.merged = true;

        // If we merged into j and not i, move keeper data to i's slot
        if (!keepI) {
          working[i] = { ...keeper };
          working[j].merged = true;
        }

        mergeCount++;
      }
    }
  }

  // Collect surviving concepts (strip internal fields)
  const result: MergedConcept[] = working
    .filter(c => !c.merged)
    .map(({ stemSet: _stemSet, merged: _merged, ...rest }) => rest);

  return { concepts: result, mergeCount };
}
