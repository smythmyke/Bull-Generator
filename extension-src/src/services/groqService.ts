// This file now delegates to apiService.ts (Cloud Functions → Gemini)
// Kept for backward compatibility with existing imports
import { generateSearchStrings, SearchResponse } from "./apiService";

export type { SearchResponse };

export async function processBatchWithRetry(
  words: string[],
  _retryConfig?: unknown
): Promise<SearchResponse> {
  return generateSearchStrings(words);
}

export function chunkWords(words: string[], size: number = 8): string[][] {
  return words.reduce((chunks: string[][], word, index) => {
    const chunkIndex = Math.floor(index / size);
    if (!chunks[chunkIndex]) {
      chunks[chunkIndex] = [];
    }
    chunks[chunkIndex].push(word);
    return chunks;
  }, []);
}

export async function processAllWords(words: string[]): Promise<SearchResponse[]> {
  const batches = chunkWords(words);
  const results: SearchResponse[] = [];

  for (const batch of batches) {
    const result = await processBatchWithRetry(batch);
    results.push(result);
  }

  return results;
}
