import { getDefinition as apiGetDefinition } from "./apiService";

export async function getDefinition(word: string): Promise<string | null> {
  try {
    const response = await apiGetDefinition(word);
    return response.definition || null;
  } catch (error) {
    console.error("Error getting definition:", error);
    return null;
  }
}
