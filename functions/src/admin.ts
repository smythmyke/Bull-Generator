import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

const ADMIN_UID = "cqNTaHoSMLgXGMsk1vXWxFYnTXH3";

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

      const purchasePromises: Promise<{ amountPaid: number; credits: number }>[] = [];

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

        // Collect real purchase data from subcollections
        purchasePromises.push(
          db.collection("credits").doc(doc.id).collection("purchases").get().then((snap) => {
            let amountPaid = 0;
            let credits = 0;
            snap.forEach((p) => {
              const pd = p.data();
              amountPaid += pd.amountPaid || 0;
              credits += pd.credits || 0;
            });
            return { amountPaid, credits };
          })
        );
      });

      const purchaseResults = await Promise.all(purchasePromises);
      let realRevenueCents = 0;
      let realCreditsPurchased = 0;
      for (const p of purchaseResults) {
        realRevenueCents += p.amountPaid;
        realCreditsPurchased += p.credits;
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
