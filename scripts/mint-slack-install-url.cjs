// One-off helper to mint a Slack install OAuth URL.
//
//   node scripts/mint-slack-install-url.cjs --email smythmyke@gmail.com
//   node scripts/mint-slack-install-url.cjs --uid cqNTaHoSMLgXGMsk1vXWxFYnTXH3
//
// Writes a slackInstallSessions/{sessionId} doc with the given uid (10-min TTL),
// then prints the OAuth URL. Paste it in your browser, click Allow, and the
// slackBot/install/callback Cloud Function will validate the state and mint
// a per-workspace API key for this user.
//
// Requires:
//   - gcloud Application Default Credentials (`gcloud auth application-default login`)
//   - SLACK_CLIENT_ID env var set, OR a default below
//   - firebase-admin (resolved from functions/node_modules)

const path = require("path");
const crypto = require("crypto");

const PROJECT_ID = "solicitation-matcher-extension";
// The Client ID is public; can be hardcoded here so the script Just Works.
// Override with SLACK_CLIENT_ID env var if you ever rotate it.
const DEFAULT_SLACK_CLIENT_ID = "11165668295348.11219332035027";
const REDIRECT_URI =
  "https://us-central1-solicitation-matcher-extension.cloudfunctions.net/slackBot/install/callback";
const SCOPES = ["commands", "chat:write"];
const SESSION_TTL_MS = 10 * 60 * 1000;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = val;
        i++;
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.uid && !args.email) {
    console.error("Usage:");
    console.error("  node scripts/mint-slack-install-url.cjs --uid   <firebase-uid>");
    console.error("  node scripts/mint-slack-install-url.cjs --email <email>");
    process.exit(1);
  }

  const clientId = process.env.SLACK_CLIENT_ID || DEFAULT_SLACK_CLIENT_ID;

  const adminPath = path.join(__dirname, "..", "functions", "node_modules", "firebase-admin");
  const admin = require(adminPath);
  admin.initializeApp({ projectId: PROJECT_ID });

  const auth = admin.auth();
  const db = admin.firestore();

  let user;
  try {
    user = args.email
      ? await auth.getUserByEmail(String(args.email))
      : await auth.getUser(String(args.uid));
  } catch (err) {
    console.error(`Could not resolve user: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }

  const sessionId = crypto.randomBytes(24).toString("base64url");
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + SESSION_TTL_MS);
  await db.collection("slackInstallSessions").doc(sessionId).set({
    uid: user.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES.join(","),
    redirect_uri: REDIRECT_URI,
    state: sessionId,
  });
  const url = `https://slack.com/oauth/v2/authorize?${params}`;

  console.log("");
  console.log(`User:        ${user.uid}${user.email ? ` (${user.email})` : ""}`);
  console.log(`Client ID:   ${clientId}`);
  console.log(`Scopes:      ${SCOPES.join(", ")}`);
  console.log(`Session ID:  ${sessionId}`);
  console.log(`Expires:     ${expiresAt.toDate().toISOString()} (10 min)`);
  console.log("");
  console.log("Open this URL in your browser, click Allow:");
  console.log("");
  console.log(`  ${url}`);
  console.log("");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
