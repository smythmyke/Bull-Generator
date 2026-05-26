// One-off: mint a test API key for the test account. Mirrors what the
// extension Admin tab UI will do in Day 2 (calls /keys/create internally).
// Usage: cd functions && node scripts/mint-test-key.js
const admin = require("firebase-admin");
const crypto = require("crypto");

const TEST_UID = "cqNTaHoSMLgXGMsk1vXWxFYnTXH3"; // smythmyke@gmail.com per MEMORY.md

admin.initializeApp({ projectId: "solicitation-matcher-extension" });

(async () => {
  const random = crypto.randomBytes(32).toString("base64url");
  const rawKey = `psg_live_${random}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const prefix = rawKey.slice(0, 16);

  const db = admin.firestore();
  const docRef = db.collection("apiKeys").doc();
  await docRef.set({
    uid: TEST_UID,
    name: "Day-1 smoke test",
    keyHash,
    prefix,
    environment: "live",
    scopes: ["dossier", "search", "oa-analyze", "prosecution", "credits:read"],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUsedAt: null,
    revokedAt: null,
  });

  console.log("KEY_ID:", docRef.id);
  console.log("RAW_KEY:", rawKey);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
