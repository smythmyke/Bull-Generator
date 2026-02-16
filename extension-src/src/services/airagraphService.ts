import { analyzeParagraph as apiAnalyzeParagraph, AnalyzeResponse } from "./apiService";

export async function analyzeParagraph(
  paragraph: string,
  searchSystem: string = "orbit"
): Promise<AnalyzeResponse> {
  return apiAnalyzeParagraph(paragraph, searchSystem);
}
