import { getSynonyms as apiGetSynonyms } from "./apiService";

export async function getSynonyms(word: string): Promise<string[]> {
  const response = await apiGetSynonyms(word);
  return response.synonyms;
}
