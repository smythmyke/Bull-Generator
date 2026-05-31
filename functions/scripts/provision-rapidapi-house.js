/**
 * Provision the single RapidAPI "house" account — the billing-exempt credits
 * doc that all RapidAPI marketplace traffic binds to (RapidAPI is the ledger).
 * Idempotent. Prints the uid to set as PSG_RAPIDAPI_HOUSE_UID.
 *
 * Run: node scripts/provision-rapidapi-house.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "solicitation-matcher-extension" });
const db = admin.firestore();

const HOUSE_UID = process.env.PSG_RAPIDAPI_HOUSE_UID || "rapidapi-house";

(async () => {
  const ref = db.collection("credits").doc(HOUSE_UID);
  const snap = await ref.get();
  if (snap.exists && snap.data().billingExempt === true) {
    console.log(`House account already provisioned: ${HOUSE_UID} (billingExempt)`);
    process.exit(0);
  }
  await ref.set(
    {
      balance: 0,
      subscriptionCredits: 0,
      topupCredits: 0,
      totalPurchased: 0,
      totalUsed: 0,
      freeCreditsGranted: true,
      billingExempt: true,
      subscription: null,
      signupSource: "rapidapi",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`Provisioned RapidAPI house account.`);
  console.log(`  Set env:  PSG_RAPIDAPI_HOUSE_UID=${HOUSE_UID}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
