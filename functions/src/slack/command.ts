import * as admin from "firebase-admin";
import { verifySlackSignature } from "./verify";
import { postResponseUrl } from "./client";
import { getActiveInstall, touchInstallLastUsed } from "./install";
import { SlackSlashCommandBody } from "./types";
import { handlePatentDossierRequest, handleClaimsRequest, handleSimilarRequest, handleCitationsRequest, handleFamilyRequest } from "../patentDossier";
import { handleStandaloneClaimChartRequest } from "../claimChart";
import { handleProsecutionHistoryRequest } from "../usptoOdp";
import { handleOfficeActionAnalysisRequest } from "../officeActionAnalyzer";
import { handleExaminerStatsRequest } from "../examinerStats";
import { handleSearchExecuteRequest, handleSearchQueryRequest } from "../searchExecute";
import { handleCpcRequest } from "../cpc";
import { handleCpcSuggestRequest } from "../cpcSuggest";
import { getBalance, useCredit } from "../credits";

interface ReqLike {
  rawBody: Buffer | string;
  body: SlackSlashCommandBody | Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
}

interface ResLike {
  status: (code: number) => { json: (data: unknown) => void; send: (body: string) => void };
}

/**
 * Slash command webhook entry point. POST /slackBot/command from Slack.
 *
 * Flow:
 *   1. Verify signing secret + parse body.
 *   2. Look up install by team_id → get linkedUserUid for credit attribution.
 *   3. Ack within 3s with an ephemeral "Looking up..." message.
 *   4. Run the actual command (5-15s typical) and post the result to response_url.
 */
export async function handleSlackCommand(req: ReqLike, res: ResLike): Promise<void> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    res.status(500).json({ text: "Slack integration not configured." });
    return;
  }

  const rawBody = typeof req.rawBody === "string" ? req.rawBody : req.rawBody.toString("utf8");
  const sig = pickHeader(req.headers, "x-slack-signature");
  const ts = pickHeader(req.headers, "x-slack-request-timestamp");
  if (!verifySlackSignature(rawBody, sig, ts, signingSecret)) {
    res.status(401).json({ text: "Invalid Slack signature." });
    return;
  }

  const body = req.body as SlackSlashCommandBody;
  if (!body.team_id || !body.command || !body.response_url) {
    res.status(400).json({ text: "Malformed slash command payload." });
    return;
  }

  const install = await getActiveInstall(body.team_id);
  if (!install) {
    res.status(200).json({
      response_type: "ephemeral",
      text: "AI Patent Search Generator isn't installed in this workspace. Install it from the extension's Admin tab.",
    });
    return;
  }
  void touchInstallLastUsed(body.team_id);

  // Firebase Functions v1 terminates HTTP handlers right after the response is
  // sent, so we can't reliably "ack then work in background". Instead, we run
  // the work synchronously and post the result via response_url, then ack.
  // For cached operations (<2s) Slack is happy. For slow ops Slack will show
  // a timeout warning, but the response_url POST still lands and the user
  // sees the actual result. Proper fix is Cloud Tasks — deferred to v1.1.
  console.log("[slack/command] start", { command: body.command, team: body.team_id, hasArg: !!body.text });
  try {
    await runCommand(install.linkedUserUid, body);
    console.log("[slack/command] done", { command: body.command });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[slack/command] runCommand error", { command: body.command, message });
    await postResponseUrl(body.response_url, {
      response_type: "ephemeral",
      replace_original: true,
      text: `:warning: ${message}`,
    });
  }
  res.status(200).send("");
}

