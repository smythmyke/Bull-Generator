import * as admin from "firebase-admin";

// Per-key rate limiting backed by Firestore (so it works across function
// instances). Two windows: per-minute and per-day. The per-minute window is
// the tighter check most of the time; the per-day cap catches runaway agents.

const PER_MIN_LIMIT = 60;
const PER_DAY_LIMIT = 1000;

const MIN_WINDOW_MS = 60 * 1000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining?: { minute: number; day: number };
}

export async function checkApiKeyRateLimit(keyId: string): Promise<RateLimitResult> {
  const db = admin.firestore();
  const now = Date.now();
  const minWindowStart = Math.floor(now / MIN_WINDOW_MS) * MIN_WINDOW_MS;
  const dayWindowStart = Math.floor(now / DAY_WINDOW_MS) * DAY_WINDOW_MS;

  const minDocId = `${keyId}_min_${minWindowStart}`;
  const dayDocId = `${keyId}_day_${dayWindowStart}`;

  const minRef = db.collection("rateLimitWindows").doc(minDocId);
  const dayRef = db.collection("rateLimitWindows").doc(dayDocId);

  return db.runTransaction(async (tx) => {
    const [minSnap, daySnap] = await Promise.all([tx.get(minRef), tx.get(dayRef)]);

    const minCount = (minSnap.data()?.count ?? 0) as number;
    const dayCount = (daySnap.data()?.count ?? 0) as number;

    if (minCount >= PER_MIN_LIMIT) {
      const retryAfter = Math.ceil((minWindowStart + MIN_WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
    }
    if (dayCount >= PER_DAY_LIMIT) {
      const retryAfter = Math.ceil((dayWindowStart + DAY_WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
    }

    const expiresMin = admin.firestore.Timestamp.fromMillis(minWindowStart + MIN_WINDOW_MS);
    const expiresDay = admin.firestore.Timestamp.fromMillis(dayWindowStart + DAY_WINDOW_MS);

    tx.set(
      minRef,
      {
        keyId,
        windowType: "minute",
        windowStart: admin.firestore.Timestamp.fromMillis(minWindowStart),
        count: admin.firestore.FieldValue.increment(1),
        expiresAt: expiresMin,
      },
      { merge: true }
    );
    tx.set(
      dayRef,
      {
        keyId,
        windowType: "day",
        windowStart: admin.firestore.Timestamp.fromMillis(dayWindowStart),
        count: admin.firestore.FieldValue.increment(1),
        expiresAt: expiresDay,
      },
      { merge: true }
    );

    return {
      allowed: true,
      remaining: {
        minute: PER_MIN_LIMIT - minCount - 1,
        day: PER_DAY_LIMIT - dayCount - 1,
      },
    };
  });
}

export async function logApiUsage(
  uid: string,
  keyId: string,
  opts: { creditsUsed?: number; isError?: boolean } = {}
): Promise<void> {
  const db = admin.firestore();
  const today = new Date().toISOString().slice(0, 10);
  const ref = db
    .collection("apiUsage")
    .doc(uid)
    .collection("keys")
    .doc(keyId)
    .collection("days")
    .doc(today);

  await ref
    .set(
      {
        requests: admin.firestore.FieldValue.increment(1),
        creditsUsed: admin.firestore.FieldValue.increment(opts.creditsUsed ?? 0),
        errors: admin.firestore.FieldValue.increment(opts.isError ? 1 : 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    .catch(() => {});
}
