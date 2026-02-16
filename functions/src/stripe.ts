import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import {CREDIT_PACKS, addCredits, PurchaseMetadata} from "./credits";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new functions.https.HttpsError("failed-precondition", "Stripe is not configured");
  }
  return new Stripe(key, {apiVersion: "2023-10-16"});
}

export async function createCreditCheckoutSession(
  uid: string,
  email: string,
  packId: string
): Promise<{url: string; sessionId: string}> {
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) {
    throw new functions.https.HttpsError("invalid-argument", `Unknown pack: ${packId}`);
  }

  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: email,
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
    },
    success_url: "https://solicitation-matcher-extension.web.app/success.html",
    cancel_url: "https://solicitation-matcher-extension.web.app/cancel.html",
  });

  if (!session.url) {
    throw new functions.https.HttpsError("internal", "Failed to create checkout session");
  }

  return {url: session.url, sessionId: session.id};
}

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
    throw new functions.https.HttpsError("permission-denied", `Webhook verification failed: ${message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const uid = session.metadata?.uid;
    const credits = parseInt(session.metadata?.credits || "0", 10);

    const packId = session.metadata?.packId || "";
    if (!uid || credits <= 0) {
      console.error("Invalid webhook metadata:", session.metadata);
      return;
    }

    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    const purchaseMetadata: PurchaseMetadata = {
      packId,
      packLabel: pack?.label || `${credits} searches`,
      amountPaid: session.amount_total || pack?.price || 0,
    };

    const db = admin.firestore();
    await addCredits(db, uid, credits, purchaseMetadata);
    console.log(`Added ${credits} credits to user ${uid}`);
  }
}
