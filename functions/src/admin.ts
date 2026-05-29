import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import {PlatformSource} from "./credits";

export const ADMIN_UID = "cqNTaHoSMLgXGMsk1vXWxFYnTXH3";

/**
 * Should a given email be excluded from all stats counters? Mirrors the
 * predicate used by JackpotKeywords and MarkItUp admin handlers — keep these
 * in sync.
 */
function isExcludedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (e === "smythmyke@gmail.com") return true;
  if (e.endsWith("@example.com")) return true;
  if (e.includes("test")) return true;
  return false;
}

/**
 * Build a uid → email map by paginating through Firebase Auth. Credits docs
 * are keyed by uid; the exclusion predicate is by email — we need the bridge.
 */
async function buildUidToEmailMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  let pageToken: string | undefined;
  do {
    const r = await admin.auth().listUsers(1000, pageToken);
    for (const u of r.users) {
      if (u.email) map[u.uid] = u.email;
    }
    pageToken = r.pageToken;
  } while (pageToken);
  return map;
}

const SOURCE_BUCKETS: readonly (PlatformSource | "unknown")[] = [
  "extension", "website", "mcp", "api", "unknown",
];

function bucketSource(value: unknown): PlatformSource | "unknown" {
  if (typeof value !== "string") return "unknown";
  return (SOURCE_BUCKETS as readonly string[]).includes(value)
    ? (value as PlatformSource | "unknown")
    : "unknown";
}

function zeroSourceMap(): Record<string, number> {
  return Object.fromEntries(SOURCE_BUCKETS.map((s) => [s, 0]));
}

function zeroRevenueMap(): Record<string, {topup: number; subscription: number; total: number}> {
  return Object.fromEntries(
    SOURCE_BUCKETS.map((s) => [s, {topup: 0, subscription: 0, total: 0}])
  );
}

function requireAdmin(uid: string): void {
  if (uid !== ADMIN_UID) {
    throw new functions.https.HttpsError("permission-denied", "Admin access required");
  }
}

