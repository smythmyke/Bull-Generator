/**
 * Phase 0 CLI runner for the FTO pipeline.
 *
 * Usage (from functions/ directory after `npm run build`):
 *   node fto-cli.js "Product description here..."
 *   node fto-cli.js --input ./product.txt
 *   node fto-cli.js --input ./product.txt --jurisdiction US --out ./fto-output
 *
 * Writes two artifacts to the output directory:
 *   {timestamp}-report.json    full structured report
 *   {timestamp}-report.md      human-readable markdown for examiner review
 *
 * The .env at functions/.env is loaded by the fto-cli.js shim before this
 * module runs (so GEMINI_API_KEY + USPTO_ODP_API_KEY are available).
 */

import * as fs from "fs";
import * as path from "path";
import { runFtoPipeline } from "./pipeline";
import { FtoReport, FtoRunInput, Jurisdiction } from "./types";

interface CliArgs {
  description: string;
  jurisdiction: Jurisdiction;
  outDir: string;
  label: string;
}

function printUsageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  node fto-cli.js \"<product description>\" [--jurisdiction US|EU] [--out <dir>] [--label <slug>]",
      "  node fto-cli.js --input <file> [--jurisdiction US|EU] [--out <dir>] [--label <slug>]",
      "",
      "Defaults: --jurisdiction US --out ./fto-output --label <auto-timestamp>",
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let description = "";
  let jurisdiction: Jurisdiction = "US";
  let outDir = path.join(process.cwd(), "fto-output");
  let inputFile = "";
  let label = "";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--input") inputFile = args[++i] || "";
    else if (a === "--jurisdiction") {
      const j = (args[++i] || "").toUpperCase();
      if (j !== "US" && j !== "EU") {
        console.error(`Invalid jurisdiction: ${j}`);
        printUsageAndExit();
      }
      jurisdiction = j as Jurisdiction;
    } else if (a === "--out") outDir = args[++i] || outDir;
    else if (a === "--label") label = args[++i] || "";
    else if (a === "--help" || a === "-h") printUsageAndExit();
    else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      printUsageAndExit();
    } else if (!description) description = a;
    else {
      console.error(`Unexpected positional arg: ${a}`);
      printUsageAndExit();
    }
  }

  if (inputFile) {
    if (description) {
      console.error("Provide either a positional description or --input, not both.");
      printUsageAndExit();
    }
    description = fs.readFileSync(inputFile, "utf8").trim();
  }

  if (!description) {
    console.error("Product description required.");
    printUsageAndExit();
  }

  if (!label) {
    label = new Date().toISOString().replace(/[:.]/g, "-");
  }

  return { description, jurisdiction, outDir, label };
}

function ensureOutDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function formatReportMd(report: FtoReport, label: string): string {
  const lines: string[] = [];
  lines.push(`# FTO Report — ${label}`);
  lines.push("");
  lines.push(`**Jurisdiction:** ${report.input.jurisdiction}`);
  lines.push(`**Started:** ${report.startedAt}`);
  lines.push(`**Completed:** ${report.completedAt}`);
  lines.push("");
  lines.push("> _Automated screening output, not legal advice. Active-patent status and infringement risk assessments are best-effort and may be incomplete or incorrect. Obtain a formal Freedom-to-Operate opinion from a registered patent attorney before commercializing._");
  lines.push("");

  if (report.needsClarification) {
    lines.push("## Needs clarification");
    lines.push("");
    lines.push(report.needsClarification.reason);
    lines.push("");
    for (const q of report.needsClarification.followUps) lines.push(`- ${q}`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push("## Product description");
  lines.push("");
  lines.push("```");
  lines.push(report.input.productDescription);
  lines.push("```");
  lines.push("");

  if (report.productCpcs) {
    lines.push("## CPC scope (applied to every Stage 2 search)");
    lines.push("");
    if (report.productCpcs.cpcCodes.length > 0) {
      lines.push(`Codes: ${report.productCpcs.cpcCodes.map((c) => `\`${c}\``).join(", ")}`);
    } else {
      lines.push("_(none — search ran unconstrained)_");
    }
    if (report.productCpcs.reasoning) {
      lines.push("");
      lines.push(`Reasoning: ${report.productCpcs.reasoning}`);
    }
    lines.push("");
  }

  lines.push(`## Features extracted (${report.features.length})`);
  lines.push("");
  for (const f of report.features) {
    lines.push(`### ${f.id} — ${f.name} *(${f.category})*`);
    lines.push(f.description);
    lines.push("");
    lines.push(`Search terms: ${f.searchTerms.map((t) => `\`${t}\``).join(", ")}`);
    lines.push("");
  }

  if (report.synthesis) {
    lines.push("## Executive summary");
    lines.push("");
    lines.push(report.synthesis.executiveSummary);
    lines.push("");

    lines.push("## Top risks");
    lines.push("");
    for (const r of report.synthesis.topRisks) {
      lines.push(`- **${r.patentNumber}** — ${r.summary}`);
    }
    lines.push("");

    lines.push("## Recommendations");
    lines.push("");
    for (const rec of report.synthesis.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push("");
  }

  lines.push(`## Risk matrix (${report.riskMatrix.length} cells)`);
  lines.push("");
  if (report.riskMatrix.length === 0) {
    lines.push("_(no cells — stages not yet implemented)_");
  } else {
    lines.push("| Patent | Feature | Score | Verified | Cited element |");
    lines.push("|---|---|---|---|---|");
    for (const cell of report.riskMatrix) {
      const verified = cell.verified
        ? "✓"
        : cell.verificationFailed
        ? "✗ failed"
        : cell.unverified
        ? "— (capped)"
        : "—";
      const cited = (cell.citedElements[0] || "").slice(0, 80);
      lines.push(
        `| ${cell.patentNumber} | ${cell.featureId} | ${cell.score} | ${verified} | ${cited} |`
      );
    }
  }
  lines.push("");

  lines.push("## Cost & timing");
  lines.push("");
  lines.push(`- Gemini calls: ${report.costTracking.geminiCalls}`);
  lines.push(`- Input tokens: ${report.costTracking.inputTokens}`);
  lines.push(`- Output tokens: ${report.costTracking.outputTokens}`);
  lines.push(`- Google Patents fetches: ${report.costTracking.googlePatentsFetches}`);
  lines.push(`- USPTO ODP fetches: ${report.costTracking.odpFetches}`);
  lines.push(`- Estimated cost: $${report.costTracking.estimatedCostUsd.toFixed(4)}`);
  lines.push("");
  lines.push("Per-stage timings (ms):");
  for (const [stage, ms] of Object.entries(report.costTracking.stageTimingsMs)) {
    lines.push(`- ${stage}: ${ms} ms`);
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  ensureOutDir(args.outDir);

  const input: FtoRunInput = {
    productDescription: args.description,
    jurisdiction: args.jurisdiction,
  };

  console.log(`[fto-cli] starting run "${args.label}" (jurisdiction=${args.jurisdiction})`);
  console.log(`[fto-cli] product description: ${args.description.slice(0, 200)}${args.description.length > 200 ? "..." : ""}`);
  console.log("");

  const report = await runFtoPipeline(input, (stage, message, completed, total) => {
    const progress = completed !== undefined && total !== undefined ? ` (${completed}/${total})` : "";
    console.log(`[${stage}]${progress} ${message}`);
  });

  const jsonPath = path.join(args.outDir, `${args.label}-report.json`);
  const mdPath = path.join(args.outDir, `${args.label}-report.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, formatReportMd(report, args.label));

  console.log("");
  console.log(`[fto-cli] wrote: ${jsonPath}`);
  console.log(`[fto-cli] wrote: ${mdPath}`);
  console.log(`[fto-cli] done.`);
}

main().catch((err) => {
  console.error("[fto-cli] fatal error:", err);
  process.exit(1);
});
