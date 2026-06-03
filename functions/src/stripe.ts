import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import {
  CREDIT_PACKS,
  SUBSCRIPTION_PLANS,
  addCredits,
  grantSubscriptionCredits,
  getStripePriceId,
  PurchaseMetadata,
  PlatformSource,
  coerceSource,
} from "./credits";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new functions.https.HttpsError("failed-precondition", "Stripe is not configured");
  }
  return new Stripe(key, {apiVersion: "2023-10-16"});
}

const DEFAULT_SUCCESS_URL = "https://solicitation-matcher-extension.web.app/success.html";
const DEFAULT_CANCEL_URL = "https://solicitation-matcher-extension.web.app/cancel.html";

// --- Stripe Customer Management ---

async function getOrCreateStripeCustomer(
  uid: string,
  email: string
): Promise<string> {
  const db = admin.firestore();
  const docRef = db.collection("credits").doc(uid);
  const snap = await docRef.get();
  const data = snap.data();

  // Check if customer ID already stored
  if (data?.subscription?.stripeCustomerId) {
    return data.subscription.stripeCustomerId;
  }
  if (data?.stripeCustomerId) {
    return data.stripeCustomerId;
  }

  // Create new Stripe customer
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: {firebaseUid: uid},
  });

  // Store customer ID
  await docRef.set(
    {stripeCustomerId: customer.id, updatedAt: admin.firestore.FieldValue.serverTimestamp()},
    {merge: true}
  );

  return customer.id;
}

// --- One-time Credit Pack Checkout ---

export async function createCreditCheckoutSession(
  uid: string,
  email: string,
  packId: string,
  source?: PlatformSource
): Promise<{url: string; sessionId: string}> {
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) {
    throw new functions.https.HttpsError("invalid-argument", `Unknown pack: ${packId}`);
  }

  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(uid, email);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: pack.price,
          product_data: {
            name: `Patent Search Credits - ${pack.label}`,
            description: `${pack.credits} patent search credits`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      uid,
      packId: pack.id,
      credits: String(pack.credits),
      source: source || "extension",
    },
    success_url: `${DEFAULT_SUCCESS_URL}?purchase=success`,
    cancel_url: `${DEFAULT_CANCEL_URL}?purchase=cancelled`,
  });

  if (!session.url) {
    throw new functions.https.HttpsError("internal", "Failed to create checkout session");
  }

  return {url: session.url, sessionId: session.id};
}

// --- Subscription Checkout ---

export async function createSubscriptionCheckoutSession(
  uid: string,
  email: string,
  planId: string,
  source?: PlatformSource
): Promise<{url: string; sessionId: string}> {
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
  if (!plan) {
    throw new functions.https.HttpsError("invalid-argument", `Unknown plan: ${planId}`);
  }

  const stripe = getStripe();
  const customerId = await getOrCreateStripeCustomer(uid, email);
  const priceId = getStripePriceId(planId);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{price: priceId, quantity: 1}],
    metadata: {
      uid,
      planId: plan.id,
      source: source || "extension",
    },
    subscription_data: {
      metadata: {
        uid,
        planId: plan.id,
        monthlyCredits: String(plan.monthlyCredits),
        source: source || "extension",
      },
    },
    success_url: `${DEFAULT_SUCCESS_URL}?subscription=success`,
    cancel_url: `${DEFAULT_CANCEL_URL}?subscription=cancelled`,
  });

  if (!session.url) {
    throw new functions.https.HttpsError("internal", "Failed to create subscription checkout session");
  }

  return {url: session.url, sessionId: session.id};
}

// --- Customer Portal ---

export async function createCustomerPortalSession(
  uid: string
): Promise<{url: string}> {
  const db = admin.firestore();
  const docRef = db.collection("credits").doc(uid);
  const snap = await docRef.get();
  const data = snap.data();

  const customerId = data?.subscription?.stripeCustomerId || data?.stripeCustomerId;
  if (!customerId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "No Stripe customer found. Subscribe first."
    );
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: DEFAULT_SUCCESS_URL,
  });

  return {url: session.url};
}

// --- Webhook Handler ---

