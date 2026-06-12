import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  ProviderPaymentStatus,
} from "./provider.js";

// ─────────────────────────────────────────────────────────
// PHONEPE STANDARD CHECKOUT V2
//
// Env (sandbox values until production onboarding completes):
//   PHONEPE_BASE_URL      e.g. https://api-preprod.phonepe.com/apis/pg-sandbox
//   PHONEPE_AUTH_URL      e.g. https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token
//                         (prod: https://api.phonepe.com/apis/identity-manager/v1/oauth/token)
//   PHONEPE_CLIENT_ID
//   PHONEPE_CLIENT_SECRET
//   PHONEPE_CLIENT_VERSION  (usually "1")
//
// Flow: OAuth token (cached) → POST /checkout/v2/pay returns the
// hosted checkout redirectUrl → user pays → we confirm via
// GET /checkout/v2/order/{merchantOrderId}/status.
// ─────────────────────────────────────────────────────────

const BASE_URL = process.env.PHONEPE_BASE_URL ?? "";
const AUTH_URL = process.env.PHONEPE_AUTH_URL ?? "";
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET ?? "";
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION ?? "1";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      client_version: CLIENT_VERSION,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`PhonePe auth failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_at?: number;
    expires_in?: number;
  };
  const expiresAt = data.expires_at
    ? data.expires_at * 1000
    : Date.now() + (data.expires_in ?? 900) * 1000;
  cachedToken = { token: data.access_token, expiresAt };
  return data.access_token;
}

export const phonePeProvider: PaymentProvider = {
  name: "phonepe",

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const token = await getAccessToken();
    // merchantOrderId must be unique per attempt — use the payment id
    const merchantOrderId = `RZ-${input.paymentId}`;

    const res = await fetch(`${BASE_URL}/checkout/v2/pay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${token}`,
      },
      body: JSON.stringify({
        merchantOrderId,
        amount: input.amount,
        paymentFlow: {
          type: "PG_CHECKOUT",
          merchantUrls: { redirectUrl: input.redirectUrl },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`PhonePe pay failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { redirectUrl?: string };
    if (!data.redirectUrl) {
      throw new Error(`PhonePe pay: missing redirectUrl in ${JSON.stringify(data)}`);
    }
    return { checkoutUrl: data.redirectUrl, providerOrderId: merchantOrderId };
  },

  async getStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    const token = await getAccessToken();
    const res = await fetch(
      `${BASE_URL}/checkout/v2/order/${providerOrderId}/status`,
      { headers: { Authorization: `O-Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`PhonePe status failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { state?: string };
    if (data.state === "COMPLETED") return "SUCCESS";
    if (data.state === "FAILED") return "FAILED";
    return "PENDING";
  },
};
