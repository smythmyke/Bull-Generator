import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

// Credit pack definitions
export const CREDIT_PACKS = [
  {id: "pack_10", credits: 10, price: 200, label: "10 searches", perCredit: "$0.20"},
  {id: "pack_25", credits: 25, price: 450, label: "25 searches", perCredit: "$0.18"},
  {id: "pack_50", credits: 50, price: 800, label: "50 searches", perCredit: "$0.16"},
  {id: "pack_100", credits: 100, price: 1500, label: "100 searches", perCredit: "$0.15"},
] as const;

const STARTER_CREDITS = 5;

// Endpoints that are free (no credit cost)
// synonyms/definitions = free tools; enrich-npl = data lookups, not AI
export const FREE_ENDPOINTS = new Set(["/synonyms", "/definitions", "/enrich-npl", "/extract-concepts"]);

interface CreditDoc {
  balance: number;
  totalPurchased: number;
  totalUsed: number;
  starterCredited: boolean;
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
}

function defaultCreditDoc(): CreditDoc {
  return {
    balance: STARTER_CREDITS,
    totalPurchased: 0,
    totalUsed: 0,
    starterCredited: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

export async function getBalance(
  db: FirebaseFirestore.Firestore,
  uid: string
): Promise<{balance: number; totalUsed: number}> {
  const docRef = db.collection("credits").doc(uid);
  const snap = await docRef.get();

  if (!snap.exists) {
    // New user — initialize with starter credits
    await docRef.set(defaultCreditDoc());
    return {balance: STARTER_CREDITS, totalUsed: 0};
  }

  const data = snap.data() as CreditDoc;

  // Migrate legacy users who never got starter credits
  if (!data.starterCredited) {
    await docRef.update({
      balance: admin.firestore.FieldValue.increment(STARTER_CREDITS),
      starterCredited: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {balance: (data.balance || 0) + STARTER_CREDITS, totalUsed: data.totalUsed || 0};
  }

  return {
    balance: data.balance || 0,
    totalUsed: data.totalUsed || 0,
  };
}

export async function useCredit(
  db: FirebaseFirestore.Firestore,
  uid: string,
  action: string,
  amount: number = 1
): Promise<{remaining: number}> {
  const docRef = db.collection("credits").doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    let data: CreditDoc;
    if (!snap.exists) {
      data = {
        ...defaultCreditDoc(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      } as CreditDoc;
      // New user gets starter credits
      data.balance = STARTER_CREDITS;
    } else {
      data = snap.data() as CreditDoc;
      // Migrate legacy users
      if (!data.starterCredited) {
        data.balance = (data.balance || 0) + STARTER_CREDITS;
        data.starterCredited = true;
      }
    }

    const balance = data.balance || 0;
    if (balance < amount) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        `Not enough credits. Need ${amount}, have ${balance}. Purchase credits to continue.`
      );
    }

    const newBalance = balance - amount;
    const update: Record<string, unknown> = {
      balance: newBalance,
      totalUsed: (data.totalUsed || 0) + amount,
      starterCredited: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!snap.exists) {
      tx.set(docRef, {...defaultCreditDoc(), ...update});
    } else {
      tx.update(docRef, update);
    }

    // Log the usage
    const usageRef = db.collection("credits").doc(uid).collection("usage").doc();
    tx.set(usageRef, {
      action,
      amount,
      balanceBefore: balance,
      balanceAfter: newBalance,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {remaining: newBalance};
  });
}

export async function refundCredit(
  db: FirebaseFirestore.Firestore,
  uid: string,
  reason: string,
  amount: number = 1
): Promise<{balance: number}> {
  const docRef = db.collection("credits").doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "No credit record found");
    }

    const data = snap.data() as CreditDoc;
    const oldBalance = data.balance || 0;
    const newBalance = oldBalance + amount;

    tx.update(docRef, {
      balance: newBalance,
      totalUsed: Math.max(0, (data.totalUsed || 0) - amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Log refund in usage subcollection
    const usageRef = db.collection("credits").doc(uid).collection("usage").doc();
    tx.set(usageRef, {
      action: `refund:${reason}`,
      amount: -amount,
      balanceBefore: oldBalance,
      balanceAfter: newBalance,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {balance: newBalance};
  });
}

export interface PurchaseMetadata {
  packId: string;
  packLabel: string;
  amountPaid: number; // cents
}

export async function addCredits(
  db: FirebaseFirestore.Firestore,
  uid: string,
  amount: number,
  purchaseMetadata?: PurchaseMetadata
): Promise<void> {
  const docRef = db.collection("credits").doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      tx.set(docRef, {
        ...defaultCreditDoc(),
        balance: STARTER_CREDITS + amount,
        totalPurchased: amount,
      });
    } else {
      tx.update(docRef, {
        balance: admin.firestore.FieldValue.increment(amount),
        totalPurchased: admin.firestore.FieldValue.increment(amount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Write purchase record to subcollection
    if (purchaseMetadata) {
      const purchaseRef = db
        .collection("credits")
        .doc(uid)
        .collection("purchases")
        .doc();
      tx.set(purchaseRef, {
        date: admin.firestore.FieldValue.serverTimestamp(),
        packId: purchaseMetadata.packId,
        packLabel: purchaseMetadata.packLabel,
        credits: amount,
        amountPaid: purchaseMetadata.amountPaid,
      });
    }
  });
}

export async function handleCreditRequest(
  path: string,
  body: Record<string, unknown>,
  user: admin.auth.DecodedIdToken
): Promise<unknown> {
  const db = admin.firestore();
  const subPath = path.replace(/^\/credits\/?/, "");

  switch (subPath) {
    case "balance":
      return getBalance(db, user.uid);

    case "use": {
      const action = (body.action as string) || "search";
      const amount = typeof body.amount === "number" && body.amount >= 1 ? Math.floor(body.amount) : 1;
      return useCredit(db, user.uid, action, amount);
    }

    case "checkout": {
      // Dynamic import to avoid loading Stripe unless needed
      const {createCreditCheckoutSession} = await import("./stripe");
      const packId = body.packId as string;
      if (!packId) {
        throw new functions.https.HttpsError("invalid-argument", "packId is required");
      }
      return createCreditCheckoutSession(user.uid, user.email || "", packId);
    }

    case "refund": {
      const reason = (body.reason as string) || "unknown";
      const amount = typeof body.amount === "number" && body.amount >= 1 ? Math.floor(body.amount) : 1;
      const allowedReasons = ["google-unavailable"];
      if (!allowedReasons.includes(reason)) {
        throw new functions.https.HttpsError("invalid-argument", `Invalid refund reason: ${reason}`);
      }
      if (amount > 5) {
        throw new functions.https.HttpsError("invalid-argument", "Refund amount too high");
      }
      return refundCredit(db, user.uid, reason, amount);
    }

    case "packs":
      return {packs: CREDIT_PACKS};

    case "history": {
      const purchasesSnap = await db
        .collection("credits")
        .doc(user.uid)
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

    default:
      throw new functions.https.HttpsError("not-found", `Unknown credit endpoint: ${subPath}`);
  }
}