export async function handleWebhookEvent(
  rawBody: Buffer,
  signature: string
): Promise<void> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new functions.https.HttpsError("failed-precondition", "Webhook secret not configured");
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    throw new functions.https.HttpsError(
      "permission-denied",
      `Webhook verification failed: ${message}`
    );
  }

  const db = admin.firestore();

  switch (event.type) {
    // --- One-time credit pack purchase ---
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      // Only handle one-time payment sessions (not subscription checkouts)
      if (session.mode !== "payment") break;

      const uid = session.metadata?.uid;
      const credits = parseInt(session.metadata?.credits || "0", 10);
      const packId = session.metadata?.packId || "";

      if (!uid || credits <= 0) {
        console.error("Invalid webhook metadata:", session.metadata);
        return;
      }

      const pack = CREDIT_PACKS.find((p) => p.id === packId);
      const source = coerceSource(session.metadata?.source);
      const purchaseMetadata: PurchaseMetadata = {
        packId,
        packLabel: pack?.label || `${credits} searches`,
        amountPaid: session.amount_total || pack?.price || 0,
        source,
      };

      await addCredits(db, uid, credits, purchaseMetadata);
      console.log(`Added ${credits} top-up credits to user ${uid} (source: ${source})`);
      break;
    }

    // --- Subscription invoice paid (initial + renewal) ---
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.subscription as string | null;

      if (!subscriptionId) break;

      // Get subscription details to find uid and plan
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const uid = subscription.metadata?.uid;
      const planId = subscription.metadata?.planId;
      const monthlyCredits = parseInt(subscription.metadata?.monthlyCredits || "0", 10);

      if (!uid || !planId || monthlyCredits <= 0) {
        console.error("Invalid subscription metadata:", subscription.metadata);
        return;
      }

      const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
      const allocation = plan?.monthlyCredits || monthlyCredits;
      const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
      const source = coerceSource(subscription.metadata?.source);

      await grantSubscriptionCredits(db, uid, allocation, {
        planId,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: subscription.customer as string,
        status: "active",
        currentPeriodEnd: periodEnd,
        monthlyAllocation: allocation,
        source,
      });

      // Record this invoice as a subscription purchase so revenue attribution
      // has a single source of truth (top-ups + subscription renewals both land
      // in credits/{uid}/purchases). Doc ID = invoice.id makes the write
      // idempotent against duplicate Stripe webhook deliveries.
      const purchaseRef = db
        .collection("credits")
        .doc(uid)
        .collection("purchases")
        .doc(invoice.id);
      await purchaseRef.set(
        {
          date: admin.firestore.FieldValue.serverTimestamp(),
          kind: "subscription",
          planId,
          packLabel: plan ? `${plan.name} (${allocation} searches/mo)` : `${allocation} searches/mo`,
          credits: allocation,
          amountPaid: invoice.amount_paid || 0,
          source,
          stripeInvoiceId: invoice.id,
          stripeSubscriptionId: subscriptionId,
          billingReason: invoice.billing_reason || null,
        },
        {merge: true}
      );

      console.log(`Granted ${allocation} subscription credits to ${uid} (${planId}) — source ${source}`);
      break;
    }

    // --- Subscription updated (plan change, status change) ---
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const uid = subscription.metadata?.uid;

      if (!uid) {
        console.error("No uid in subscription metadata");
        return;
      }

      const planId = subscription.metadata?.planId || "";
      const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
      const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

      const status = subscription.status === "active" ? "active"
        : subscription.status === "past_due" ? "past_due"
          : "canceled";

      const docRef = db.collection("credits").doc(uid);
      await docRef.set(
        {
          "subscription.planId": planId,
          "subscription.status": status,
          "subscription.currentPeriodEnd": periodEnd,
          "subscription.monthlyAllocation": plan?.monthlyCredits || 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true}
      );

      console.log(`Updated subscription for ${uid}: ${planId} (${status})`);
      break;
    }

    // --- Subscription deleted/canceled ---
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const uid = subscription.metadata?.uid;

      if (!uid) {
        console.error("No uid in subscription metadata");
        return;
      }

      const docRef = db.collection("credits").doc(uid);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) return;

        const data = snap.data()!;
        const topCredits = data.topupCredits || 0;

        tx.update(docRef, {
          subscriptionCredits: 0,
          balance: topCredits,
          "subscription.status": "canceled",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      console.log(`Canceled subscription for ${uid}, zeroed sub credits`);
      break;
    }

    default:
      console.log(`Unhandled webhook event: ${event.type}`);
  }
}