async function runCommand(uid: string, body: SlackSlashCommandBody): Promise<void> {
  const db = admin.firestore();
  const arg = (body.text || "").trim();
  const responseUrl = body.response_url;

  switch (body.command) {
    case "/balance": {
      const bal = await getBalance(db, uid);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: `*Credits remaining:* ${bal.balance}\n_Top up from the extension's Tools tab._`,
      });
      return;
    }

    case "/dossier": {
      requireArg(arg, "patent number (e.g. US10867416B2)");
      const result = await handlePatentDossierRequest({ patentNumber: arg });
      if (result.error) throw new Error(result.error);
      const dossier = result.dossier!;
      if (!dossier.cached) {
        await useCredit(db, uid, `dossier:${dossier.patentNumber}`, 3, "slack");
      }
      const lines = [
        `*${dossier.patentNumber} — ${dossier.header.title || "(no title)"}*`,
        dossier.header.currentAssignee ? `Assignee: ${dossier.header.currentAssignee}` : null,
        `Status: ${dossier.header.statusLabel}`,
        `Filed: ${dossier.header.filingDate || "?"} • Granted: ${dossier.header.grantDate || "?"}`,
        `Claims: ${dossier.claims.totalCount} (independent: ${dossier.claims.independentNumbers.join(", ") || "n/a"})`,
        `Citations: ${dossier.citations.backwardCount} backward / ${dossier.citations.forwardCount} forward`,
        dossier.cached ? "_(cached — free)_" : "_(fresh — 3 credits)_",
      ].filter((s): s is string => s !== null);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/claims": {
      requireArg(arg, "patent number");
      const result = await handleClaimsRequest({ patentNumber: arg });
      if (result.error) throw new Error(result.error);
      if (result.cached === false) {
        await useCredit(db, uid, `claims:${result.patentNumber}`, 1, "slack");
      }
      const claims = result.claims!;
      const indep = claims.items.filter((c) => c.isIndependent);
      const lines = [
        `*${result.patentNumber} — ${claims.totalCount} claims (${indep.length} independent)*`,
        result.cached ? "_(cached — free)_" : "_(fresh — 1 credit)_",
        "",
        ...indep.slice(0, 3).map((c) => `*Claim ${c.number}:* ${truncate(c.text, 400)}`),
        indep.length > 3 ? `_…and ${indep.length - 3} more independent claims._` : null,
      ].filter((s): s is string => s !== null);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/claim-chart": {
      requireArg(arg, "patent number");
      const result = await handleStandaloneClaimChartRequest({ patentNumber: arg });
      if (result.error) throw new Error(result.error);
      if (result.dossierCacheHit === false) {
        await useCredit(db, uid, `claim-chart:${result.chart!.patentNumber}`, 3, "slack");
      }
      const chart = result.chart!;
      const indep = chart.claimCharts.filter((c) => c.isIndependent);
      const lines = [
        `*${chart.patentNumber} — claim chart*`,
        `${indep.length} independent claims; ${chart.analyzedOaCount} OAs analyzed`,
        result.dossierCacheHit ? "_(cached — free)_" : "_(fresh — 3 credits)_",
        "",
        ...indep.slice(0, 2).flatMap((c) => [
          `*Claim ${c.claimNumber}:* ${c.status}${c.statusReasoning ? ` — ${c.statusReasoning}` : ""}`,
          ...c.elements.slice(0, 4).map((el) => {
            const refs = el.citedReferences.length === 0
              ? "no cited art"
              : el.citedReferences.map((r) => `${r.patentNumber} §${r.rejectionStatute}`).join(", ");
            return `  • [${el.label}] ${refs}`;
          }),
        ]),
        indep.length > 2 ? `_…and ${indep.length - 2} more independent claims._` : null,
      ].filter((s): s is string => s !== null);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/prosecution": {
      requireArg(arg, "patent number");
      const { applicationNumber, coldDossier } = await resolveAppNumber(arg, uid, db);
      const result = await handleProsecutionHistoryRequest({ applicationNumber });
      if (result.error) throw new Error(result.error);
      const history = result.history!;
      const docs = (history.documents || []).slice(0, 10);
      const lines = [
        `*Prosecution history for ${arg}* (app ${applicationNumber}, ${history.documents?.length ?? 0} documents)`,
        ...docs.map((d) => `• ${d.date || "?"} — ${d.category || "?"}: ${d.description || d.documentId}`),
        (history.documents?.length ?? 0) > 10 ? `_…and ${history.documents!.length - 10} more._` : null,
        coldDossier ? "_(3 credits charged for the dossier lookup)_" : null,
      ].filter((s): s is string => s !== null);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/oa-analyze": {
      requireArg(arg, "patent number");
      const { applicationNumber, coldDossier } = await resolveAppNumber(arg, uid, db);
      // Pick most recent OA from prosecution history
      const prosecution = await handleProsecutionHistoryRequest({ applicationNumber });
      if (prosecution.error) throw new Error(prosecution.error);
      const oas = (prosecution.history?.documents || [])
        .filter((d) => d.category === "office-action")
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      if (oas.length === 0) {
        await postResponseUrl(responseUrl, {
          response_type: "ephemeral",
          replace_original: true,
          text: `*${arg}* — no Office Actions found for application ${applicationNumber}`,
        });
        return;
      }
      const docId = oas[0].documentId;
      const result = await handleOfficeActionAnalysisRequest({ applicationNumber, documentId: docId }, uid);
      if (result.error) throw new Error(result.error);
      if (result.billed) {
        await useCredit(db, uid, `oa:${result.analysis!.documentId}`, 1, "slack");
      }
      const a = result.analysis!;
      const costs: string[] = [];
      if (coldDossier) costs.push("3cr dossier");
      if (result.billed) costs.push("1cr OA analysis");
      const lines = [
        `*Office Action — ${arg}* (doc ${a.documentId}, ${a.mailDate || "?"})`,
        a.examinerName ? `Examiner: ${a.examinerName}${a.artUnit ? ` (Art Unit ${a.artUnit})` : ""}` : null,
        "",
        `*Rejections:*`,
        ...a.rejections.slice(0, 5).map((r) => `• §${r.statute}: claims ${r.claimsAffected} — ${r.citedReferences.join(", ") || "no refs"}`),
        "",
        `*Cited art:* ${a.citedArt.slice(0, 8).map((c) => c.patentNumber).join(", ") || "none"}`,
        costs.length > 0 ? `_(charged: ${costs.join(" + ")})_` : "_(free — within quota)_",
      ].filter((s): s is string => s !== null);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/examiner": {
      requireArg(arg, "patent number");
      const { applicationNumber, coldDossier } = await resolveAppNumber(arg, uid, db);
      const result = await handleExaminerStatsRequest({ applicationNumber });
      if (result.error) throw new Error(result.error);
      const stats = result.stats!;
      const avgPendencyMonths = stats.avgPendencyDays / 30;
      const lines = [
        `*Examiner for ${arg}*`,
        stats.examinerName ? `Name: ${stats.examinerName}` : null,
        stats.artUnit ? `Art Unit: ${stats.artUnit}` : null,
        typeof stats.allowanceRate === "number" ? `Allowance rate: ${(stats.allowanceRate * 100).toFixed(1)}%` : null,
        typeof stats.avgPendencyDays === "number" ? `Avg pendency: ${avgPendencyMonths.toFixed(1)} months` : null,
        typeof stats.totalApplications === "number" ? `Total applications: ${stats.totalApplications}` : null,
        coldDossier ? "_(3 credits charged for the dossier lookup)_" : null,
      ].filter((s): s is string => s !== null);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.length > 1 ? lines.join("\n") : `*${arg}* — examiner data not available`,
      });
      return;
    }

    case "/query": {
      requireArg(arg, "description of invention");
      const result = await handleSearchQueryRequest({ description: arg });
      if (result.error) throw new Error(result.error);
      await useCredit(db, uid, "search:query", 1, "slack");
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: `*Boolean query for:* ${arg}\n\n\`\`\`\n${result.optimizedQuery || ""}\n\`\`\`\n_Paste into Google Patents Advanced Search. 1 credit charged._`,
      });
      return;
    }

    case "/patent-search": {
      requireArg(arg, "description of invention");
      const result = await handleSearchExecuteRequest({ description: arg });
      if (result.error) throw new Error(result.error);
      await useCredit(db, uid, "search:execute", 1, "slack");
      const hits = (result.hits || []).slice(0, 8);
      const lines = [
        `*Patent search results for:* ${arg}`,
        `${result.totalHits ?? hits.length} total hits — top ${hits.length}:`,
        "",
        ...hits.map((h, i) => `${i + 1}. *${h.publicationNumber}* — ${truncate(h.title || "(no title)", 100)}`),
        "_(1 credit charged)_",
      ];
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/similar": {
      requireArg(arg, "patent number");
      const result = await handleSimilarRequest({ patentNumber: arg });
      if (result.error) throw new Error(result.error);
      const similar = (result.similar || []).slice(0, 10);
      const lines = [
        `*Similar to ${result.patentNumber}:*`,
        ...similar.map((s, i) => `${i + 1}. ${s.patentNumber} — ${truncate(s.title || "(no title)", 100)}`),
        result.cached ? "_(cached — free)_" : "_(fresh — free)_",
      ];
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/citations": {
      requireArg(arg, "patent number");
      const result = await handleCitationsRequest({ patentNumber: arg, direction: "both" });
      if (result.error) throw new Error(result.error);
      const lines = [
        `*Citations for ${result.patentNumber}*`,
        `Backward: ${result.backwardCount ?? 0} • Forward: ${result.forwardCount ?? 0}`,
        "",
        "*Backward (this patent cites):*",
        ...(result.backward || []).slice(0, 5).map((c) => `• ${c.patentNumber}${c.examinerCited ? " 🔍" : ""} — ${truncate(c.title || "", 80)}`),
        "",
        "*Forward (cites this patent):*",
        ...(result.forward || []).slice(0, 5).map((c) => `• ${c.patentNumber} — ${truncate(c.title || "", 80)}`),
      ];
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/family": {
      requireArg(arg, "patent number");
      const result = await handleFamilyRequest({ patentNumber: arg });
      if (result.error) throw new Error(result.error);
      const family = result.family!;
      const members = (family.members || []).slice(0, 15);
      const lines = [
        `*Family for ${result.patentNumber}* (${family.members?.length ?? 0} members)`,
        ...members.map((m) => `• ${m.jurisdiction}: ${m.publicationNumber} (${m.type}, ${m.status}, ${m.date})`),
      ];
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/cpc": {
      requireArg(arg, "CPC code (e.g. H01M)");
      const result = await handleCpcRequest({ code: arg });
      if (result.error) throw new Error(result.error);
      const lines = [
        `*CPC ${result.code}*`,
        result.section ? `Section ${result.section.code}: ${result.section.title}` : null,
        result.subclass ? `Subclass ${result.subclass.code}: ${result.subclass.title}` : null,
        result.notes ? `_${result.notes}_` : null,
        result.uspoBrowserUrl ? `<${result.uspoBrowserUrl}|USPTO browser>` : null,
      ].filter((s): s is string => s !== null);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    case "/cpc-suggest": {
      requireArg(arg, "description of technology");
      const result = await handleCpcSuggestRequest({ description: arg });
      if (result.error) throw new Error(result.error);
      if (result.cached === false) {
        await useCredit(db, uid, "cpc-suggest", 1, "slack");
      }
      const lines = [
        `*CPC suggestions for:* ${truncate(arg, 120)}`,
        result.cached ? "_(cached — free)_" : "_(fresh — 1 credit)_",
        "",
        ...(result.suggestions || []).map((s) => `*[${s.confidence.toUpperCase()}]* \`${s.code}\` — ${s.title}\n_${s.reasoning}_`),
        result.notes ? `\n_${result.notes}_` : null,
      ].filter((s): s is string => s !== null);
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: lines.join("\n"),
      });
      return;
    }

    default:
      await postResponseUrl(responseUrl, {
        response_type: "ephemeral",
        replace_original: true,
        text: `Unknown command: ${body.command}`,
      });
  }
}