export async function handleAdminRequest(
  path: string,
  body: Record<string, unknown>,
  user: admin.auth.DecodedIdToken
): Promise<unknown> {
  requireAdmin(user.uid);

  const db = admin.firestore();
  const subPath = path.replace(/^\/admin\/?/, "");

  switch (subPath) {
    case "dashboard": {
      // Aggregate stats across all users
      const creditsSnap = await db.collection("credits").get();
      let totalUsers = 0;
      let totalBalance = 0;
      let totalPurchased = 0;
      let totalUsed = 0;
      let adminBalance = 0;
      let adminPurchased = 0;
      let adminUsed = 0;

      // Pull uid→email map once so we can run the email-based exclusion
      // predicate against credits docs (which are keyed by uid).
      const uidToEmail = await buildUidToEmailMap();
      const isExcludedUid = (uid: string): boolean =>
        uid === ADMIN_UID || isExcludedEmail(uidToEmail[uid]);

      // Source attribution rollups — accumulated during the existing scans.
      const usageBySource = zeroSourceMap();
      const usersBySignupSource = zeroSourceMap();

      const purchasePromises: Promise<{
        amountPaid: number;
        credits: number;
        revenueBuckets: Record<string, {topup: number; subscription: number; total: number}>;
      }>[] = [];

      creditsSnap.forEach((doc) => {
        const data = doc.data();
        totalUsers++;
        totalBalance += data.balance || 0;
        totalPurchased += data.totalPurchased || 0;
        totalUsed += data.totalUsed || 0;

        if (doc.id === ADMIN_UID) {
          adminBalance = data.balance || 0;
          adminPurchased = data.totalPurchased || 0;
          adminUsed = data.totalUsed || 0;
        }

        // Per-surface usage counters skip admin AND smoke-test accounts so
        // internal usage never pollutes the dashboard. Revenue rollup below
        // applies the same filter.
        if (!isExcludedUid(doc.id)) {
          usageBySource.extension += data.usedFromExtension || 0;
          usageBySource.website += data.usedFromWebsite || 0;
          usageBySource.mcp += data.usedFromMcp || 0;
          usageBySource.api += data.usedFromApi || 0;
          usersBySignupSource[bucketSource(data.signupSource)] += 1;
        }

        // Collect real purchase data from subcollections — same exclusion as
        // the per-surface counters above.
        if (isExcludedUid(doc.id)) return;
        purchasePromises.push(
          db.collection("credits").doc(doc.id).collection("purchases").get().then((snap) => {
            let amountPaid = 0;
            let credits = 0;
            const revenueBuckets = zeroRevenueMap();
            snap.forEach((p) => {
              const pd = p.data();
              const amount = pd.amountPaid || 0;
              amountPaid += amount;
              credits += pd.credits || 0;

              // Attribute revenue to source × kind. Subscription invoices were
              // tagged with kind:"subscription" by the webhook; everything else
              // is a top-up.
              const bucket = bucketSource(pd.source);
              const kind = pd.kind === "subscription" ? "subscription" : "topup";
              revenueBuckets[bucket][kind] += amount;
              revenueBuckets[bucket].total += amount;
            });
            return {amountPaid, credits, revenueBuckets};
          })
        );
      });

      const purchaseResults = await Promise.all(purchasePromises);
      let realRevenueCents = 0;
      let realCreditsPurchased = 0;
      const revenueBySource = zeroRevenueMap();
      for (const p of purchaseResults) {
        realRevenueCents += p.amountPaid;
        realCreditsPurchased += p.credits;
        for (const [src, buckets] of Object.entries(p.revenueBuckets)) {
          revenueBySource[src].topup += buckets.topup;
          revenueBySource[src].subscription += buckets.subscription;
          revenueBySource[src].total += buckets.total;
        }
      }

      // Get total auth users count
      const authUsers = await admin.auth().listUsers(1000);

      return {
        totalAuthUsers: authUsers.users.length,
        totalCreditUsers: totalUsers,
        totalBalance,
        totalPurchased,
        totalUsed,
        // Admin-excluded stats
        userBalance: totalBalance - adminBalance,
        userPurchased: totalPurchased - adminPurchased,
        userUsed: totalUsed - adminUsed,
        // Real revenue from Stripe purchases
        revenueCents: realRevenueCents,
        realCreditsPurchased,
        adminBalance,
        adminPurchased,
        adminUsed,
        // Source attribution rollups (extension / website / mcp / api / unknown)
        usageBySource,
        revenueBySource,
        usersBySignupSource,
      };
    }

    case "users": {
      // List all users with credit info
      const authUsers = await admin.auth().listUsers(1000);
      const creditsSnap = await db.collection("credits").get();

      const creditMap = new Map<string, Record<string, unknown>>();
      creditsSnap.forEach((doc) => {
        creditMap.set(doc.id, doc.data());
      });

      const users = authUsers.users.map((u) => {
        const credits = creditMap.get(u.uid);
        return {
          uid: u.uid,
          email: u.email || "",
          displayName: u.displayName || "",
          createdAt: u.metadata.creationTime || null,
          lastSignIn: u.metadata.lastSignInTime || null,
          balance: credits?.balance ?? 0,
          totalPurchased: credits?.totalPurchased ?? 0,
          totalUsed: credits?.totalUsed ?? 0,
        };
      });

      return {users};
    }

    case "user-usage": {
      const uid = body.uid as string;
      if (!uid) {
        throw new functions.https.HttpsError("invalid-argument", "uid is required");
      }

      const usageSnap = await db
        .collection("credits")
        .doc(uid)
        .collection("usage")
        .orderBy("timestamp", "desc")
        .limit(100)
        .get();

      const usage = usageSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          action: data.action,
          amount: data.amount,
          balanceBefore: data.balanceBefore,
          balanceAfter: data.balanceAfter,
          timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
        };
      });

      return {usage};
    }

    case "user-purchases": {
      const uid = body.uid as string;
      if (!uid) {
        throw new functions.https.HttpsError("invalid-argument", "uid is required");
      }

      const purchasesSnap = await db
        .collection("credits")
        .doc(uid)
        .collection("purchases")
        .orderBy("date", "desc")
        .limit(50)
        .get();

      const purchases = purchasesSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          date: data.date?.toDate?.()?.toISOString() || null,
          packId: data.packId,
          packLabel: data.packLabel,
          credits: data.credits,
          amountPaid: data.amountPaid,
        };
      });

      return {purchases};
    }

    case "grant-credits": {
      const uid = body.uid as string;
      const amount = body.amount as number;
      if (!uid || !amount || amount < 1) {
        throw new functions.https.HttpsError("invalid-argument", "uid and amount (>= 1) required");
      }

      const docRef = db.collection("credits").doc(uid);
      const snap = await docRef.get();

      if (!snap.exists) {
        throw new functions.https.HttpsError("not-found", "No credit record for this user");
      }

      await docRef.update({
        balance: admin.firestore.FieldValue.increment(amount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log the grant
      await db.collection("credits").doc(uid).collection("usage").add({
        action: "admin:grant",
        amount: -amount, // negative = credits added
        balanceBefore: snap.data()?.balance || 0,
        balanceAfter: (snap.data()?.balance || 0) + amount,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      const updated = await docRef.get();
      return {balance: updated.data()?.balance || 0};
    }

    default:
      throw new functions.https.HttpsError("not-found", `Unknown admin endpoint: ${subPath}`);
  }
}
