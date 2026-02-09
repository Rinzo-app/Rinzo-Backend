/**
 * Firebase Admin SDK initialisation (identity-only).
 *
 * Used solely to verify Firebase ID tokens sent by
 * CUSTOMER, SHOP_OWNER, and RIDER clients.
 *
 * Requires three env vars:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (with embedded \n line-breaks)
 *
 * If any are missing the export will be `null` and the auth
 * middleware will reject Firebase-based requests gracefully.
 */

import { initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let app: App | null = null;
let auth: Auth | null = null;

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (projectId && clientEmail && privateKey) {
  try {
    app = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    auth = getAuth(app);
    console.log("[firebase] Admin SDK initialised");
  } catch (err) {
    console.error("[firebase] Failed to initialise Admin SDK:", err);
  }
} else {
  console.warn(
    "[firebase] Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — Firebase auth disabled",
  );
}

/** Firebase Auth instance (null when credentials are missing). */
export const firebaseAuth = auth;