function requireArg(arg: string, label: string): void {
  if (!arg) throw new Error(`Missing argument. Expected: ${label}`);
}

// Several USPTO endpoints (/prosecution, /examiner, /oa-analyze) take an
// applicationNumber, but Slack users hand us patent publication numbers.
// Resolve via the dossier — free if the patent's dossier is in the 24h cache,
// 3cr if cold. The cold cost is reported back in the response so the user
// sees what they were billed.
async function resolveAppNumber(
  patentNumber: string,
  uid: string,
  db: admin.firestore.Firestore
): Promise<{ applicationNumber: string; coldDossier: boolean }> {
  const dossierResult = await handlePatentDossierRequest({ patentNumber });
  if (dossierResult.error || !dossierResult.dossier) {
    throw new Error(dossierResult.error || "Could not fetch patent dossier");
  }
  const dossier = dossierResult.dossier;
  const appNumber = (dossier.header.applicationNumber || "").replace(/\D/g, "");
  if (!appNumber || appNumber.length < 6) {
    throw new Error(`Could not determine application number for ${patentNumber}`);
  }
  if (!dossier.cached) {
    await useCredit(db, uid, `dossier:${patentNumber}`, 3, "slack");
  }
  return { applicationNumber: appNumber, coldDossier: !dossier.cached };
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const v = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}
