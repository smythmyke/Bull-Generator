import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

// Credit pack definitions
export const CREDIT_PACKS = [
  {id: "pack_10", credits: 10, price: 200, label: "10 searches", perCredit: "$0.20"},
  {id: "pack_25", credits: 25, price: 450, label: "25 searches", perCredit: "$0.18"},
  {id: "pack_50", credits: 50, price: 800, label: "50 searches", perCredit: "$0.16"},
  {id: "pack_100", credits: 100, price: 1500, label: "100 searches", perCredit: "$0.15"},
] as const;

const FREE_DAILY_LIMIT = 5;

interface CreditDoc {
  balance: number;
  freeSearchesUsed: number;
  freeSearchDate: string;
  totalPurchased: number;
  totalUsed: number;
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultCreditDoc(): CreditDoc {
  return {
    balance: 0,
    freeSearchesUsed: 0,
    freeSearchDate: todayUTC(),
    totalPurchased: 0,
    totalUsed: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

export async function getBalance(
  db: FirebaseFirestore.Firestore,
  uid: string
): Promise<{balance: number; freeSearchesRemaining: number; freeSearchesUsed: number; totalUsed: number}> {
  const docRef = db.collection("credits").doc(uid);
  const snap = await docRef.get();

  if (!snap.exists) {
    return {balance: 0, freeSearchesRemaining: FREE_DAILY_LIMIT, freeSearchesUsed: 0, totalUsed: 0};
  }

  const data = snap.data() as CreditDoc;
  const today = todayUTC();
  const used = data.freeSearchDate === today ? data.freeSearchesUsed : 0;

  return {
    balance: data.balance,
    freeSearchesRemaining: Math.max(0, FREE_DAILY_LIMIT - used),
    freeSearchesUsed: used,
    totalUsed: data.totalUsed,
  };
}

export async function useCredit(
  db: FirebaseFirestore.Firestore,
  uid: string,
  action: string,
  amount: number = 1
): Promise<{source: "free" | "purchased"; remaining: number; freeSearchesRemaining: number}> {
  const docRef = db.collection("credits").doc(uid);
  const today = todayUTC();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    let data: CreditDoc;
    if (!snap.exists) {
      data = {...defaultCreditDoc(), createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()} as CreditDoc;
      // We'll set it below after determining the source
    } else {
      data = snap.data() as CreditDoc;
    }

    // Reset free searches if new day
    let freeUsed = data.freeSearchDate === today ? data.freeSearchesUsed : 0;

    // Try free tier first
    if (freeUsed + amount <= FREE_DAILY_LIMIT) {
      freeUsed += amount;
      const update: Record<string, unknown> = {
        freeSearchesUsed: freeUsed,
        freeSearchDate: today,
        totalUsed: (data.totalUsed || 0) + amount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!snap.exists) {
        tx.set(docRef, {...defaultCreditDoc(), ...update});
      } else {
        tx.update(docRef, update);
      }
      return {
        source: "free" as const,
        remaining: data.balance || 0,
        freeSearchesRemaining: FREE_DAILY_LIMIT - freeUsed,
      };
    }

    // Try purchased credits
    const balance = data.balance || 0;
    if (balance >= amount) {
      const newBalance = balance - amount;
      const update: Record<string, unknown> = {
        balance: newBalance,
        freeSearchesUsed: freeUsed,
        freeSearchDate: today,
        totalUsed: (data.totalUsed || 0) + amount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!snap.exists) {
        tx.set(docRef, {...defaultCreditDoc(), ...update});
      } else {
        tx.update(docRef, update);
      }
      return {
        source: "purchased" as const,
        remaining: newBalance,
        freeSearchesRemaining: 0,
      };
    }

    // No credits available
    throw new functions.https.HttpsError(
      "resource-exhausted",
      `Not enough credits. Need ${amount}, but none remaining. Purchase credits to continue.`
    );
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
        balance: amount,
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
