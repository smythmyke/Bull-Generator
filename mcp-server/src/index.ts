#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { PatentSearchApiClient, PatentSearchApiError } from "./api/client.js";
import { balanceTool, runBalance } from "./tools/balance.js";
import { dossierTool, runDossier } from "./tools/dossier.js";
import { prosecutionTool, runProsecution } from "./tools/prosecution.js";
import { oaAnalyzeTool, runOaAnalyze } from "./tools/oaAnalyze.js";
import { examinerTool, runExaminer } from "./tools/examiner.js";
import { queryTool, runQuery } from "./tools/query.js";
import { searchTool, runSearch } from "./tools/search.js";
import { similarTool, runSimilar } from "./tools/similar.js";
import { citationsTool, runCitations } from "./tools/citations.js";
import { familyTool, runFamily } from "./tools/family.js";
import { cpcTool, runCpc } from "./tools/cpc.js";

const SERVER_NAME = "patent-search";
const SERVER_VERSION = "0.1.0";

function readEnv(name: string, required = true): string {
  const value = process.env[name];
  if (!value && required) {
    process.stderr.write(
      `[patent-search-mcp] ${name} is not set. Mint a key from the AI Patent Search Generator Chrome extension's Admin tab and set it in your MCP client config.\n`
    );
    process.exit(1);
  }
  return value ?? "";
}

async function main(): Promise<void> {
  const apiKey = readEnv("PATENT_SEARCH_API_KEY");
  const baseUrl = process.env.PATENT_SEARCH_API_BASE;

  const api = new PatentSearchApiClient({ apiKey, baseUrl });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  const tools: Tool[] = [
    balanceTool as unknown as Tool,
    dossierTool as unknown as Tool,
    prosecutionTool as unknown as Tool,
    oaAnalyzeTool as unknown as Tool,
    examinerTool as unknown as Tool,
    queryTool as unknown as Tool,
    searchTool as unknown as Tool,
    similarTool as unknown as Tool,
    citationsTool as unknown as Tool,
    familyTool as unknown as Tool,
    cpcTool as unknown as Tool,
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case balanceTool.name:    return await runBalance(api);
        case dossierTool.name:    return await runDossier(api, args ?? {});
        case prosecutionTool.name: return await runProsecution(api, args ?? {});
        case oaAnalyzeTool.name:  return await runOaAnalyze(api, args ?? {});
        case examinerTool.name:   return await runExaminer(api, args ?? {});
        case queryTool.name:      return await runQuery(api, args ?? {});
        case searchTool.name:     return await runSearch(api, args ?? {});
        case similarTool.name:    return await runSimilar(api, args ?? {});
        case citationsTool.name:  return await runCitations(api, args ?? {});
        case familyTool.name:     return await runFamily(api, args ?? {});
        case cpcTool.name:        return await runCpc(api, args ?? {});
        default:
          return errorResult(`Unknown tool: ${name}`);
      }
    } catch (err) {
      if (err instanceof PatentSearchApiError) {
        return errorResult(err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function errorResult(message: string): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

main().catch((err) => {
  process.stderr.write(
    `[patent-search-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
