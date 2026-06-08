/**
 * Seed the Claude Connector Directory reviewer account
 * (mcp-review@anthropic.com) with credits BEFORE their first sign-in.
 *
 * Create-if-missing on BOTH sides (runbook gotcha — the grant script must
 * create the doc if missing):
 *   1. Firebase Auth user for the email (so the connector's WorkOS
 *      email -> getUserByEmail mapping lands on this exact uid).
 *   2. credits/{uid} doc topped up to the target balance.
 *
 * Usage:  node scripts/seed-reviewer.js [email] [credits]
 * Defaults: mcp-review@anthropic.com, 500 credits.
 * Idempotent: re-running tops the balance back UP to the target (never down).
 */
const admin = require("firebase-admin");

admin.initializeApp({projectId: "solicitation-matcher-extension"});

const email = process.argv[2] || "mcp-review@anthropic.com";
const target = Number(process.argv[3] || 500);

async function main() {
  // 1. Auth user — create if missing
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    console.log(`Auth user exists: ${user.uid}`);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await admin.auth().createUser({email, emailVerified: true});
    console.log(`Auth user created: ${user.uid}`);
  }

  // 2. Credits doc — create if missing, top up to target
  const db = admin.firestore();
  const ref = db.collection("credits").doc(user.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        balance: target,
        topupCredits: target,
        subscriptionCredits: 0,
        totalUsed: 0,
        totalPurchased: target,
        freeCreditsGranted: true,
        signupSource: "mcp",
        reviewerSeed: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Credits doc created with ${target} credits.`);
      return;
    }
    const data = snap.data();
    const current = (data.subscriptionCredits || 0) + (data.topupCredits ?? data.balance ?? 0);
    if (current >= target) {
      console.log(`Balance already ${current} (>= ${target}) — no top-up.`);
      return;
    }
    const delta = target - current;
    tx.update(ref, {
      balance: admin.firestore.FieldValue.increment(delta),
      topupCredits: admin.firestore.FieldValue.increment(delta),
      totalPurchased: admin.firestore.FieldValue.increment(delta),
      reviewerSeed: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Topped up ${current} -> ${target} (+${delta}).`);
  });

  console.log(`Done: ${email} -> uid ${user.uid}, balance >= ${target}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
