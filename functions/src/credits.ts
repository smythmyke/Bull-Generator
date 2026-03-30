import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

// Top-up credit packs (one-time purchases)
export const CREDIT_PACKS = [
  {id: "pack_10", credits: 10, price: 200, label: "10 searches", perCredit: "$0.20"},
  {id: "pack_30", credits: 30, price: 500, label: "30 searches", perCredit: "$0.17"},
  {id: "pack_75", credits: 75, price: 1000, label: "75 searches", perCredit: "$0.13"},
] as const;

// Subscription plans
export const SUBSCRIPTION_PLANS = [
  {id: "searcher", name: "Searcher", monthlyCredits: 20, price: 900, perCredit: "$0.45", rolloverCap: 0},
  {id: "pro", name: "Pro", monthlyCredits: 60, price: 1900, perCredit: "$0.32", rolloverCap: 30},
  {id: "firm", name: "Firm", monthlyCredits: 150, price: 3900, perCredit: "$0.26", rolloverCap: 75},
] as const;

// Map plan IDs to Stripe price IDs (set via environment)
export function getStripePriceId(planId: string): string {
  const envKey = `STRIPE_PRICE_${planId.toUpperCase()}`;
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Stripe price not configured for plan: ${planId}`
    );
  }
  return priceId;
}

const STARTER_CREDITS = 5;

// Endpoints that are free (no credit cost)
export const FREE_ENDPOINTS = new Set(["/synonyms", "/definitions", "/enrich-npl", "/extract-concepts"]);

export interface SubscriptionData {
  planId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: "active" | "canceled" | "past_due";
  currentPeriodEnd: string; // ISO date
  monthlyAllocation: number;
}

interface CreditDoc {
  balance: number;
  subscriptionCredits: number;
  topupCredits: number;
  freeCreditsGranted: boolean;
  starterCredited?: boolean; // legacy field
  totalPurchased: number;
  totalUsed: number;
  subscription: SubscriptionData | null;
  stripeCustomerId?: string;
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
}

function defaultCreditDoc(): CreditDoc {
  return {
    balance: 0,
    subscriptionCredits: 0,
    topupCredits: 0,
    freeCreditsGranted: false,
    totalPurchased: 0,
    totalUsed: 0,
    subscription: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// Get balance for a user
export async function getBalance(
  db: FirebaseFirestore.Firestore,
  uid: string
): Promise<{
  balance: number;
  subscriptionCredits: number;
  topupCredits: number;
  freeCreditsGranted: boolean;
  totalUsed: number;
  totalPurchased: number;
  subscription: {
    planId: string;
    status: string;
    currentPeriodEnd: string;
    monthlyAllocation: number;
  } | null;
}> {
  const docRef = db.collection("credits").doc(uid);
  const snap = await docRef.get();

  if (!snap.exists) {
    return {
      balance: 0,
      subscriptionCredits: 0,
      topupCredits: 0,
      freeCreditsGranted: false,
      totalUsed: 0,
      totalPurchased: 0,
      subscription: null,
    };
  }

  const data = snap.data()!;
  const subCredits = data.subscriptionCredits || 0;
  // Backward compat: old docs only have flat `balance`, no topupCredits
  const topCredits = data.topupCredits ?? data.balance ?? 0;
  const sub = data.subscription || null;

  return {
    balance: subCredits + topCredits,
    subscriptionCredits: subCredits,
    topupCredits: topCredits,
    freeCreditsGranted: data.freeCreditsGranted || data.starterCredited || false,
    totalUsed: data.totalUsed || 0,
    totalPurchased: data.totalPurchased || 0,
    subscription: sub ? {
      planId: sub.planId,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      monthlyAllocation: sub.monthlyAllocation,
    } : null,
  };
}

// Initialize credits for a new user — grants starter credits on first sign-in
export async function initCredits(
  db: FirebaseFirestore.Firestore,
  uid: string
): Promise<void> {
  const docRef = db.collection("credits").doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    if (!snap.exists) {
      tx.set(docRef, {
        ...defaultCreditDoc(),
        balance: STARTER_CREDITS,
        topupCredits: STARTER_CREDITS,
        freeCreditsGranted: true,
      });
      return;
    }

    const data = snap.data()!;

    // Migrate old docs: if topupCredits doesn't exist, set it from balance
    if (data.topupCredits === undefined) {
      tx.update(docRef, {
        topupCredits: data.balance || 0,
        subscriptionCredits: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Grant free starter credits if not yet given (check both old and new flag)
    if (!data.freeCreditsGranted && !data.starterCredited) {
      tx.update(docRef, {
        balance: admin.firestore.FieldValue.increment(STARTER_CREDITS),
        topupCredits: admin.firestore.FieldValue.increment(STARTER_CREDITS),
        freeCreditsGranted: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });
}

// Atomically deduct credits — subscription credits first, then topup
export async function useCredit(
  db: FirebaseFirestore.Firestore,
  uid: string,
  action: string,
  amount: number = 1
): Promise<{remaining: number}> {
  const docRef = db.collection("credits").doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    if (!snap.exists) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        `Not enough credits. Need ${amount}, have 0. Purchase credits to continue.`
      );
    }

    const data = snap.data()!;
    const subCredits = data.subscriptionCredits || 0;
    const topCredits = data.topupCredits ?? data.balance ?? 0;
    const total = subCredits + topCredits;

    if (total < amount) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        `Not enough credits. Need ${amount}, have ${total}. Purchase credits to continue.`
      );
    }

    // Deduct from subscription credits first, then topup
    let newSub = subCredits;
    let newTop = topCredits;
    let remaining = amount;

    if (subCredits > 0) {
      const fromSub = Math.min(subCredits, remaining);
      newSub = subCredits - fromSub;
      remaining -= fromSub;
    }
    if (remaining > 0) {
      newTop = topCredits - remaining;
    }

    const newBalance = newSub + newTop;

    tx.update(docRef, {
      subscriptionCredits: newSub,
      topupCredits: newTop,
      balance: newBalance,
      totalUsed: admin.firestore.FieldValue.increment(amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Log the usage
    const usageRef = db.collection("credits").doc(uid).collection("usage").doc();
    tx.set(usageRef, {
      action,
      amount,
      balanceBefore: total,
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

    const data = snap.data()!;
    const subCredits = data.subscriptionCredits || 0;
    const topCredits = data.topupCredits ?? data.balance ?? 0;
    const newTop = topCredits + amount;
    const newBalance = subCredits + newTop;

    tx.update(docRef, {
      topupCredits: newTop,
      balance: newBalance,
      totalUsed: Math.max(0, (data.totalUsed || 0) - amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Log refund in usage subcollection
    const usageRef = db.collection("credits").doc(uid).collection("usage").doc();
    tx.set(usageRef, {
      action: `refund:${reason}`,
      amount: -amount,
      balanceBefore: subCredits + topCredits,
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
  source?: "extension" | "website";
}

// Add purchased credits (top-up packs)
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
        topupCredits: amount,
        totalPurchased: amount,
      });
    } else {
      tx.update(docRef, {
        balance: admin.firestore.FieldValue.increment(amount),
        topupCredits: admin.firestore.FieldValue.increment(amount),
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
        source: purchaseMetadata.source || "extension",
      });
    }
  });
}

// Grant subscription credits on renewal — with rollover cap logic
export async function grantSubscriptionCredits(
  db: FirebaseFirestore.Firestore,
  uid: string,
  amount: number,
  subscription: SubscriptionData
): Promise<void> {
  const docRef = db.collection("credits").doc(uid);

  // Look up rollover cap for this plan
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === subscription.planId);
  const rolloverCap = plan?.rolloverCap ?? 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    if (!snap.exists) {
      tx.set(docRef, {
        ...defaultCreditDoc(),
        subscriptionCredits: amount,
        balance: amount,
        subscription,
      });
    } else {
      const data = snap.data()!;
      const topCredits = data.topupCredits ?? data.balance ?? 0;

      // Guard against double-grant: check currentPeriodEnd
      const existingSub = data.subscription;
      if (existingSub && existingSub.currentPeriodEnd === subscription.currentPeriodEnd) {
        console.log(`Skipping duplicate grant for ${uid}, period ${subscription.currentPeriodEnd}`);
        return;
      }

      // Calculate rollover: carry over unused sub credits up to cap
      const existingSubCredits = data.subscriptionCredits || 0;
      const carryOver = rolloverCap > 0 ? Math.min(existingSubCredits, rolloverCap) : 0;
      const newSubCredits = carryOver + amount;

      tx.update(docRef, {
        subscriptionCredits: newSubCredits,
        balance: newSubCredits + topCredits,
        subscription,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });
}

// Route credit requests
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

    case "init":
      await initCredits(db, user.uid);
      return getBalance(db, user.uid);

    case "use": {
      const action = (body.action as string) || "search";
      const amount = typeof body.amount === "number" && body.amount >= 1 ? Math.floor(body.amount) : 1;
      return useCredit(db, user.uid, action, amount);
    }

    case "checkout": {
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

    case "subscription/plans":
      return {
        plans: SUBSCRIPTION_PLANS.map((p) => ({
          id: p.id,
          name: p.name,
          monthlyCredits: p.monthlyCredits,
          price: p.price,
          perCredit: p.perCredit,
          rolloverCap: p.rolloverCap,
        })),
      };

    case "subscription/checkout": {
      const {createSubscriptionCheckoutSession} = await import("./stripe");
      const planId = body.planId as string;
      if (!planId) {
        throw new functions.https.HttpsError("invalid-argument", "planId is required");
      }
      return createSubscriptionCheckoutSession(user.uid, user.email || "", planId);
    }

    case "subscription/portal": {
      const {createCustomerPortalSession} = await import("./stripe");
      return createCustomerPortalSession(user.uid);
    }

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
